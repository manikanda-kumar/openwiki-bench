---
type: "Reference"
title: "Ca integration"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-567b7cca98d1eb42c96305c8
    resource: repo://command/ca/admin/admin.go
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-a419e83392119424b6cfae48
    resource: repo://command/ca/provisioner/add.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-976947cfd6258da1cc5693a8
    resource: repo://utils/cautils/acme_flow.go
  - id: openwiki-source-aecab703e3710c5764638ff5
    resource: repo://utils/cautils/acmeutils.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---


## Responsibility

The `step ca` command group administers and uses a `step-ca` server (or any
ACMEv2/RFC8555-compliant CA), and the CA helper package `utils/cautils` provides
the shared client and flow logic backing it. This page documents how the CLI
builds clients, generates one-time tokens (OTTs) for provisioner-based
authentication, bootstraps relying-party configuration, performs the ACME and
offline flows, and manages admins and provisioners.

## The CA command group

The `ca` group ([`command/ca/ca.go`](../../command/ca/ca.go)) registers
subcommands: `health`, `init`, `bootstrap`, `token`, `certificate`, `rekey`,
`renew`, `revoke`, `provisioner`, `sign`, `root`, `roots`, `federation`, `acme`,
`policy`, and `admin`. It also defines shared flags used by several commands,
including ACME flags (`--acme`, `--contact`, `--http-listen`, `--standalone`,
`--webroot`), a `--fingerprint` flag, a `--kid` flag, and an `--ssh-host` flag.

## Clients: online and offline

[`utils/cautils/client.go`](../../utils/cautils/client.go) defines the
`CaClient` interface implemented by certificate clients and used to sign, renew,
revoke, rekey, and manage SSH certificates. `NewClient(ctx, opts...)` is the
factory that returns either an online client or an offline one:

- When `--offline` is set, it requires a `--ca-config` file and returns an
  `OfflineCA` via `NewOfflineCA`.
- Otherwise it parses the CA URL (`flags.ParseCaURL`), resolves the root
  certificate (`--root` or the default `pki.GetRootCAPath()`), and returns
  `ca.NewClient(caURL, ...)` from `github.com/smallstep/certificates`.

The `CaClient` interface exposes methods covering the full lifecycle: `Sign`,
`Renew`, `RenewWithToken`, `Revoke`, `Rekey`, SSH signing/renew/rekey/revoke,
roots/federation/config/check-host/hosts/bastion queries, `Version`, `GetRootCAs`,
and `GetCaURL`.

`utils/cautils/client.go` also provides admin clients:

- `NewUnauthenticatedAdminClient` returns a `ca.AdminClient` for the mgmt API.
- `NewAdminClient` builds an admin client. When `--admin-cert`/`--admin-key`
  are given it reads them via `pemutil`; otherwise it prints an advisory, runs a
  full token flow as the admin subject, and obtains a fresh admin certificate
  and key (used to authenticate the admin client via X5C).

## Token flow

[`utils/cautils/token_flow.go`](../../utils/cautils/token_flow.go) implements
the one-time token generation used by `step ca token` and invoked by many other
flows. Key pieces:

- `parseAudience` resolves the CA URL and computes the JWT `aud` audience by
  mapping a token type (sign, renew, revoke, SSH sign/revoke/renew/rekey) to a
  `/1.0/*` path (e.g. `/1.0/sign`). The scheme is forced to `https`.
- `NewTokenFlow` computes the audience, and for X.509 renew uses a special
  `generateRenewToken`. For everything else it loads provisioners from the CA
  (`pki.GetProvisioners(caURL, root)`), selects one via `provisionerPrompt`, and
  dispatches by the provisioner's concrete type:
  - `*provisioner.JWK`: `generateJWKToken` (the standard step JWT).
  - `*provisioner.OIDC`: `generateOIDCToken` (runs `step oauth`).
  - `*provisioner.X5C`: `generateX5CToken` (JWT with an X5C header + signature).
  - `*provisioner.Nebula`: `generateNebulaToken`.
  - `*provisioner.SSHPOP`: `generateSSHPOPToken` (using an SSH cert + key).
  - `*provisioner.K8sSA`: `generateK8sSAToken`.
  - `*provisioner.GCP`, `*provisioner.AWS`, `*provisioner.Azure`:
    `p.GetIdentityToken(subject, caURL)`.
  - `*provisioner.ACME` and `*provisioner.SCEP`: return `ACMETokenError` /
    `SCEPTokenError` because those provisioners do not support token auth flows.
- `provisionerPrompt` narrows the provisioner list by flags (`--x5c-cert`/`--x5c-key`,
  `--sshpop-cert`/`--sshpop-key`, `--nebula-cert`/`--nebula-key`,
  `--k8ssa-token-path`, `--kid`, `--admin-provisioner`, `--provisioner`/`--issuer`),
  prints a selection when more than one candidate exists (using `cli-utils/ui`),
  and returns the chosen `provisioner.Interface`.

`NewIdentityTokenFlow` is the OIDC-only variant used by the bootstrap flow.

## Offline mode

[`utils/cautils/offline.go`](../../utils/cautils/offline.go) implements signing
without an online CA. `OfflineCA` wraps the certificates authority methods. A
package-level singleton (`offlineInstance`) avoids double initialization because
some backends (e.g. BadgerDB) lock on double init. `NewOfflineCA` reads the
`--ca-config` (default `$STEPPATH/config/ca.json`, created by `step ca init`),
validates that it has an authority config with provisioners, and builds an
in-process `authority.Authority`. `OfflineTokenFlow` in `token_flow.go`
generates a provisioning token from either static `ca.json` config or from
command-line flags (which are mutually exclusive), using `generateJWKToken` or
`generateX5CToken`.

## Bootstrap

[`utils/cautils/bootstrap.go`](../../utils/cautils/bootstrap.go) and
[`command/ca/bootstrap.go`](../../command/ca/bootstrap.go) implement
`step ca bootstrap`, which downloads and validates the root certificate and
writes the environment configuration so downstream `step ca` commands no longer
need `--ca-url`/`--root`/`--fingerprint`:

- The client is created with `ca.WithInsecure()` because the root is validated
  by fingerprint rather than a pre-trusted chain; `client.Root(fingerprint)`
  both downloads and validates the root.
- If contexts are enabled (or `--context`/`--authority`/`--profile` set), a new
  context/profile/authority is created and saved as current via
  `step.Contexts()`. Otherwise `WarnContext` advises the user they could use
  contexts.
- The root is written to `pki.GetRootCAPath()` (root_ca.crt) with mode `0600`
  and a `bootstrapConfig` (ca-url, fingerprint, root, optional redirect-url,
  provisioner, min-password-length) is written to `step.DefaultsFile()`
  (defaults.json).
- With `--install`, the root is installed into the system truststore via
  `truststore.InstallFile`.
- `BootstrapTeamAuthority` queries `api.smallstep.com` (or `--team-url`) for the
  authority config of a team, then delegates to `bootstrap`. `BootstrapAuthority`
  builds the default context name from the CA host and calls `bootstrap`.

The `bootstrapAction` in `command/ca/bootstrap.go` validates that `--team`,
`--ca-url`, and `--fingerprint` are not mixed incompatibly discriminating
standalone vs. team bootstrap.

## OTT generation and certificate lifecycle

`step ca token` ([`command/ca/token.go`](../../command/ca/token.go)) generates a
one-time token granting access to the CA; the subject becomes the Common
Name/DNS/IP, and absent additional SANs the subject is the only `sans` claim on
the token Mend the audience derived from `--ca-url`. The encoded OTT is then used
by the signing, SSH, renew, and revoke flows.

`step ca certificate` ([`command/ca/certificate.go`](../../command/ca/certificate.go))
generates a new private key and certificate using a token, optionally signing a
CSR. `step ca sign` ([`command/ca/sign.go`](../../command/ca/sign.go)) signs a
given CSR. `step ca renew` ([`command/ca/renew.go`](../../command/ca/renew.go))
renews a certificate to disk, with daemon mode that periodically renews before
2/3 of the validity period (with jitter), optionally reloading services
(`--pid`, `--signal`, `--exec`); renewal may use mTLS by default or X5C token
authentication when `--mtls=false`. `step ca revoke`
([`command/ca/revoke.go`](../../command/ca/revoke.go)) currently supports only
passive revocation (preventing renewal; CRL/OCSP support is TODO).

`step ca root` ([`command/ca/root.go`](../../command/ca/root.go)) downloads and
validates the root certificate by fingerprint and writes it to a file or prints
it.

## CA initialization

`step ca init` ([`command/ca/init.go`](../../command/ca/init.go)) initializes a
PKI for use by the CA through `github.com/smallstep/certificates/pki`. It
supports generating only the PKI (`--pki`), SSH keys (`--ssh`), a Helm values
YAML (`--helm`), deployment types (`--deployment-type`), DNS/address/provisioner
configuration, KMS-backed keys, and password handling. The resulting
configuration and root/intermediate keys are stored under `$STEPPATH`.

## ACME flows

[`utils/cautils/acmeutils.go`](../../utils/cautils/acmeutils.go) implements the
ACME client mechanics, including an ACME challenge HTTP server
(`startHTTPServer`) that serves the `/.well-known/acme-challenge/<token>`
endpoint for standalone mode)Skip (`--standalone`, default `:80`), plus webroot
and attestation (TPM/etc.) modes, EAB provisioning, and key/CSR signing.

`utils/cautils/acme_flow.go` provides two higher-level helpers:

- `ACMECreateCertFlow`: performs an ACME transaction to obtain a certificate for
  a subject/SANsholn, writing the certificate and private key (unless the key
  lives at an `--attestation-uri`).
- `ACMESignCSRFlow`: performs an ACME transaction using an existing CSR.

These are exposed through `step ca certificate`/`step ca sign` when an ACME
provisioner (`--acme`) or a standalone/webroot mode is selected.

## Admin and provisioner management

The `step ca admin` group ([`command/ca/admin/admin.go`](../../command/ca/admin/admin.go))
manages CA admins (entities that manage authority/provisioner configuration and
admins), with subcommands `list`, `add`, `remove`, `update`. It filters admins by
subject and provisioner and maps admin objects through the linkedca types,
delegating to `ca.AdminClient` for persistence.

`step ca provisioner` ([`command/ca/provisioner/add.go`](../../command/ca/provisioner/add.go),
etc.) manages provisioners of every type (JWK, ACME, OIDC, X5C, SSHPOP, K8sSA,
cloud identity, ...). The `add` command supports `--type`, `--create`,
public/private key files, password files, X509/SSH templates, admin credentials,
and ACME/OIDC-specific flags)Skip(see also `provisioner.go`, `update.go`,
`remove.go`, `caConfigClient.go`, `getEncryptedKey.go`, and the `webhook` and
policy subpackages). `step ca policy`
<!-- openwiki: broken internal link [../../command/ca/policy] file "../../command/ca/policy" does not exist. Fix the href or restore the target, then delete this comment. -->
([`command/ca/policy`](../../command/ca/policy)) manages X509/SSH/ACME
issuance-policy allow/deny rules.

## Relationships

The flows here depend on the [token and claim construction](token-claim.md)
package for the OTT format, reuse the shared flags in [architecture](architecture.md),
and feed the [SSH integration](ssh-integration.md) for SSH certificate
lifecycle. The certificate-group page ([certificate-command-group.md](certificate-command-group.md))
covers standalone X.509 operations outside the CA.
