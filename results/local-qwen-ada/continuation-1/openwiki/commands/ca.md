---
type: "Reference"
title: "`step ca` command group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
sources:
  - id: openwiki-source-531f7a4638bb6c96bc20c64d
    resource: repo://command/beta/beta.go
  - id: openwiki-source-1a7471403e4089cff22dda24
    resource: repo://command/ca/admin/add.go
  - id: openwiki-source-567b7cca98d1eb42c96305c8
    resource: repo://command/ca/admin/admin.go
  - id: openwiki-source-d82ba690a258bfd504770f1e
    resource: repo://command/ca/admin/list.go
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-4871c514390de4c3447b7738
    resource: repo://command/ca/federation.go
  - id: openwiki-source-b1fd6484864a367818d3ab86
    resource: repo://command/ca/health.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-818d5df4a4906e04dfb01229
    resource: repo://command/ca/policy/acme/acme.go
  - id: openwiki-source-9ca10d5f3a3bf6abbc2f7390
    resource: repo://command/ca/policy/actions/cn.go
  - id: openwiki-source-0bc0ddb0bb8176e70e041b4c
    resource: repo://command/ca/policy/actions/policy.go
  - id: openwiki-source-b027951d2b7fc5fd6a53fa0c
    resource: repo://command/ca/policy/actions/remove.go
  - id: openwiki-source-ca130e4b4a07de61dad83bda
    resource: repo://command/ca/policy/actions/view.go
  - id: openwiki-source-9a07a6a9b76f74e45c1b8b51
    resource: repo://command/ca/policy/authority/authority.go
  - id: openwiki-source-1eb895615a355761cf5df664
    resource: repo://command/ca/policy/policy.go
  - id: openwiki-source-98cf9c9e3d8bea43005210de
    resource: repo://command/ca/policy/policycontext/context.go
  - id: openwiki-source-2713e8167d25f5780b6cc3ad
    resource: repo://command/ca/policy/provisioner/provisioner.go
  - id: openwiki-source-972ad340e7a998c158c8bf28
    resource: repo://command/ca/policy/ssh/ssh.go
  - id: openwiki-source-6808df09eaabb2069b551d3a
    resource: repo://command/ca/policy/x509/allow.go
  - id: openwiki-source-eba103ad6a513f7a5167acf9
    resource: repo://command/ca/policy/x509/x509.go
  - id: openwiki-source-a419e83392119424b6cfae48
    resource: repo://command/ca/provisioner/add.go
  - id: openwiki-source-f8b0310182aba502aaa1d18a
    resource: repo://command/ca/provisioner/getEncryptedKey.go
  - id: openwiki-source-e0cfffd9e5ebd278d6cab5c2
    resource: repo://command/ca/provisioner/provisioner.go
  - id: openwiki-source-fb2c9482bc847805ca5f7524
    resource: repo://command/ca/provisioner/webhook/webhook.go
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
generated: { by: "opencode", at: "2026-09-14T13:44:47.469Z" }
---

# `step ca` command group

The `step ca` group is the primary surface for initializing and managing a certificate authority from the CLI. It is registered in `command/ca/ca.go` (`command/ca/ca.go:15-89`), which declares the `ca` command, assembles its subcommands, and calls `command.Register` in `init()`.

## Subcommands

| Command | Source | Purpose |
| --- | --- | --- |
| `step ca health` | `command/ca/health.go` | Get the status of the CA via the `/health` endpoint |
| `step ca init` | `command/ca/init.go` | Initialize the CA PKI (offline configuration) |
| `step ca bootstrap` | `command/ca/bootstrap.go` | Download the root and configure the local environment |
| `step ca token` | `command/ca/token.go` | Generate a one-time token (OTT) granting access to the CA |
| `step ca certificate` | `command/ca/certificate.go` | Create a new certificate through a provisioner flow |
| `step ca rekey` | `command/ca/rekey.go` | Rekey a certificate |
| `step ca renew` | `command/ca/renew.go` | Renew a certificate (optionally as a daemon) |
| `step ca revoke` | `command/ca/revoke.go` | Revoke a certificate by serial number |
| `step ca provisioner` | `command/ca/provisioner/` | Create and manage CA provisioners |
| `step ca sign` | `command/ca/sign.go` | Generate a certificate from a signed CSR |
| `step ca root` | `command/ca/root.go` | Download and validate the root certificate |
| `step ca roots` | `command/ca/federation.go` | Download all the root certificates |
| `step ca federation` | `command/ca/federation.go` | Download all the federated certificates |
| `step ca acme` | `command/ca/acme/` | Request certificates via the ACME protocol |
| `step ca policy` | `command/ca/policy/` | Manage certificate issuance policies |
| `step ca admin` | `command/ca/admin/` | Create and manage CA admins |

The group also defines shared flag variables used by several subcommands: ACME options (`--acme`, `--contact`, `--http-listen`, `--standalone`, `--webroot`), `--fingerprint`, `--kid`, and the SSH `--host` flag (`command/ca/ca.go:91-156`).

## Environment setup

- `step ca health` makes an API request to the `/health` endpoint of the Step CA to check if it is running (`command/ca/health.go:17-25`).
- `step ca bootstrap` downloads the root certificate from the CA and stores it in `<$STEPPATH/certs/root_ca.crt>`, then creates `<$STEPPATH/configs/defaults.json>` containing the CA URL, root location, and fingerprint, so subsequent commands do not need `--ca-url`, `--root`, or `--fingerprint`. It also supports `--team`/`--team-url` lookups and `--install`, which installs the root certificate into the system's default trust store (`command/ca/bootstrap.go:17-33`, `command/ca/bootstrap.go:68-71`).
- `step ca root` downloads and validates the root certificate, while `step ca roots` downloads all the root certificates and `step ca federation` downloads all the federated certificates (`command/ca/root.go:22-24`, `command/ca/federation.go:32-34`, `command/ca/federation.go:74-76`).

## CA initialization

`step ca init` initializes the PKI used by an offline certificate authority. Its flags cover key and root generation (`--root`, `--key`, `--key-password-file`, `--password-file`), PKI options (`--pki`, `--ssh`), Helm output and deployment type (`--helm`, `--deployment-type`, `--name`), network endpoints (`--dns`, `--address`), the initial provisioner (`--provisioner`), RA and KMS selection (`--ra`, `--kms`), remote management, ACME, and profile/authority selection (`command/ca/init.go:33-50`).

## Certificate lifecycle

- `step ca token <subject>` generates a one-time token that authorizes a later CA request. Flags include `--san`, `--principal`, `--not-before`, `--not-after`, `--key`, `--output-file`, plus action qualifiers `--revoke`, `--renew`, `--rekey`, and `--ssh` for SSH certificate requests (`command/ca/token.go:23-25`, `command/ca/token.go:193-279`).
- `step ca certificate` creates a new certificate through the selected provisioner flow. It accepts additional SANs via `--san` and device-attestation options: `--attestation-ca-url`, `--attestation-ca-root`, the hidden `--attestation-ca-insecure`, and `--tpm-storage-directory` (default `<$STEPPATH>/tpm`). It also accepts the shared ACME flags for ACME provisioners (`command/ca/certificate.go:21-23`, `command/ca/certificate.go:160-219`).
- `step ca sign` generates a new certificate by signing a certificate request (`command/ca/sign.go:23-25`).
- `step ca rekey <crt-file> <key-file>` rekeys a certificate. Flags: `--out-cert`, `--out-key`, `--private-key`, `--expires-in`, and the reload hooks `--pid`, `--pid-file`, `--signal`, `--exec`, `--daemon`, `--rekey-period` (`command/ca/rekey.go:27-29`, `command/ca/rekey.go:158-229`).
- `step ca revoke <serial-number>` revokes a certificate. It can identify the certificate by serial number or by `--cert`/`--key` files, and record `--reason`/`--reasonCode` (`command/ca/revoke.go:43-45`, `command/ca/revoke.go:135-149`).

## Renew and renew daemon

`step ca renew <crt-file> <key-file>` renews the given certificate and writes the new chain either over the original file or to `--out`. By default it authenticates with mTLS; `--mtls=false` forces the X5C token flow, which is also used automatically when the certificate is already expired. The token flow builds a JWT with issuer `step-ca-client/1.0`, subject equal to the leaf CN, and an `x5c` header carrying the certificate chain (`command/ca/renew.go:43-56`, `command/ca/renew.go:68-75`, `command/ca/renew.go:482-508`, `command/ca/renew.go:624-654`).

With `--daemon`, the command runs a renewal loop:

- Scheduling is computed by `nextRenewDuration`: without flags the renewal deadline is one third of the validity period before expiration (i.e. renewal at the 2/3 point), and a random jitter of up to `period/20` spreads instances apart. `--expires-in` overrides the deadline, and `--renew-period` overrides the whole period in daemon mode (`command/ca/renew.go:58-66`, `command/ca/renew.go:329-334`, `command/ca/renew.go:354-380`).
- `renewer.Daemon` blocks on a timer plus `SIGINT`/`SIGTERM` (exit) and `SIGHUP` (immediate renewal), logging each successful renewal to stdout and errors to stderr (`command/ca/renew.go:586-619`).
- After each renewal, `getAfterRenewFunc` runs the reload hooks: it sends a signal (default `SIGHUP`) to the PID from `--pid` or `--pid-file`, then executes the `--exec` command if set (`command/ca/renew.go:382-413`).

`newRenewer` builds the underlying client: in offline mode (`--offline` plus required `--ca-config`) it wraps the local authority via `cautils.NewOfflineCA`; otherwise it creates an online `ca.NewClient` with a transport pinned to the root file, attaching the client certificate only while it is still valid (`command/ca/renew.go:425-480`).

## Provisioner management

`step ca provisioner` manages the CA's provisioners with the subcommands `list`, `jwe-key` (retrieve and print a provisioner's encrypted provisioning key), `add`, `update`, `remove`, and `webhook` (`command/ca/provisioner/provisioner.go:26-38`, `command/ca/provisioner/getEncryptedKey.go:15-19`).

`step ca provisioner add` supports the default JWK type plus typed provisioners: `acme`, `sshpop`, `x5c`, `k8ssa`, `oidc`, `aws`, `azure`, `gcp`, `scep`, and `nebula` (`command/ca/provisioner/add.go:431-449`). ACME provisioners accept the challenges `http-01`, `dns-01`, `tls-alpn-01`, and `device-attest-01`, and SCEP provisioners accept attestation formats `apple`, `step`, and `tpm` (`command/ca/provisioner/add.go:905-940`).

`step ca provisioner webhook` manages webhooks attached to a provisioner (`add`, `update`, `remove`). Webhook data is made available to certificate templates under `Webhooks.<name>`. Endpoint flags include `--url`, `--kind`, `--bearer-token-file`, `--basic-auth-username`, `--basic-auth-password-file`, `--disable-tls-client-auth`, and `--cert-type` (`command/ca/provisioner/webhook/webhook.go:19-55`, `command/ca/provisioner/webhook/webhook.go:60-84`).

## Issuance policies

`step ca policy` manages certificate issuance policies at three levels, each backed by a `linkedca.Policy` document on the CA:

- `step ca policy authority` — authority-level policy (`command/ca/policy/authority/authority.go:15-26`).
- `step ca policy provisioner` — per-provisioner policy; requires `--provisioner` (`command/ca/policy/provisioner/provisioner.go:15-33`).
- `step ca policy acme` — per-ACME-account policy; requires `--provisioner` and either `--eab-key-reference` or `--eab-key-id` (`command/ca/policy/acme/acme.go:14-32`).

The active level is carried in the Go context via `policycontext` (`authorityPolicyLevel`, `provisionerPolicyLevel`, `acmePolicyLevel`) (`command/ca/policy/policycontext/context.go:11-50`). The shared action code in `command/ca/policy/actions` retrieves the policy for the current level and, when the CA reports the policy does not exist yet, creates a new empty policy before mutating it (`command/ca/policy/actions/policy.go:39-80`).

Name-scoped subcommands are available per level:

- X.509: `allow` (with `cn`, `dns`, `email`, `ip`, `uri`), `deny`, and `wildcards` (`command/ca/policy/x509/x509.go:11-25`, `command/ca/policy/x509/allow.go:13-28`).
- SSH: `host` and `user` scopes (`command/ca/policy/ssh/ssh.go:13-25`).
- Each name action accepts `--remove` to remove the given values instead of adding them, `view` prints the current policy, and `remove` deletes the whole policy (`command/ca/policy/actions/cn.go:63-64`, `command/ca/policy/actions/view.go:24-25`, `command/ca/policy/actions/remove.go:23-24`).

The provisioner- and ACME-level policy groups document that those policy levels are currently only supported in Certificate Manager (`command/ca/policy/provisioner/provisioner.go:15-33`, `command/ca/policy/acme/acme.go:14-32`).

## Admin management

`step ca admin` manages administrative accounts (authority configuration, provisioner configuration, and other admins) with `list`, `add`, `remove`, and `update`. Admins are addressed by `<subject> <provisioner>`, can be created with `--super` for SuperAdmin privileges, and are filtered with `--provisioner`/`--super` when listing (`command/ca/admin/admin.go:16-26`, `command/ca/admin/add.go:17-31`, `command/ca/admin/list.go:16-22`). Admin operations run through a linkedca `*ca.AdminClient` created with `cautils.NewAdminClient`, with CLI rows combining the `linkedca.Admin` fields and the provisioner's name/type (`command/ca/admin/admin.go:68-80`).

## Beta commands

`BetaCommand()` (registered under `step beta ca` by `command/beta/beta.go`) exposes only the ACME command for testing new APIs; there is no separate `command/beta/ca/` directory (`command/ca/ca.go:158-170`, `command/beta/beta.go:1-25`).
