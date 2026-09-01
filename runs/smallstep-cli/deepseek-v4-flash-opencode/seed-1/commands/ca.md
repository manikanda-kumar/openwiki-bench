---
type: "Reference"
title: "step ca command group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-8fa5181432f9015e3fe5ac29
    resource: repo://command/ca/acme/acme.go
  - id: openwiki-source-567b7cca98d1eb42c96305c8
    resource: repo://command/ca/admin/admin.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-e0cfffd9e5ebd278d6cab5c2
    resource: repo://command/ca/provisioner/provisioner.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# step ca command group

`step ca` is the primary interface for initializing a Certificate Authority
configuration, connecting to a step-ca server (or an offline CA), requesting
and managing certificates, and administering provisioners and admins.

## Subcommand tree

The group registers `health`, `init`, `bootstrap`, `token`, `certificate`,
`rekey`, `renew`, `revoke`, `provisioner`, `sign`, `root`, `roots`,
`federation`, `acme`, `policy`, and `admin`
(`command/ca/ca.go:68-85`). Most of these delegate to the shared flows in
`utils/cautils` (see [CA client and enrollment flows](../architecture/ca-client-flows.md)).

## step ca init

`init` creates a new PKI (root and intermediate certificates) plus the CA
configuration consumed by step-ca (`command/ca/init.go:33-218`). Notable flags:

- **`--pki`** generates only the PKI, skipping CA configuration; `--ssh` adds
  SSH host/user signing keys; `--helm` emits a Helm values template instead of
  saving config.
- **`--deployment-type`** selects `standalone` (self-hosted step-ca), `linked`
  (locally managed keys with Smallstep cloud services), or `hosted`
  (fully-managed). When not given, the type is prompted or inferred as
  standalone when all required non-interactive flags are present
  (`command/ca/init.go:720-752`, `754-812`).
- **`--ra`** configures a Registration Authority: `StepCAS` (use an upstream
  step-ca) or `CloudCAS` (Google Cloud CAS); `--kms`/`--kms-root`/
  `--kms-intermediate`/`--kms-ssh-*` back keys with Azure Key Vault.
- **`--no-db`** omits the DB stanza; incompatible with `--remote-management`
  and `--acme` (both require DB-backed provisioners)
  (`command/ca/init.go:256-279`).
- **`--remote-management`** enables the Admin API and `--admin-subject`
  provisions a first super admin; **`--acme`** adds a default ACME provisioner
  (standalone deployments only).

The action validates flag combinations, collects name/DNS/address/provisioner
inputs (prompted or via flags), generates the root and intermediate
certificates, then calls `p.Save()` to write the CA configuration files
(`command/ca/init.go:220-718`).

## step ca bootstrap

`bootstrap` configures this client for an existing authority. It supports both
direct bootstrap from `--ca-url` and `--fingerprint` and team bootstrap via
`--team`/`--team-authority` (backed by `cautils.BootstrapAuthority` and
`cautils.BootstrapTeamAuthority`) (`command/ca/bootstrap.go`).

## step ca token

`token` mints one-time tokens. `tokenAction` selects the token type from flags:
`--revoke` → RevokeType, `--renew` → RenewType, `--rekey` → RekeyType,
`--ssh` (+`--host`, `--principal`, or `--revoke`/`--renew`/`--rekey`) → the SSH
token types, otherwise SignType (`command/ca/token.go:318-344`). It also wires
proof-of-possession options: `--cnf-file` (a CSR or SSH public key) or `--cnf`
(fingerprint), plus template data via `--set`/`--set-file`
(`command/ca/token.go:359-405`). Offline mode routes to
`cautils.OfflineTokenFlow`; otherwise `cautils.NewTokenFlow`
(`command/ca/token.go:427-438`).

## Certificate operations

- **`step ca certificate`** generates a key pair and signs a certificate.
  `--offline` and `--token` are mutually exclusive; an `--acme` directory URL
  switches to the ACME flow, and an `ACMETokenError` from the token flow also
  triggers ACME issuance (`command/ca/certificate.go:238-268`). The token's
  type is validated before signing: JWK tokens must match the subject and
  forbid combining `--token` with `--san`, while OIDC/cloud/K8sSA subjects are
  validated server-side (`command/ca/certificate.go:280-293`).
- **`step ca sign`** signs an existing CSR with a token
  (`command/ca/sign.go:21-34`).
- **`step ca renew`** renews a certificate, by default over mTLS; when the
  certificate is expired (renew-after-expiry) or `--mtls=false` is passed it
  falls back to an X5C-token flow (`command/ca/renew.go:482-507`). Daemon mode
  (`--daemon`) periodically renews, defaulting to before 2/3 of the validity
  has elapsed, with jitter, and can signal a PID (`--pid`/`--pid-file`,
  `--signal`, default SIGHUP) or run `--exec` after each renewal
  (`command/ca/renew.go:354-380`, `586-619`). `--expires-in` and
  `--renew-period` must be shorter than the certificate's validity period
  (`command/ca/renew.go:313-321`).
- **`step ca revoke`** performs passive revocation (prevents renewal, lets the
  certificate expire). It accepts a serial number (with a transparently
  generated JWK token), a pre-generated `--token`, or `--cert`/`--key` for
  mTLS-based authorization, and maps `--reasonCode` strings to RFC 5280 OCSP
  codes (`command/ca/revoke.go:210-285`, `483-522`).

## step ca root / roots / federation

`root` downloads the root certificate by fingerprint, `roots` returns the root
bundle, and `federation` retrieves federated roots.

## Provisioner management

`step ca provisioner` provides `list`, `jwe-key`, `add`, `update`, `remove`,
and `webhook` subcommands (`command/ca/provisioner/provisioner.go:26-96`).
Supported provisioner types include JWK, OIDC, AWS, GCP, Azure, ACME, X5C,
K8SSA, SSHPOP, SCEP, and Nebula (`command/ca/provisioner/provisioner.go:268-307`).

The CRUD client is selected dynamically in `newCRUDClient`: it first probes the
Admin API with an unauthenticated client; if the API is not implemented it
falls back to editing `ca.json` directly via `caConfigClient` (with validation
skipped), and if the API requires authorization it upgrades to
`cautils.NewAdminClient` (`command/ca/provisioner/provisioner.go:105-132`).

## Admin management

`step ca admin` provides `list`, `add`, `remove`, and `update` for admin
identities (entities that manage authority/provisioner configuration)
(`command/ca/admin/admin.go:16-56`). Admin records reference a provisioner by
ID; the CLI resolves provisioner names when listing (`command/ca/admin/admin.go:74-94`).

## Policy and ACME management

- `step ca policy` manages certificate policies at the authority, provisioner,
  and ACME levels (x509, SSH, and action policy trees under
  `command/ca/policy/`).
- `step ca acme` currently exposes ACME external account binding (EAB) via the
  `eab` subcommand (`command/ca/acme/acme.go:10-19`).

## Configuration files

Commands that operate against a CA read `--ca-config` (default
`$STEPPATH/config/ca.json`) for offline mode and the root certificate and
`defaults.json` for online defaults. `step ca init` writes these files; see
the bootstrap flow for their exact contents
([CA client and enrollment flows](../architecture/ca-client-flows.md)).
