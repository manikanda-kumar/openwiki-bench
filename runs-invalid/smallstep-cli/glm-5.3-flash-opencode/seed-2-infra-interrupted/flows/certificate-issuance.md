---
type: x509-issuance-flow
title: Certificate issuance flow (sign, certificate, offline mode)
description: How step ca certificate and step ca sign turn a token and a CSR into an issued certificate — online via the CA API, or offline against a local ca.json.
tags: [issuance, sign, offline, csr, sans, ca-client]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:55:27.913Z
---

# Certificate issuance flow (sign, certificate, offline mode)

This page covers how `step ca certificate` and `step ca sign` produce an
X.509 certificate: the `CertificateFlow` orchestrator, the shared `CaClient`
abstraction that makes online and offline modes interchangeable, CSR/SAN
construction rules, and how the response is written to disk. Token generation
itself is covered in [Provisioner token generation
flow](/openwiki/flows/token-generation.md); ACME-based issuance is covered in
[ACME certificate flow](/openwiki/flows/acme.md).

## The CaClient abstraction

`utils/cautils/client.go:29-48` defines the interface every issuance/renewal/
revocation command programs against:

```go
type CaClient interface {
	Sign(req *api.SignRequest) (*api.SignResponse, error)
	Renew(tr http.RoundTripper) (*api.SignResponse, error)
	RenewWithToken(ott string) (*api.SignResponse, error)
	Revoke(req *api.RevokeRequest, tr http.RoundTripper) (*api.RevokeResponse, error)
	Rekey(req *api.RekeyRequest, tr http.RoundTripper) (*api.SignResponse, error)
	SSHSign(...) ... // plus the full SSH surface, Version, GetRootCAs, GetCaURL
}
```

Two implementations satisfy it:

- **`*ca.Client`** (from `smallstep/certificates`) — the online HTTP client,
  built by `NewClient` with `--ca-url`, `--root` (falling back to
  `pki.GetRootCAPath()`) and any extra client options
  (`utils/cautils/client.go:52-74`).
- **`*OfflineCA`** — the in-process authority wrapper described below.

`NewClient` chooses between them purely on the `--offline` flag, which also
requires `--ca-config` (`utils/cautils/client.go:52-59`).

## The OfflineCA singleton

`OfflineCA` (`utils/cautils/offline.go:30-81`) embeds
`authority.New(&cfg)` from `smallstep/certificates` against a locally supplied
`ca.json` (via `--ca-config`), turning the CA server's own signing logic into
an in-process client. It is a **singleton** (`offlineInstance`) — `NewOfflineCA`
returns the existing instance on repeat calls — because re-initializing an
authority can be impossible: the comment notes that double initialization is
"sometimes not possible due to locks - as seen in badgerDB"
(`utils/cautils/offline.go:36-45`).

Offline mode provisions its own token flow: `OfflineCA.GenerateToken`
(`utils/cautils/offline.go:538-599`) mirrors `NewTokenFlow` but sources the
root and audience from the ca.json (`Audience` maps token types to
`https://<first-DNS>/<endpoint>` paths, `utils/cautils/offline.go:141-158`),
skips the network round-trip for provisioner lists, and takes the JWK
provisioner's `EncryptedKey` directly from the config (the online path fetches
it from the CA — see the `loadJWK` branch in
`utils/cautils/token_generator.go:386-404`). It dispatches to the same
provisioner generators, including OIDC via `step oauth` and the
ACME/SCEP errors.

Every operation is a wrapper over the authority API: `Sign` authorizes the OTT
then calls `authority.SignWithContext`
(`utils/cautils/offline.go:196-222`); `Renew` parses the peer certificate from
the transport and calls `authority.Renew`; `Revoke` authorizes either via OTT
or the mTLS client certificate; `Rekey` uses `authority.Rekey`; and the SSH
methods wrap their authority counterparts. Responses are shaped exactly like
the online API's (`ServerPEM`, `CaPEM`, `CertChainPEM`), so callers cannot tell
the modes apart (`utils/cautils/offline.go:175-181, 196-222`).

## CertificateFlow

`CertificateFlow` (`utils/cautils/certificate_flow.go:36-131`) is the
orchestrator used by `step ca certificate` and `step ca sign`. `NewCertificateFlow`
records offline mode (initializing the `OfflineCA` when `--offline`), and
applies flow options into a **package-level `sharedContext flowContext`**
(`utils/cautils/certificate_flow.go:42-51`) — deliberately process-global so
that state set during the token phase is visible to later phases in the same
command:

| `flowContext` field | Producer | Consumer |
| --- | --- | --- |
| `CertificateRequest` | `step ca sign` (the user's CSR, via `WithCertificateRequest`) | `TokenGenerator.SignToken` binds the CSR fingerprint into the token's `cnf` claim (`utils/cautils/token_generator.go:104-109`) |
| `ConfirmationFingerprint` | alternative CSR-fingerprint path | same `cnf` claim |
| `SSHPublicKey` | SSH certificate commands | SSH sign requests |
| `DisableCustomSANs` | cloud identity provisioners (AWS/GCP/Azure set it from `DisableCustomSANs`) | `CreateSignRequest` suppresses the subject SAN for those tokens (`utils/cautils/certificate_flow.go:321-347`) |
| `CustomAttributes` | `--custom-attributes` style options | token `user` claim (`utils/cautils/token_generator.go:111-114`) |

### GetClient: deriving the online client from the token

`GetClient` (`utils/cautils/certificate_flow.go:134-171`) parses the token
insecurely to support **bootstrap tokens**: when the payload carries a `sha`
(root fingerprint) and an http(s) audience, the CA URL is taken from the token
audience and the client trusts the root by SHA-256 fingerprint
(`ca.WithRootSHA256`) — no root file needed. Otherwise `--ca-url` and a root
file (or the default root path) are required.

### Token generation inside the flow

`GenerateToken`/`GenerateSSHToken`
(`utils/cautils/certificate_flow.go:176-231`) delegate to the offline
generator or `NewTokenFlow` (online), with `--ca-url`/`--root` only required
*unless* a `--token` was supplied directly. `GenerateIdentityToken` produces an
OIDC-only identity token via `NewIdentityTokenFlow`
(`utils/cautils/certificate_flow.go:233-247`).

### CreateSignRequest: key, CSR, and SAN rules

`CreateSignRequest` (`utils/cautils/certificate_flow.go:297-405`) generates the
private key from `--kty/--curve/--size`, then builds the CSR from the token
type (`jwt.Payload.Type()`):

- **JWK-like tokens** (default): the subject comes from the token payload.
- **AWS/GCP/Azure identity tokens**: with no explicit SANs, default SANs are
  derived from the instance identity document (private IP + `ip-...` internal
  name; GCP internal DNS names; Azure resource name), with the CLI subject
  appended unless the provisioner set `DisableCustomSANs`
  (`utils/cautils/certificate_flow.go:314-347`).
- **OIDC**: with no SANs and subject == token email, CN becomes the token
  subject with email SAN and `iss#sub` URI SAN; otherwise the subject is split
  into SANs (`utils/cautils/certificate_flow.go:348-371`).
- **K8sSA**: the token subject is ignored — the CLI subject wins, since K8s
  service-account tokens are multi-use (`utils/cautils/certificate_flow.go:372-375`).

SAN merging deduplicates across CLI `--san` values and token `sans` claims via
`splitSANs` → `x509util.SplitSANs`
(`utils/cautils/certificate_flow.go:312, 409-421`). The CSR signature is
verified locally (`cr.CheckSignature()`) before submission.

`step ca sign` differs only in that the CSR is user-supplied: the flow is
constructed with `WithCertificateRequest(csr)` so the issued token binds to
that CSR's fingerprint (`command/ca/sign.go:180-192`), and SANs are extracted
from the CSR itself.

### Sign: request, response, and file writing

`Sign` (`utils/cautils/certificate_flow.go:250-293`) adds `--not-before`/
`--not-after` and template data (`--set`, `--set-file`) to the `api.SignRequest`,
calls `client.Sign`, and writes the response chain — using `CertChainPEM` when
present, otherwise `ServerPEM`+`CaPEM` — as concatenated PEM with mode `0600`
via `fileutil.WriteFile`. The private key file is written separately by the
command (also `0600`) after a successful sign
(`command/ca/certificate.go:297-302`).

`step ca certificate` additionally validates token/argument consistency before
signing: with a JWK token the positional subject must match the CSR CN
(case-insensitively), and `--token` is mutually exclusive with `--san`
(`command/ca/certificate.go:270-283`).

## KMS-backed keys

Issuance commands accept `--kms <uri>` for token signing keys (via
`cryptoutil.CreateSigner` in the X5C/SSHPOP token generators), and the ACME
attestation path uses `cryptoutil.CreateAttestor`. Details of file-vs-KMS
routing are in [KMS URIs, step-kms-plugin, and the plugin
system](/openwiki/integrations/kms-and-plugins.md).

## Failure behavior

- `--offline` without `--ca-config` is rejected immediately
  (`utils/cautils/certificate_flow.go:115-125`).
- `Sign` fails before writing the certificate if the CA rejects the request;
  the private key is only serialized after the certificate is obtained
  (`command/ca/certificate.go:295-302`).
- Offline `Renew`/`Rekey`/`Revoke` assume the caller passes the transport
  carrying the mTLS certificate (type-asserted to `*http.Transport`);
  misuse panics by design ("it should not panic as this is always internal
  code", `utils/cautils/offline.go:226-235`).

## Representative tests

- `utils/cautils/offline_test.go` exercises the offline CA wrapper.
- `utils/cautils/token_flow_test.go` covers token-flow selection logic that
  feeds issuance.
- `command/ca/sign_test.go` and `command/ca/certificate.go` help-text examples
  document the online paths.

## Uncertainty

- Exact HTTP semantics of the online `ca.Client` (retry behavior, TLS
  negotiation) are owned by `smallstep/certificates`.
- `NewIdentityTokenFlow` (OIDC identity tokens) is referenced by
  `GenerateIdentityToken` but its implementation lives in
  `utils/cautils/token_flow.go`; see the token-generation page for the
  provisioner dispatch it shares.
