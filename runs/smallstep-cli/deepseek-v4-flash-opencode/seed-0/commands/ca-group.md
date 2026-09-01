---
type: "Reference"
title: "The step ca Command Group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-8fa5181432f9015e3fe5ac29
    resource: repo://command/ca/acme/acme.go
  - id: openwiki-source-567b7cca98d1eb42c96305c8
    resource: repo://command/ca/admin/admin.go
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-4871c514390de4c3447b7738
    resource: repo://command/ca/federation.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-1eb895615a355761cf5df664
    resource: repo://command/ca/policy/policy.go
  - id: openwiki-source-e0cfffd9e5ebd278d6cab5c2
    resource: repo://command/ca/provisioner/provisioner.go
  - id: openwiki-source-5cb498dbff5a2aba7f81df22
    resource: repo://command/ca/rekey.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-bd45ebb80f1a74f84552aea9
    resource: repo://command/ca/root.go
  - id: openwiki-source-ff8a7fe9f3a4815e9b6b5c30
    resource: repo://command/ca/sign.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---


# The step ca Command Group

`step ca` is the interface between the CLI and a Certificate Authority (an
online `step-ca` server, an ACME server, or a local offline CA configured by
`step ca init`). It registers the subcommands `health`, `init`, `bootstrap`,
`token`, `certificate`, `rekey`, `renew`, `revoke`, `provisioner`, `sign`,
`root`, `roots`, `federation`, `acme`, `policy`, and `admin`.

Shared flags defined by the group include the ACME flags (`--acme`,
`--standalone`, `--webroot`, `--http-listen`, `--contact`), `--fingerprint`,
and `--kid`. The mechanics of the shared flows are described in
[CA Client and Certificate Flows](../ca/ca-client-and-flows.md),
[Provisioning Tokens](../ca/provisioning-tokens.md), and
[ACME and Bootstrap Flows](../ca/acme-and-bootstrap.md).

## init

`step ca init` creates a complete PKI and the step-ca configuration (root and
intermediate certificates, the first provisioner, `ca.json`). Flags control
whether SSH signing keys are created (`--ssh`), whether a Helm values file is
emitted (`--helm`), the deployment type (`--deployment-type`: `standalone`,
`linked`, `hosted`), KMS-backed keys (`--kms`), `--remote-management`,
`--acme`, and context/profile/authority values. `--pki` generates only the PKI
without the CA configuration.

## bootstrap

`step ca bootstrap` configures the current machine to trust and reach a CA. It
either uses `--ca-url` + `--fingerprint` directly, or a team flow with `--team`
(and optional `--team-authority`/`--team-url`/`--redirect-url`). `--team` is
incompatible with `--ca-url` and `--fingerprint`. The command delegates to
`cautils.BootstrapAuthority`/`BootstrapTeamAuthority`, which download and
fingerprint-validate the root, write `$STEPPATH/certs/root_ca.crt` and
`$STEPPATH/config/defaults.json`, and optionally install the root into the
system trust store with `--install`.

## token

`step ca token <subject>` mints a one-time token. The token *type* is chosen by
flags: `--revoke`, `--renew`, `--rekey`, `--ssh`, `--host`, and `--principal`
(for SSH user/host/revoke/renew/rekey tokens). Flag validation rejects invalid
combinations (e.g. `--ssh` with `--san`, `--host` without `--ssh`,
`--cnf` with `--cnf-file`, `--san` with `--revoke`). Confirmation claims can be
attached with `--cnf` (fingerprint) or `--cnf-file` (CSR or SSH public key);
custom template data goes in the `user` claim via `--set`/`--set-file`. The
token is printed to stdout or written to `--output-file` with `0600`.

## certificate

`step ca certificate <subject> <crt-file> <key-file>` generates a fresh private
key and a CA-signed certificate. When no `--token` is given, it either runs the
ACME flow (`--acme`, or when token generation fails with `ACMETokenError`) or
generates a token through `GenerateToken`. It then builds the CSR with
`CreateSignRequest`, verifies the token subject matches the CSR common name for
JWK tokens, signs through the `CertificateFlow`, and writes the certificate and
key (`0600`). `--offline` and `--token` are mutually exclusive.

## sign

`step ca sign <csr-file> <crt-file>` signs an existing CSR. It reads and
signature-checks the CSR, validates the token subject against the CSR common
name (skipped for OIDC/AWS/GCP/Azure/K8sSA tokens), and signs via the
`CertificateFlow`. ACME is supported with `--acme` or an ACME provisioner
(`ACMESignCSRFlow`).

## renew

`step ca renew <crt-file> <key-file>` renews a certificate. By default it
authenticates with **mTLS** (`--mtls=true`); when mTLS is disabled or the
certificate is already expired it falls back to a token flow
(`RenewWithToken`) that builds an x5c token from the certificate being renewed.

- Single-shot mode skips renewal when the certificate expires further out than
  `--expires-in` (plus a random jitter of `expires-in/20`).
- `--daemon` mode renews periodically: by default before 2/3 of the validity
  elapses, or per `--renew-period`/`--expires-in`. On renewal it can signal a
  PID (`--pid`/`--pid-file`/`--signal`, default SIGHUP) and/or run a command
  (`--exec`).
- KMS-backed keys are supported via `--kms`.

## rekey

`step ca rekey <crt-file> <key-file>` issues a new certificate under a new key
(taken from `--private-key` or freshly generated). Expired certificates cannot
be rekeyed. It reuses the `renewer` daemon machinery (`--daemon`,
`--expires-in`, `--rekey-period`, `--pid`, `--signal`, `--exec`). When a KMS
key is involved, `--private-key` is required and `--out-key`/`--daemon` are
rejected.

## revoke

`step ca revoke` performs **passive revocation** (the certificate cannot be
renewed but remains valid until expiry; CRL/OCSP are noted as TODO). It accepts
a serial number with a transparently generated JWK token (any JWK provisioner
can revoke any certificate), a pre-generated `--token`, or the certificate plus
key (`--cert`/`--key`) over mTLS. `--reason`/`--reasonCode` map to RFC 5280
reason codes through `ReasonCodeToNum`. Certificates issued by OIDC
provisioners cannot be revoked by serial number.

## root, roots, federation, health

- `step ca root [<root-file>]` downloads and validates the root certificate by
  fingerprint, saving it (0600) or printing it.
- `step ca roots [<roots-file>]` and `step ca federation [<federation-file>]`
  download the full root bundle or the federation bundle.
- `step ca health` calls the CA `/health` endpoint and prints `ok`.

## provisioner

`step ca provisioner` manages provisioners (list, add, update, remove,
get-encrypted-key, and `webhook`). It prefers the linkedca **admin API**
through an unauthenticated or authenticated admin client, and falls back to
editing `ca.json` directly (`caConfigClient`) when the admin API is not
implemented or unreachable. Supported provisioner types are JWK, OIDC, AWS,
GCP, Azure, ACME, X5C, K8sSA, SSHPOP, SCEP, and Nebula, with type-specific
flags (e.g. `--aws-account`, `--azure-tenant`, `--gcp-project`,
`--oidc-client-id`, `--nebula-root`, ACME `--challenge`/`--require-eab`).

## admin

`step ca admin` manages CA admins (list, add, remove, update) through the
linkedca `AdminClient`, filtering by subject and provisioner.

## policy

`step ca policy` manages certificate issuance policies at the authority,
provisioner, and ACME levels.

## acme

`step ca acme eab` manages ACME external account binding keys. The `acme`
group is also exposed under `step beta ca acme` for testing new APIs.

## Relationship to other pages

- Flows: [CA Client and Certificate Flows](../ca/ca-client-and-flows.md),
  [Provisioning Tokens](../ca/provisioning-tokens.md),
  [ACME and Bootstrap Flows](../ca/acme-and-bootstrap.md).
- Offline CA configuration lives under
  [STEPPATH, Configuration, and Contexts](../architecture/step-path-and-contexts.md).
