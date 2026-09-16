---
type: flows
title: "Offline CA: step ca init and OfflineCA"
description: "step ca init (flag validation matrix, StepCAS/CloudCAS registration authorities, azurekms options, deployment types, generated PKI and ca.json) and the OfflineCA process singleton wrapping the step-ca authority in-process (Sign/Renew/Revoke/SSH semantics and the TLS-transport mTLS carrier trick)."
tags: [offline, ca-init, pki, registration-authority, deployment, badger, mtls, tpm]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-57d7d8b1ea53edb457db35b8
    resource: repo://utils/cautils/tpm.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

## `step ca init`

Initializes a PKI and CA configuration under the step path (`$STEPPATH`). The action begins with `assertCryptoRand` — a 64-byte `crypto/rand` read that aborts with `crypto/rand is unavailable` before any material is generated (`command/ca/init.go:220-223,814-823`).

### Flag validation matrix (exactly as coded, `command/ca/init.go:240-279`)

| Condition | Error |
|---|---|
| `--root` without `--key` | `RequiredWithFlag(root, key)` |
| `--key` without `--root` | `RequiredWithFlag(key, root)` |
| `--root` + `--key` | both are read (key optionally via `--key-password-file`) |
| `--ra` not in {`StepCAS`, `CloudCAS`} (case-insensitive) | `InvalidFlagValue(ra, ..., "StepCAS or CloudCAS")` |
| `--kms` not `azurekms` | `InvalidFlagValue(kms, ..., "azurekms")` |
| `--kms` + `--ra` | `IncompatibleFlagWithFlag` |
| `--pki` + `--no-db` | `IncompatibleFlagWithFlag` |
| `--pki` + `--helm` | `IncompatibleFlagWithFlag` |
| `--remote-management` + `--no-db` | `IncompatibleFlagWithFlag` (Admin API needs a DB) |
| `--acme` + `--no-db` | `IncompatibleFlagWithFlag` (ACME needs a DB) |
| `--admin-subject` + `--helm` | `IncompatibleFlagWithFlag` |
| `--admin-subject` without `--remote-management` | plain error: only supported with `--remote-management` |

### Registration authority variants

- **No `--ra` (SoftCAS, default)**: the PKI is created locally (`apiv1.SoftCAS`, `IsCreator: true`) (`command/ca/init.go:523-527`). With `--kms azurekms`, URIs are collected for the root, intermediate, and (with `--ssh`) SSH host/user keys through `kms.New` and passed as `pki.WithKMS("azurekms")` + `pki.WithKeyURIs(...)` (`command/ca/init.go:462-518`).
- **`--ra StepCAS`**: registers against an existing step CA — prompts (or flags) for the CA URL (validated `^https://`), the root fingerprint (64 hex), and a JWK provisioner name; options carry `IsCAGetter: true` and a `CertificateIssuer{Type: "JWK", Provisioner: ...}` (`command/ca/init.go:399-432`). The local PKI's root is fetched from the remote CA via `p.GetCertificateAuthority()` instead of being generated.
- **`--ra CloudCAS`**: Google Cloud CA integration — either create a new CA pool (prompts for PKI name, org, resource id, GCP project `^[a-z][a-z0-9-]{4,28}[a-z0-9]$`, location, CA pool name, tier **DevOps/Enterprise**, optional GCS bucket) or use an existing `projects/.../certificateAuthorities/...` resource name; `--credentials-file` supplies the service account key (`command/ca/init.go:311-398`).

### Deployment types (`command/ca/init.go:754-812`)

`standalone` (self-run step-ca), `linked` (standalone plus cloud configuration/reporting), `hosted` (fully managed; RA mode only allows standalone/linked). Choosing **hosted** in non-RA mode prints a pointer to `https://u.step.sm/hosted` and `step ca bootstrap --team <name> --authority <authority>` and returns without generating anything (`command/ca/init.go:438-447`). A non-interactive `standalone` is assumed when all required flags are present (`isNonInteractiveInit`, `command/ca/init.go:720-752`: pki flags `name`/`password-file`, or `issuer` for CloudCAS, `issuer`+`issuer-fingerprint`+`issuer-provisioner` for StepCAS; plus `dns`/`address`/`provisioner` unless `--pki`).

### What gets generated (`command/ca/init.go:649-717`)

1. `pki.New(casOptions, pkiOpts...)` builds the PKI. `pkiOpts` map the flags: `WithAddress`, `WithCaURL` (`--with-ca-url`, written into `defaults.json`), `WithDNSNames` (parsed/normalized by `processDNSValue`, which converts `[::1]`-style brackets to IPs), `WithDeploymentType`; standalone adds `WithProvisioner` + `WithSuperAdminSubject`; linked adds `WithAdmin`; non-linked `--ssh` adds `WithSSH`; plus `WithNoDB`, `WithHelm`, `WithACME` (standalone only — linked CAs error earlier telling you to use `step ca provisioner add acme --type ACME`) (`command/ca/init.go:597-633`).
2. One password prompt (or `--password-file`): RA mode uses it only for the first provisioner; a standalone PKI uses it for the CA keys and first provisioner unless `--provisioner-password-file` splits them.
3. `p.GenerateKeyPairs(pass)` — provisioner key pairs, standalone deployments only (linked/hosted deploy via an OIDC token first) (`command/ca/init.go:584-670`).
4. Creator mode: `p.GenerateRootCertificate(name, org, resource, pass)` — or, if `--root`/`--key` were supplied, `p.WriteRootCertificate(rootCrt, nil, nil)` (the comment is explicit: *"Do not copy key in STEPPATH"*), then `p.GenerateIntermediateCertificate(...)` (a 1s sleep keeps the timestamps strictly ordered) (`command/ca/init.go:672-700`).
5. `--ssh` → `p.GenerateSSHSigningKeys(pass)` (user + host CA keys).
6. Output: `--helm` streams a Helm values template to STDOUT (`p.WriteHelmTemplate`); otherwise `p.Save()` persists the CA configuration (`ca.json` with the provisioner stanza) and the PKI files (root/intermediate certs and keys) under the step path via the external `smallstep/certificates/pki` package.

With contexts enabled, `init` also creates and selects a context named after the first DNS name (`command/ca/init.go:544-570`).

## `OfflineCA` (`utils/cautils/offline.go`)

`OfflineCA` implements the same `CaClient` interface as the online client so command code has one API for both modes. It embeds an in-process `*authority.Authority` from the `smallstep/certificates` core.

- **Process singleton** (`offline.go:36-81`): `offlineInstance` is global. The comment states the singleton is *"necessary to avoid double initialization. Double initializations are sometimes not possible due to locks - as seen in badgerDB"*. Consequences: only one `ca-config` per process — the first `NewOfflineCA` call wins and subsequent calls (even with a different config path) return the cached instance; a badger-backed DB can only be opened once. A separate `step` subprocess (e.g. the `step oauth` spawned for OIDC tokens) is unaffected since it has its own process.
- **Initialization**: reads the config (via `utils.ReadFile`, so `-` reads STDIN), unmarshals `config.Config`, requires a non-empty `AuthorityConfig.Provisioners` (`no provisioners found` otherwise), applies `--password-file` to `cfg.Password`, then `authority.New(&cfg)`.
- **Identity**: `GetCaURL()`/`CaURL()` are `https://<first DNS name>` (IPv6 bracketed by `toHostname`); `Audience(tokType)` mirrors the online audiences — `/sign`, `/renew`, `/revoke`, `/ssh/sign`, `/ssh/renew`, `/ssh/revoke`, `/ssh/rekey` — derived from the same first DNS name (`offline.go:83-173`). `GetRootCAs()` always returns `nil`; `Root()` is `config.Root.First()`.
- **Sign**: `Authorize(ctx, OTT)` then `SignWithContext` with the request's not-before/not-after and template data; the response includes the chain, `CaPEM` (second element when present), and the authority's `TLSOptions` (`offline.go:196-222`).
- **The TLS-transport mTLS trick**: `Renew`, `Revoke` (without OTT), and `Rekey` receive the caller's `http.RoundTripper` — part of the shared `CaClient` interface — and recover the presenting client certificate from `tr.TLSClientConfig.Certificates[0]`, with the comment *"it should not panic as this is always internal code"* (`offline.go:226-250,279-313,316-341`). The transport exists for real: `newRenewer` in `command/ca/renew.go` builds an `http.Transport` whose `TLSClientConfig` carries the client certificate whenever the cert is not yet expired (`renew.go:425-479`), and passes that same transport to the offline client. So the certificate travels through the TLS transport object rather than an extra interface parameter, keeping online and offline call sites identical. `Renew` falls back to the token path (`RenewWithToken`, an x5c renew token that clears the transport cert) when `--mtls` is off or the cert is expired (`renew.go:482-498,624-653`).
- **Revoke with OTT** uses `Authorize` + `MTLS: false`; without OTT it parses the transport cert and sets `MTLS: true` (`offline.go:279-313`).
- **SSH surface**: `SSHSign` (Authorize + `SignSSH`), `SSHRevoke` (Authorize + `Revoke`), `SSHRenew`/`SSHRekey` (extract the old SSHPOP cert from the OTT, then `RenewSSH`/`RekeySSH`), plus `SSHRoots`, `SSHFederation`, `SSHConfig` (user/host templates), `SSHCheckHost`, `SSHGetHosts`, `SSHBastion` (`offline.go:345-536`).
- **VerifyClientCert**: loads a cert/key pair, checks they match via `tls.X509KeyPair`, then verifies the cert against the offline root and intermediate pools (`offline.go:94-138`) — the check behind offline admin commands that take `--cert`/`--key`.
- **GenerateToken** (`offline.go:539-599`): identical per-provisioner generators as the online flow, but the provisioner list comes from `ca.json` and root/audience from the config. Notably the default branch is JWK (any provisioner type that is not OIDC/X5C/SSHPOP/Nebula/K8sSA/GCP/AWS/Azure/ACME/SCEP is required to be a JWK provisioner), and ACME/SCEP still return their token-flow errors.

## TPM attestation (`utils/cautils/tpm.go`)

For ACME flows with `--attestation-uri` pointing at a `tpmkms` key: `parseTPMAttestationURI` decodes the URI; `getAK` looks for an attestation key (AK) whose certificate includes the EK public-key ID as a URI SAN, creating a new AK and enrolling it with the Attestation CA when none is valid (`tpm.go:198-290`); `attestationStatement` builds the `tpm`-format ACME attestation object and `doTPMAttestation` drives the ACME challenge end to end (`tpm.go:40-197`). `getPreferredEK` prefers the first RSA EK, then ECDSA (`tpm.go:395-409`). The `--tpm-storage-directory` flag (default `<step path>/tpm`) is where TPM keys/certs are stored by the ACME flow.
