---
type: workflow-page
title: X.509 Issuance Flow
description: The end-to-end step ca certificate and step ca sign flows - token acquisition, key and CSR creation with per-provisioner SAN defaults, validation, the API sign call, and offline mode.
tags: [issuance, csr, sign, offline, acme, sans]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-ff8a7fe9f3a4815e9b6b5c30
    resource: repo://command/ca/sign.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

`step ca certificate` and `step ca sign` share one flow abstraction,
`cautils.CertificateFlow`, which unifies the online (step-ca server) and offline
(ca.json) paths behind a single client interface. This page traces both commands
end-to-end; the token machinery they invoke is detailed by the tokens page.

## The CaClient abstraction

`cautils.CaClient` (utils/cautils/client.go:29-48) is the interface both clients
implement: Sign, Renew, RenewWithToken, Revoke, Rekey, the SSH equivalents, roots,
config, bastion, and version. `cautils.NewClient` (client.go:52-74) picks offline
(when `--offline`, requiring `--ca-config`) or online (`ca.NewClient` with
`ca.WithRootFile`, root defaulting to `pki.GetRootCAPath()`). `OfflineCA`
(utils/cautils/offline.go:30-81) wraps an **in-process** step-ca
`authority.Authority` built from the local `ca.json`: it is a process singleton
because double initialization can deadlock on the database lock (badgerDB comment
at offline.go:36-39), requires at least one provisioner in the config, and accepts
`--password-file` for decrypting provisioner keys. Its audience scheme mirrors the
online paths (`/sign`, `/renew`, `/revoke`, `/ssh/sign`, offline.go:140-158), so
tokens minted offline authorize against the same conceptual endpoints.

## step ca certificate end-to-end

`certificateAction` (command/ca/certificate.go:220-307):

1. **Arguments and gates.** Two or three positional args (`<subject> <crt-file>
   [<key-file>]`); the third is omitted only with `--attestation-uri` (TPM
   attestation path). `--offline` and `--token` are incompatible — the token must
   be generated *after* the offline CA starts (certificate.go:238-247); so are
   `--attestation-uri` and `--kms`.
2. **Token acquisition** (certificate.go:250-268). With `--acme`, the command
   switches wholesale to `ACMECreateCertFlow`. Otherwise `flow.GenerateToken`
   (certificate_flow.go:176-205) runs: offline delegates to the in-process
   authority; online requires `--ca-url` and a root (or `--token`) and calls
   `NewTokenFlow`. If the selected provisioner turns out to be ACME, the
   `ACMETokenError` reroutes into the ACME flow with that provisioner's name
   (certificate.go:262-265) — this is how the generic flow hands off to
   challenge-based issuance.
3. **Key/CSR creation.** `flow.CreateSignRequest` (certificate_flow.go:297-405)
   parses the token insecurely, generates the new private key from
   `--kty/--curve/--size`, computes SANs, builds and signs the CSR, and returns the
   `api.SignRequest{CsrPEM, OTT}` plus the private key.
4. **Subject validation** (certificate.go:275-293). For JWK tokens, the CLI
   enforces that the CSR common name equals the `<subject>` argument, and that a
   user-supplied `--token` is not combined with `--san`. For
   OIDC/AWS/GCP/Azure/K8sSA tokens, "common name will be validated on the server
   side, it depends on server configuration" — the CLI deliberately does not
   duplicate that logic. Unknown token types are rejected.
5. **Sign and write.** `flow.Sign` (certificate_flow.go:250-293) sends the sign
   request (with `--not-before`/`--not-after` and `--set`/`--set-file` template
   data) and writes the returned chain — `CertChainPEM` or `ServerPEM`+`CaPEM` —
   to `<crt-file>` with mode 0600. The private key is then written to `<key-file>`
   with mode 0600 (certificate.go:299-302), and both paths are echoed through
   `ui.PrintSelected`.

### Per-provisioner SAN and subject defaults

`CreateSignRequest` encodes provisioner-specific identity semantics
(certificate_flow.go:312-378). When the caller supplies no SANs:

- **AWS**: private IP plus `ip-<ip>.<region>.compute.internal`, plus the subject
  unless the provisioner set `DisableCustomSANs`
  (certificate_flow.go:314-325).
- **GCP**: `<name>.c.<project>.internal` and `<name>.<zone>.c.<project>.internal`
  forms, plus the subject unless custom SANs are disabled
  (certificate_flow.go:326-337).
- **Azure**: the parsed resource name, plus the subject unless custom SANs are
  disabled (certificate_flow.go:338-347).
- **OIDC** (documented inline at certificate_flow.go:349-371): if the subject
  matches the token email, CN becomes the token subject with SANs
  `email` and `iss#sub` URI; otherwise CN = subject with `splitSANs(subject)`.
- **K8sSA**: subject comes from the command line — the token is multi-use and not
  tied to the requested resource (certificate_flow.go:372-375).
- **Default (JWK)**: the subject is taken from the token
  (certificate_flow.go:376-378).

`splitSANs` deduplicates across inputs and classifies into DNS names, IPs, emails,
and URIs via `x509util.SplitSANs` (certificate_flow.go:407-421).

## step ca sign

`signCertificateAction` (command/ca/sign.go:150-223) is the bring-your-own-CSR
variant: it reads and signature-checks the CSR, and threads it into the flow via
`WithCertificateRequest(csr)` — which makes the token generator bind the token to
the CSR through the `cnf` fingerprint claim (sign.go:180; token_generator.go:104-109).
SANs default to the union of `--san` and the CSR's own SANs (`mergeSans`,
sign.go:190-191, 225-234). Subject validation compares the token subject to the CSR
CommonName for non-cloud tokens (sign.go:201-214). Signing and writing are identical
to the certificate command. ACME CSR signing reroutes to `ACMESignCSRFlow`
(sign.go:185-198).

## Client resolution from the token

`flow.GetClient` (certificate_flow.go:134-171) implements a notable convenience: it
parses the token and, if the payload carries a `sha` claim and an http audience
(the fingerprint of the CA root plus the CA URL), it bootstraps the client from the
token itself — `caURL = audience`, `ca.WithRootSHA256(sha)` — so a user can pass
just `--token` from a machine with no prior configuration. Otherwise the standard
`--ca-url`/`--root` (or defaults.json-backed values) are required. This is the
mechanism behind the documented pattern of piping `step ca token` output on one
host into `step ca certificate --token` on another.

## Failure behavior

- Offline mode fails fast when ca.json has no provisioners (offline.go:57-59).
- The `--offline`+`--token` combination is structurally rejected because offline
  tokens can only be minted after the in-process authority exists
  (certificate.go:239-242, sign.go:173-177).
- Subject/CSR mismatches fail closed on the client for JWK tokens; cloud and OIDC
  token mismatches are the server's decision (certificate.go:280-293).
- All HTTP behavior (retries, timeouts, mTLS) is owned by the external step-ca
  client library; this repository only assembles the requests.

## Representative tests

The issuance flows have no dedicated unit tests in this repository beyond the token
package tests; the testscript suite exercises `step certificate sign` (local
signing) but not `step ca certificate` against a live server. Treat behavioral
nuances here as source-derived; the offline authority behavior ultimately follows
the vendored step-ca authority implementation in the external certificates module.
