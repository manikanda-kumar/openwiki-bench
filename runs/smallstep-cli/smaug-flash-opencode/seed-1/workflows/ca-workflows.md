---
type: "Reference"
title: "CA Workflows: Init, Bootstrap, Sign, Renew, Revoke"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:42:28.757Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-e0cfffd9e5ebd278d6cab5c2
    resource: repo://command/ca/provisioner/provisioner.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-09-12T20:42:28.757Z" }
---


# CA Workflows: Init, Bootstrap, Sign, Renew, Revoke

The `step ca` command group initializes and drives a step-ca certificate
authority. Workflows combine configuration, one-time tokens, and a CA client
that runs either online (over HTTPS) or offline (in-process against a
local `ca.json`).

## Command family

`step ca` subcommands include `health`, `init`, `bootstrap`, `token`,
`certificate`, `rekey`, `renew`, `revoke`, `provisioner`, `sign`, `root`,
`roots`, `federation`, `acme`, `policy`, and `admin`
(`command/ca/ca.go`).

## Init

`step ca init` boots a new PKI and CA configuration. It supports several
deployment types (`standalone`, `linked`, `hosted`) and registration
authorities (`StepCAS`, `CloudCAS`) and can target a KMS. It generates root
and intermediate certificates, provisioner keys, and (optionally) SSH signing
keys, writing `ca.json` and defaults under STEPPATH and registering a context
(`command/ca/init.go`). Flags include `--pki` (PKI only), `--ssh`,
`--no-db`, `--remote-management`, `--acme`, `--helm`, and `--deployment-type`.

## Bootstrap

`step ca bootstrap` downloads and pins the authority's root certificate and
writes `defaults.json` (with `ca-url`, `fingerprint`, `root`) so subsequent CA
commands need no per-invocation `--ca-url`/`--root` flags. It can install the
root into the system trust store (`--install`) and register a context. A
`--team` variant fetches configuration from `api.smallstep.com`
(`utils/cautils/bootstrap.go`).

## The CaClient interface

All online/offline CA interactions go through `CaClient`, which exposes
sign/renew/revoke/rekey + SSH-signing methods plus `Version`, `GetRootCAs`,
and `GetCaURL` (`utils/cautils/client.go`). Two factories:

- `NewClient` returns an online `ca.NewClient` (with `WithRootFile`) when
  `--offline` is not set, or an offline `NewOfflineCA` given `--ca-config`.
- `NewAdminClient` / `NewUnauthenticatedAdminClient` target the CA management
  API, optionally using admin cert/key or generating in-memory admin
  credentials via a token flow (`utils/cautils/client.go`).

## Signing (certificate flow)

`step ca certificate` generates a key + CSR, produces a token via
`NewTokenFlow`/`OfflineTokenFlow`, and calls `certificate_flow.Sign`, which
builds an `api.SignRequest` and writes the returned certificate chain to a
file. `CertificateFlow` unifies a single path for online/offline token
generation, client selection, CSR creation, and signing
(`utils/cautils/certificate_flow.go`).

## Renewal

`step ca renew <crt> <key>` loads the cert/key pair)Skip`, renews via mTLS by
default, or via an X5C token flow when `--mtls=false` or the certificate has
expired (`renewer.Renew` and `RenewWithToken`). The `--daemon` mode renews
periodically — by default before 2/3 of validity elapses (`nextRenewDuration`),
with `--expires-in`, `--renew-period`, `--pid`, `--signal`, and `--exec`
hooks to reload services after renewal (`command/ca/renew.go`).

## Revoke

`step ca revoke <serial>` performs **passive revocation** (prevents renewal and
lets the certificate expire; CRL/OCSP are noted as future work in the source
comment). Revocation can be authorized by a transparently generated JWK
provisioner token or by mTLS using `--cert`/`--key`. The `reasonCode` maps
names (e.g. `key compromise`) to RFC 5280 OCSP codes (`ReasonCodeToNum`,
`RevocationReasonCodes`). An `--offline` mode revokes via the in-process
offline CA, validating cert/key against the local root/intermediate
(`command/ca/revoke.go`).

## Offline CA

`OfflineCA` wraps the `certificates/authority` methods directly, signing,
renewing, issuing SSH certificates, and revoking in-process using a `ca.json`
config. It is a package-level singleton and derives token audiences from the
configured DNS names (`utils/cautils/offline.go`).

## Provisioner management

`step ca provisioner` lets admins list, add, update, and remove provisioners,
get encrypted provisioner keys, and manage webhooks
(`command/ca/provisioner/`). `step ca policy` manages issuance policies at the
authority, provisioner, and ACME levels, and `step ca admin` manages admins
(`command/ca/policy/`, `command/ca/admin/`).
