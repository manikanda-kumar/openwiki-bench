---
type: concept
title: Online and Offline CA Flows
description: How the step CLI signs, renews, revokes, and rekeys certificates, unifying the online step-ca HTTP client and the embedded offline authority through the cautils CaClient abstraction and the ACME device/HTTP challenge flow.
tags: [ca-flows, offline-mode, ca-client, acme-flow, certificate-lifecycle]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-976947cfd6258da1cc5693a8
    resource: repo://utils/cautils/acme_flow.go
  - id: openwiki-source-aecab703e3710c5764638ff5
    resource: repo://utils/cautils/acmeutils.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---

# Online and Offline CA Flows

The `step ca` certificate lifecycle commands must work both against a running
`step-ca` server (online mode) and against an embedded copy of the authority's
signing logic using the configuration produced by `step ca init` (offline mode).
A single interface, `cautils.CaClient`, plus a shared certificate flow, unify the
two paths so command actions do not branch on the backend for every operation.

## The CaClient abstraction

`cautils.CaClient` (in `utils/cautils/client.go`) is the interface implemented
by both the online client and the offline wrapper. It exposes the full lifecycle:
`Sign`, `Renew`, `RenewWithToken`, `Revoke`, `Rekey`, the SSH family
(`SSHSign`, `SSHRenew`, `SSHRekey`, `SSHRevoke`, `SSHRoots`, `SSHFederation`,
`SSHConfig`, `SSHCheckHost`, `SSHGetHosts`, `SSHBastion`), plus `Version`,
`GetRootCAs`, and `GetCaURL`.

`cautils.NewClient` selects the implementation from the CLI context: if
`--offline` is set it requires a `--ca-config` and returns a `NewOfflineCA`;
otherwise it parses `--ca-url` (HTTPS) and `--root` and returns an online
`ca.NewClient` rooted with `ca.WithRootFile`. When clients are constructed from a
bootstrap/style provisioning token in `CertificateFlow.GetClient`, the token's
root SHA (`ca.WithRootSHA256`) replaces the file-based root so `ca-url` may be
derived from the token audience.

## The certificate flow

`CertificateFlow` (`utils/cautils/certificate_flow.go`) drives the steps behind
`step ca certificate` and `step ca sign`. `NewCertificateFlow` reads `--offline`
and, when set, instantiates the `OfflineCA` from `--ca-config`; otherwise it
stays online. Flow options (`WithSSHPublicKey`, `WithCertificateRequest`,
`WithConfirmationFingerprint`, `WithCustomAttributes`) mutate a package-level
`sharedContext` used when generating tokens.

For an untokenized request, `GenerateToken` either calls `offlineCA.GenerateToken`
or builds a token online. `CreateSignRequest` generates a fresh key pair via
`utils.GetKeyDetailsFromCLI`/`keyutil.GenerateKey`, derives SANs per token type
(AWS instance document, GCP compute engine, Azure resource name, OIDC email/subject,
K8sSA subject, or the JWK subject using the common-name-in-token default), and
returns an X.509 CSR alongside the private key. `Sign` parses `--not-before`/
`--not-after` and `--set`/`--set-file` template data, submits an
`api.SignRequest`, and writes the returned certificate chain to the output file.

## OfflineCA: an embedded authority

`OfflineCA` (`utils/cautils/offline.go`) wraps the `step-ca` `authority.Authority`
type directly, using the `ca.json` loaded from `--ca-config`. Because double
initialization can be unsafe for some storage backends (e.g. badger locking), the
instance is a singleton (`offlineInstance`). Its `GetCaURL` and `CaURL` return
`https://` + the first configured DNS name, and `Audience` maps token types to the
equivalent `https://` paths used by the online API.

Each lifecycle method wraps the authority call and reuses the token audience and
signing logic:
- `Sign` calls `authority.Authorize` then `SignWithContext`.
- `Renew`/`Rekey` recover the peer certificate from the mTLS transport's
  client certificate and call `authority.Renew`/`Rekey`.
- `RenewWithToken` calls `authority.AuthorizeRenewToken` then `Renew`.
- `Revoke` authorizes via an OTT or the mTLS certificate and calls `authority.Revoke`
  with `PassiveOnly` as configured.
- `SSHSign`, `SSHRenew`, `SSHRekey`, `SSHRevoke`, `SSHRoots`, `SSHFederation`,
  `SSHConfig`, `SSHCheckHost`, `SSHGetHosts`, and `SSHBastion` wrap the
  corresponding authority SSH methods.

The offline instance's `GenerateToken` mirrors the online token flow
(`offline.go#GenerateToken`) using the `ca.json` root and audience and dispatching
per provisioner type, with the same unsupported types returning sentinel errors.

## Online lifecycle commands

`step ca certificate` (`command/ca/certificate.go`) validates flag combinations
(such as `--offline` being incompatible with `--token`, and `--attestation-uri`
being incompatible with `--kms`), then creates a `CertificateFlow`. If no token
is supplied it either enters the ACME flow (when `--acme` is set) or generates a
token; if the generated token signals an ACME provisioner (an `ACMETokenError`)
it delegates to `ACMECreateCertFlow`. The token type is inspected with
`token.ParseInsecure`: JWK tokens must match the CSR subject exactly, while
OIDC/AWS/GCP/Azure/K8sSA subjects are validated server-side already.

`step ca sign` (`command/ca/sign.go`) does the same through `cautils.ACMESignCSRFlow` when appropriate.

## Renew and Revoke

`step ca renew` (`command/ca/renew.go`) builds a `renewer` that wraps a
`cautils.CaClient` and an `http.Transport` configured with the configured root as
trust anchorring certificates. By default renew uses mTLS; `--mtls=false` forces a
token-based `X5cInsecure` flow, which is also used automatically once the current
certificate has expired (`RenewWithToken`). The single-shot path skips renewal if
`--expires-in` is not yet within the remaining validity plus a jitter. The daemon
(`--daemon`) loops on a timer, renewing before 2/3 of validity, and can signal a
PID, read a PID file, or run an `--exec` command after each renewal. `nextRenewDuration`
computes the sleep, adding random jitter so fleet-wide renewals are not synchronized.

`step ca revoke` (`command/ca/revoke.go`) supports authorization by a transparently
generated JWK provisioner token (keyed on the serial number) or by mTLS using
`--cert`/`--key`. It maps the `--reasonCode` text/number to an OCSP code via
`ReasonCodeToNum`/`RevocationReasonCodes` and always sends passive revocation
(`Passive: true`) — the command notes in source that it only supports passive
revocation (preventing renewal) and that active CRL/OCSP revocation is a TODO.

## The ACME flow

The ACME path (`utils/cautils/acme_flow.go` / `acmeutils.go`) is only for cert
creation and CSR signing; it is mutually exclusive with offline mode
(`newACMEFlow` returns an error if `--offline` is set). The flow selects either a
standalone HTTP server on a listener (`--standalone`, the default) or a webroot
directory (`--webroot`) to answer `http-01` challenges, or the `device-attest-01`
challenge when an `--attestation-uri` is supplied.

`authorizeOrder` walks each authorization, chooses the matching challenge type,
and calls `serveAndValidateHTTPChallenge` (or `doDeviceAttestation`). The flow
then waits for the order to become `ready`, finalizes it with a CSR, polls until
`valid`, and downloads the certificate chain. The CA directory defaults to
`<ca-url>/acme/<provisioner>/directory` when no explicit `--acme` URL is given.

For device attestation, `doDeviceAttestation` produces a CBOR-serialized "step"
format attestation object (signing the key authorization) and submits it via
`ac.ValidateWithPayload`. When the attestation URI is `tpmkms:`, a separate
TPM signer and directory storage flow is used (`af.tpmSigner`).

## Relationship to tokens

Both flows depend on the token system: online flows derive the audience and root
from flags or the token's audience/SHA, and offline flows use the `ca.json`
derived audience and root. Provisioner selection is shared through
`provisionerPrompt` in `utils/cautils/token_flow.go`, which filters by type,
`--kid`, `--provisioner`/`--issuer`, and `--admin-provisioner`. Provisioners that
do not support token auth return `ACMETokenError` or `SCEPTokenError`, prompting
the command to fall back to the ACME/SCEP-specific flows.
