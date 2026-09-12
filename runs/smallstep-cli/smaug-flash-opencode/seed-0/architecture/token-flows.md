---
type: architecture
title: Certificate and Token Flows
description: Reusable certificate, token, and SSH flows that bridge CLI commands to step-ca, covering per-provisioner token generation, offline vs online mode, and client construction.
tags: [architecture, flows, token, certificate, offline, client]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---

# Certificate and Token Flows

`utils/cautils` contains reusable "flows" that orchestrate obtaining a token
and using it to sign/renew/revoke certificates, bridging CLI commands to the
step-ca API. The two key pieces are `CertificateFlow` and the token-generation
functions in `token_flow.go`. An `OfflineCA` wrapper is used in offline mode.

## CertificateFlow

`CertificateFlow` (utils/cautils/certificate_flow.go:36-40) wraps either an
`OfflineCA` instance (offline mode) or nothing (online mode) and carries a
shared `flowContext` that records options such as SSH public key, CSR,
confirmation fingerprint, and custom attributes (`With*` options).

`NewCertificateFlow(ctx, opts...)` (certificate_flow.go:105-131) applies
options to a package-global `sharedContext`, and in offline mode requires the
`--ca-config` flag and builds an `OfflineCA`.

Key methods:

- `GetClient(ctx, tok, options...)` (certificate_flow.go:134-171) returns the
  CA client. In offline mode it returns the offline client. Online, it resolves
  `--root`/`--ca-url`; for bootstrap/provisioning tokens (payload has `sha` and
  an http audience) it derives the CA URL and root SHA from the token itself;
  otherwise it requires `--ca-url` and `--root` and builds an online client.
- `GenerateToken(ctx, subject, sans)` (certificate_flow.go:176-205) produces an
  immediate-use token online (via `NewTokenFlow` after validating ca-url/root)
  or offline.
- `GenerateSSHToken(ctx, subject, typ, principals, nbf, naf)`
  (certificate_flow.go:209-231) produces a token for SSH signing, renewing,
  rekeying, or revoking.
- `Sign(ctx, tok, csr, crtFile)` (certificate_flow.go:250-293) submits an
  `api.SignRequest` and writes the resulting certificate chain to a file.
- `CreateSignRequest(ctx, tok, subject, sans)` (certificate_flow.go:297-405)
  generates a key and CSR, and specializes default SANs per token type — e.g.
  AWS uses the instance identity document's private IP/region, GCP uses the
  compute-engine instance names, Azure uses the resource name, and OIDC builds
  SANs from the email/subject/issuer.

## Token generation

`NewTokenFlow` (utils/cautils/token_flow.go:101-183) is the common flow for
generating a token. It derives the audience URL from `--ca-url`
(`parseAudience` maps token type to a `/1.0/*` path), fetches provisioners from
the CA root with `pki.GetProvisioners`, prompts the user to select one
(`provisionerPrompt`), then dispatches by provisioner type:

- `JWK` -> `generateJWKToken` (standard JWT)
- `OIDC` -> `generateOIDCToken` (runs `step oauth`)
- `X5C`, `SSHPOP`, `Nebula`, `K8sSA` -> the corresponding token generator
- `GCP`, `AWS`, `Azure` -> the provisioner's `GetIdentityToken` (falls back to
  instance metadata identity)
- `ACME`, `SCEP` -> returns a dedicated error type (`ACMETokenError` /
  `SCEPT brokenError`) because those provisioners do not support token flows.

`renew` tokens take a different path: if `tokType == RenewType`,
`generateRenewToken` is used directly.

`provisionerPrompt` (token_flow.go:291-408) filters provisioners by flags
(`x5c-cert/key`, `sshpop-cert/key`, `nebula-cert/key`, `k8ssa-token-path`),
`kid`, `--admin-provisioner`, and `--provisioner`/`--issuer`, then presents a
single-item selection or the named select UI.

`OfflineTokenFlow` (token_flow.go:212-273) uses either static config from a
`ca.json` (via an `OfflineCA`) or command-line flags (`--provisioner`,
`--key`, `--kid`) to generate a JWK or X5C token offline. These two paths are
mutually exclusive, and priority is given to `ca.json` when present.

## OfflineCA wrapper

`NewOfflineCA` (utils/cautils/offline.go:42-81) reads a `ca.json` config,
requires at least one provisioner, optionally overlays a password from
`--password-file`, and constructs a `certificates.Authority`. It is a singleton
(`offlineInstance`) to avoid double initialization (e.g. Badger locks).

`OfflineCA` implements the same client operations online clients expose, but by
calling the authority in-process: `Sign` (offline.go:196-222) authorizes the OTT
then calls `authority.SignWithContext`; `Renew`, `Revoke`, `Rekey`, `SSHSign`,
`SSHRevoke`, `SSHRenew`, `SSHRekey`, `SSHRoots`, `SSHFederation`, `SSHConfig`,
`SSHCheckHost`, `SSHGetHosts`, `SSHBastion`, and `Version` are all thin
wrappers over the in-process authority. `GenerateToken` (offline.go:539-599)
replicates the online token flow using the offline provisioners.

## Client construction

`NewClient` (utils/cautils/client.go:52-74) chooses:

- offline mode (with a required `--ca-config`) vs online (`--ca-url`/`--root`).
- Online clients resolve `--ca-url` from flags via `flags.ParseCaURL` and
  default the root to `pki.GetRootCAPath()` (`$STEPPATH/certs/root_ca.crt`).

`NewAdminClient`/`NewUnauthenticatedAdminClient` (client.go:77-96+) build admin
mgmt-API clients that require `--ca-url` and `--root`, with the admin client
further requiring `--admin-cert`/`--admin-key` for mTLS.

## Related

- [Token Model and JWT Claims](token-claims.md) — what the generated tokens contain.
- [Online and Offline step-ca Client Integration](../integration/ca-client.md) — the client API surface.
- [SSH Certificate Integration](../integration/ssh-integration.md) — SSH-specific issuance.
