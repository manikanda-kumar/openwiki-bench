---
type: architecture
title: CA client and enrollment flows
description: How the step CLI talks to a step-ca Certificate Authority (online or offline), enrolls certificates, generates provisioning tokens, bootstraps authority configuration, and performs ACME issuance.
tags: [step-cli, ca, certificate, enrollment, acme, provisioner, bootstrap]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-aecab703e3710c5764638ff5
    resource: repo://utils/cautils/acmeutils.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
  - id: openwiki-source-57d7d8b1ea53edb457db35b8
    resource: repo://utils/cautils/tpm.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---

# CA client and enrollment flows

The `utils/cautils` package is the shared layer between the `ca`, `certificate`,
`ssh`, and `oauth` command groups and the step-ca server (or a local offline
CA). It owns client construction, one-time-token generation, certificate
signing flows, ACME issuance, and authority bootstrapping.

## Client construction: online vs offline

`CaClient` is the interface every CA-facing operation is built on. It covers
X.509 sign/renew/revoke/rekey, SSH sign/renew/rekey/revoke, SSH root and
federation retrieval, SSH config/host lookups, bastion lookup, version, and
root-pool access (`utils/cautils/client.go:29-48`).

`NewClient` selects the backend based on the `--offline` flag
(`utils/cautils/client.go:52-74`):

- **Offline** requires `--ca-config` and returns an `OfflineCA` instance that
  drives the step-ca `authority` package in-process, with no network.
- **Online** resolves the CA URL with `flags.ParseCaURL`, requires a root
  certificate (falling back to the default STEPPATH root via
  `pki.GetRootCAPath()`), and returns `ca.NewClient`.

Admin operations use dedicated constructors: `NewAdminClient` (mutating mgmt
API, with `--admin-cert`/`--admin-key` or an interactive token-generated admin
identity) and `NewUnauthenticatedAdminClient` (read-only, no credentials)
(`utils/cautils/client.go:76-203`).

## The certificate enrollment flow

`CertificateFlow` (`utils/cautils/certificate_flow.go:36-131`) orchestrates
enrollment. Options such as an existing CSR, an SSH public key, a confirmation
fingerprint, or custom attributes are written into a package-level
`sharedContext` (`flowContext`) so downstream token generation can see them.

- `GetClient` decides the CA endpoint. If the token carries a root `sha` claim
  and an HTTP audience, the CA URL is derived from the token and the client is
  pinned with `ca.WithRootSHA256`; otherwise `--ca-url` and a root file are
  required (`utils/cautils/certificate_flow.go:134-171`).
- `GenerateToken` produces a sign token: offline via `OfflineCA.GenerateToken`,
  online via `NewTokenFlow`, prompting for a subject when none is given.
- `Sign` builds an `api.SignRequest` (CSR, OTT, optional notBefore/notAfter and
  template data), calls `client.Sign`, and writes the returned certificate
  chain to disk mode `0o600` (`utils/cautils/certificate_flow.go:249-293`).
- `CreateSignRequest` generates a fresh key, builds a CSR, and derives SANs;
  cloud and OIDC token payloads influence the default SANs
  (`utils/cautils/certificate_flow.go:297-405`).

## One-time token flow

`NewTokenFlow` (`utils/cautils/token_flow.go:101-183`) is the common path for
generating a provisioning token. The audience is derived from `--ca-url` by
`parseAudience`, which maps each token type to an HTTPS path under `/1.0`
(`utils/cautils/token_flow.go:39-76`):

| Token type | Path |
|---|---|
| SignType | `/1.0/sign` |
| RenewType | `/1.0/renew` |
| RevokeType | `/1.0/revoke` |
| SSHUserSignType / SSHHostSignType | `/1.0/ssh/sign` |
| SSHRevokeType | `/1.0/ssh/revoke` |
| SSHRenewType | `/1.0/ssh/renew` |
| SSHRekeyType | `/1.0/ssh/rekey` |

Renew tokens are a special case: `NewTokenFlow` returns early and calls
`generateRenewToken`, which requires `--x5c-cert`/`--x5c-key` and builds a
token signed by the existing certificate key (`utils/cautils/token_generator.go:471-517`).

### Provisioner selection

For other token types the CA's provisioners are fetched
(`pki.GetProvisioners`) and filtered by flags in `provisionerPrompt`
(`utils/cautils/token_flow.go:291-408`):

- `--x5c-cert`/`--x5c-key` narrows to X5C provisioners; `--sshpop-*` to SSHPOP;
  `--nebula-*` to Nebula; `--k8ssa-token-path` to K8sSA.
- `--kid` filters JWK provisioners by key ID and OIDC provisioners by client ID.
- `--admin-provisioner` and `--provisioner`/`--issuer` filter by provisioner name.
- If multiple candidates remain, the user picks from an interactive selector;
  a single candidate is selected without prompting.

Each provisioner type then routes to a dedicated generator
(`utils/cautils/token_flow.go:154-182`, `utils/cautils/token_generator.go`):

- **JWK**: decrypt the provisioner signing key (from the offline config or the
  online CA) or use `--key`, then sign the JWT.
- **OIDC**: re-invokes the CLI itself (`step oauth --oidc --bare ...`) via
  `exec.Step` (`utils/cautils/token_generator.go:144-169`).
- **X5C**: JWT with an `x5c` header signed by the matching private key (or a
  KMS-backed key via `cryptoutil.CreateSigner`).
- **Nebula**: JWT with a `nebula` header carrying the Nebula certificate.
- **SSHPOP**: JWT with an `sshpop` header for renew/rekey/revoke tokens.
- **K8sSA**: reads the Kubernetes service account token file
  (`/var/run/secrets/kubernetes.io/serviceaccount/token` by default).
- **GCP/AWS/Azure**: fetches the cloud instance identity token.
- **ACME** and **SCEP**: rejected with `ACMETokenError`/`SCEPTokeError`
  because those provisioners do not support token auth flows
  (`utils/cautils/token_flow.go:78-98`).

`OfflineTokenFlow` (`utils/cautils/token_flow.go:212-273`) covers the offline
case: when `--ca-config` points at an existing `ca.json` it uses
`OfflineCA.GenerateToken`; otherwise it requires `--provisioner`/`--issuer`
plus `--key` (and optionally `--kid`) to build the token from flags.

## Offline CA

`OfflineCA` (`utils/cautils/offline.go:28-81`) wraps the step-ca
`authority.Authority` in a process-local singleton. It loads `ca.json` into a
`config.Config`, overrides the password from `--password-file`, and serves the
full `CaClient` surface by delegating to the authority's
`Authorize`/`Sign`/`Renew`/`Revoke`/`Rekey`/`SignSSH`/etc. methods. Notably its
`Audience` helper builds `https://<host>/sign`, `/revoke`, `/ssh/sign`, etc.
without the `/1.0` prefix used by the online `parseAudience`
(`utils/cautils/offline.go:140-158`).

## Bootstrap flow

`bootstrap` (`utils/cautils/bootstrap.go:98-222`) configures a client for an
authority given a CA URL and root fingerprint:

1. Creates an insecure `ca.NewClient`, downloads and validates the root via
   `client.Root(fingerprint)`.
2. If contexts are enabled (or `--context`/`--authority`/`--profile` set), adds
   and selects a context; otherwise warns that contexts exist.
3. Writes the root certificate to the STEPPATH certs directory (mode `0o600`)
   and a `defaults.json` with `ca-url`, `fingerprint`, and `root` (mode
   `0o644`), creating parent directories mode `0o700`.
4. Optionally installs the root into the system truststore with `--install`.

`BootstrapTeamAuthority` (`utils/cautils/bootstrap.go:226-294`) fetches
authority metadata from the Smallstep team API
(`https://api.smallstep.com/v1/teams/<team>/authorities/<authority>` by
default, overridable with `--team-url`), then calls `bootstrap`.
`BootstrapAuthority` bootstraps directly from `--ca-url` and `--fingerprint`
(`utils/cautils/bootstrap.go:297-317`).

## ACME flow

ACME issuance lives in `acme_flow.go` and `acmeutils.go`
(`utils/cautils/acme_flow.go:14-61`, `utils/cautils/acmeutils.go:625-865`):

- `ACMECreateCertFlow` / `ACMESignCSRFlow` drive a transaction to get a
  certificate from either a subject/SANs or an existing CSR.
- Offline mode and ACME are mutually exclusive; `--standalone` or `--webroot`
  must be selected (standalone is the default when neither is given).
- The ACME directory URL comes from `--acme` or is derived as
  `<ca-url>/acme/<provisioner>/directory`.
- `authorizeOrder` validates each identifier with an `http-01` challenge
  (standalone HTTP server or webroot file) or a `device-attest-01` challenge
  for attestation (`utils/cautils/acmeutils.go:196-232`).
- `finalizeOrder` polls the order for `ready` (before finalizing) and `valid`
  (after), up to 10 one-second attempts each (`utils/cautils/acmeutils.go:234-283`).
- `getChallengeStatus` polls challenge status up to 10 times and extracts
  detailed error messages from the ACME error/subproblems
  (`utils/cautils/acmeutils.go:518-583`).

Device attestation supports a TPM-backed flow (`tpmkms:` URIs) implemented in
`utils/cautils/tpm.go`, which enrolls a TPM Attestation Key with an Attestation
CA and binds the attested key to the ACME challenge token
(`utils/cautils/tpm.go:40-196`).

## Failure handling

- Token flows fail fast with typed errors for unsupported provisioners
  (`ACMETokenError`, `SCEPTokeError`) (`utils/cautils/token_flow.go:78-98`).
- Online clients require both `--ca-url` and a root; the CLI surfaces
  `errs.RequiredFlag`-style errors when they are missing
  (`utils/cautils/client.go:52-74`, `utils/cautils/certificate_flow.go:176-205`).
- ACME challenge and finalization steps are retried with bounded polling and
  return descriptive errors rather than hanging
  (`utils/cautils/acmeutils.go:234-283`, `518-549`).
