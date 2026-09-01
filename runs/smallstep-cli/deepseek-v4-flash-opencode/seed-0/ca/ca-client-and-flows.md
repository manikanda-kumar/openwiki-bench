---
type: architecture
title: CA Client and Certificate Flows
description: The CaClient interface, online versus offline client construction, the admin client with x5c credentials, the CertificateFlow shared by sign/renew/revoke/rekey, and the offline CA and token generator implementations.
tags: [ca-client, offline-ca, certificate-flow, admin-client]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---

# CA Client and Certificate Flows

This page describes the client layer that connects `step` commands to a
certificate authority. Nearly every CA-facing command ends up using the types
in `utils/cautils`: the `CaClient` interface, `NewClient`/`NewAdminClient`
constructors, the `CertificateFlow`, and the `OfflineCA` implementation.

## The CaClient interface

`utils/cautils/client.go` defines `CaClient`, the operations the CLI needs
from a CA:

- X.509: `Sign`, `Renew`, `RenewWithToken`, `Revoke`, `Rekey`.
- SSH: `SSHSign`, `SSHRenew`, `SSHRekey`, `SSHRevoke`, `SSHRoots`,
  `SSHFederation`, `SSHConfig`, `SSHCheckHost`, `SSHGetHosts`, `SSHBastion`.
- Metadata: `Version`, `GetRootCAs`, `GetCaURL`.

There are two implementations: the online client from
`github.com/smallstep/certificates/ca` (`*ca.Client` and `*ca.AdminClient`) and
the local `*OfflineCA` in `utils/cautils/offline.go`.

## Client construction

`NewClient(ctx, opts...)`:

- If `--offline` is set, it requires `--ca-config` and returns
  `NewOfflineCA(ctx, caConfig)`.
- Otherwise it parses the `--ca-url` (normalized to `https`, see
  `flags.ParseCaURL`), resolves the root to `--root` or
  `pki.GetRootCAPath()`, and returns `ca.NewClient(caURL, ca.WithRootFile(root), opts...)`.

Admin clients come in two flavors:

- `NewUnauthenticatedAdminClient` — a `ca.AdminClient` for the management API
  without admin credentials.
- `NewAdminClient` — when `--admin-cert`/`--admin-key` are given, it reads the
  cert bundle and key and uses `ca.WithAdminX5C(...)`; otherwise it generates a
  new admin identity in memory: it prompts for (or takes `--admin-subject`) a
  subject, runs `NewTokenFlow` with `SignType` to get an OTT, builds a CSR for
  that subject, signs it through `client.Sign`, and uses the resulting
  certificate chain and key as the admin credentials. A `--password-file` is
  passed through to the x5c option.

## CertificateFlow

`CertificateFlow` is the shared orchestration used by `step ca certificate`,
`step ca sign`, `step ca renew`, `step ca revoke`, `step ca rekey`, and the SSH
commands. It carries an optional `OfflineCA` plus an `offline` flag:

- `GetClient(ctx, tok, opts...)` returns the offline CA when offline, otherwise
  parses the token to decide how to trust the server: if the token has a `sha`
  claim and an `http(s)` audience (a **bootstrap token**), the CA URL defaults
  to the audience and the client is created with `ca.WithRootSHA256(sha)`;
  otherwise `--ca-url` and `--root` are required.
- `GenerateToken` mints a sign token (offline or online) using the token flow,
  prompting for a subject when none is given.
- `GenerateSSHToken` mints an SSH sign token for the requested cert type.
- `GenerateIdentityToken` mints an OIDC-only identity token (used by
  `step ssh login` when client authentication is required).
- `Sign` builds an `api.SignRequest` (CSR + OTT + NotBefore/NotAfter +
  TemplateData), calls `client.Sign`, and writes the returned chain
  (leaf + CA, or the `CertChainPEM`) to the target file with `0600`.
- `CreateSignRequest` parses the token, generates a fresh key from the
  `--kty`/`--curve`/`--size` flags, and builds a CSR whose SANs are
  token-type-aware (AWS/GCP/Azure instance identity defaults, OIDC email and
  `iss#sub` URIs, etc.).

## Offline CA

`OfflineCA` embeds a `certificates` `authority.Authority` built from a local
`ca.json` (the file created by `step ca init` or passed with `--ca-config`). It
implements the full `CaClient` interface by wrapping authority methods —
`Sign` runs `Authorize` + `SignWithContext`, `Renew`/`Rekey` operate on the
certificate extracted from the mTLS transport, `Revoke` supports both OTT and
mTLS paths, and the SSH methods delegate to the authority's SSH sign/renew/
rekey/revoke/roots/config/check-host/hosts/bastion implementations.

`NewOfflineCA` reads the config, injects the password from `--password-file`
when set, and constructs the authority. It is a **process singleton**
(`offlineInstance`) to avoid double initialization, which can fail due to locks
(e.g. badgerDB). Its `Audience(tokType)` maps each token type to an API path
(`/sign`, `/renew`, `/revoke`, `/ssh/sign`, `/ssh/renew`, `/ssh/revoke`,
`/ssh/rekey`) under the CA's first DNS name, and `GenerateToken` selects a
provisioner from `ca.json` and mints the matching token type. ACME and SCEP
provisioners are rejected with dedicated error types
(`ACMETokenError`, `SCEPTokenError`).

## Token generation

`TokenGenerator` (in `token_generator.go`) is the low-level helper that mints
JWTs with a random JWT ID, `kid`, issuer, audience, optional root SHA, and
validity bounds (`WithValidity` enforces minimum/maximum token lifetimes):

- `SignToken` adds the SAN claim plus either the CSR fingerprint or an explicit
  confirmation fingerprint (`cnf` claim) and any custom user attributes.
- `SignSSHToken` adds the `step.ssh` claim carrying cert type, key ID,
  principals, and validity.
- `RevokeToken` mints a revoke token.

Provisioner-specific generators decide the signing key and headers:

- `generateJWKToken` loads the signing JWK from `--key` (optionally via a KMS)
  or, when no key file is given, from the provisioner's encrypted key —
  fetched from the CA (`pki.GetProvisionerKey`) online or read from `ca.json`
  offline.
- `generateOIDCToken` re-invokes `step oauth --oidc --bare` with the
  provisioner's configuration endpoint, client ID/secret, scopes, and auth
  params, returning the token.
- `generateK8sSAToken` reads the Kubernetes service-account token file
  (default `/var/run/secrets/kubernetes.io/serviceaccount/token`).
- `generateX5CToken`/`generateNebulaToken`/`generateSSHPOPToken` sign with the
  corresponding certificate/key material and put the certificate in the JWT
  header (`x5c`, `nebula`, `sshpop`).
- `generateRenewToken` builds the renewal token with an `x5cInsecure` header
  carrying the certificate being renewed; the positional subject, when given,
  must match the certificate's common name.

## Relationship to other pages

- The token flows that select provisioners are covered in
  [Provisioning Tokens](provisioning-tokens.md).
- The on-disk roots (`pki.GetRootCAPath()`, `--ca-config`) are covered in
  [STEPPATH, Configuration, and Contexts](../architecture/step-path-and-contexts.md).
- The command wrappers live in
  [The step ca Command Group](../commands/ca-group.md).
