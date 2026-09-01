---
type: workflow
title: CA Administration Commands
description: The step ca administration command tree — ca init (pki.Setup-driven), provisioner CRUD with admin-API-vs-ca.json fallback, admins, ACME EAB, webhooks, policy levels, health and federation queries.
tags: [ca-administration, provisioners, admin-api, policy, step-ca-init]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-9335ab9a0351c4e07a0bf3d1
    resource: repo://command/ca/acme/eab/add.go
  - id: openwiki-source-1a7471403e4089cff22dda24
    resource: repo://command/ca/admin/add.go
  - id: openwiki-source-4871c514390de4c3447b7738
    resource: repo://command/ca/federation.go
  - id: openwiki-source-b1fd6484864a367818d3ab86
    resource: repo://command/ca/health.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-0bc0ddb0bb8176e70e041b4c
    resource: repo://command/ca/policy/actions/policy.go
  - id: openwiki-source-1eb895615a355761cf5df664
    resource: repo://command/ca/policy/policy.go
  - id: openwiki-source-98cf9c9e3d8bea43005210de
    resource: repo://command/ca/policy/policycontext/context.go
  - id: openwiki-source-a419e83392119424b6cfae48
    resource: repo://command/ca/provisioner/add.go
  - id: openwiki-source-89561342b10ee9b0dec2b2c5
    resource: repo://command/ca/provisioner/caConfigClient.go
  - id: openwiki-source-e0cfffd9e5ebd278d6cab5c2
    resource: repo://command/ca/provisioner/provisioner.go
  - id: openwiki-source-81e2acfaa0f75b05dd227897
    resource: repo://command/ca/provisioner/webhook/add.go
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---

# CA Administration Commands

The `step ca` group (command/ca/ca.go:12-88) wires together issuance commands
(`token`, `certificate`, `renew`, `revoke`, `sign`, see
[Certificate Issuance and Renewal Workflows](/openwiki/workflows/certificate-lifecycle.md))
and the administration commands documented here. Management operations speak
the CA's **admin API** through `cautils.NewAdminClient`
(see [CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)),
which interactively logs in (ephemeral key + signed admin cert held in memory)
unless `--admin-cert/--admin-key` are given.

## `step ca init` — offline PKI bootstrap

`initAction` (command/ca/init.go:220-718) is a large option-validation and
delegation function; the actual PKI work happens in the external
`certificates/pki` package:

1. **Hard validation up front:** `assertCryptoRand()`; mutually-requiring
   `--root`/`--key`; `--ra` restricted to `StepCAS`/`CloudCAS`; `--kms` only
   `azurekms` and incompatible with `--ra`; `--pki` incompatible with
   `--no-db`/`--helm`; `--remote-management` and `--acme` require a DB;
   `--admin-subject` requires `--remote-management` and is unsupported with
   `--helm` (init.go:238-279).
2. **Deployment type prompt** (`Standalone` vs `Linked` etc.,
   `promptDeploymentType`, init.go:754-815) and context handling via
   `cautils.UseContext`/`WarnContext`.
3. **Construction via `pki.New(casOptions, pkiOpts…)`**; then
   `p.GenerateKeyPairs` (provisioner keys for standalone non-PKI-only runs),
   `p.GenerateRootCertificate` (or `p.WriteRootCertificate` when reusing an
   existing root — the key is deliberately **not** copied into STEPPATH,
   init.go:683-687), `p.GenerateIntermediateCertificate`, optional
   `p.GenerateSSHSigningKeys` with `--ssh`, and finally `p.Save()` (or
   `p.WriteHelmTemplate(os.Stdout)` with `--helm`) (init.go:648-717).

Outputs (config `ca.json`, certs, encrypted provisioner keys) therefore land
in the STEPPATH layout that `--ca-config` and bootstrap defaults already
point at.

## `step ca provisioner` — CRUD with dual backends

`newCRUDClient` (command/ca/provisioner/provisioner.go:105-132) is the key
routing decision:

- Probe the CA with an **unauthenticated** admin client's `IsEnabled()`.
- Network error or `ErrAdminAPINotImplemented` ⇒ fall back to editing the
  local `ca.json` directly: load via `config.LoadConfiguration` with
  `SkipValidation = true` and wrap it in `caConfigClient`
  (command/ca/provisioner/caConfigClient.go) — which implements the
  certificates AdminClient surface against the file, using a `nodb` noop
  client for the DB-backed parts.
- `ErrAdminAPINotAuthorized` ⇒ upgrade to the authenticated
  `cautils.NewAdminClient(cliCtx)` (login flow).

The `crudClient` interface mirrors Create/Get/Update/Remove on
`linkedca.Provisioner` (provisioner.go:98-103).

`provisioner add` (command/ca/provisioner/add.go:321-468) builds a
`linkedca.Provisioner`: type validated against `linkedca.Provisioner_Type`
(JWK default; ACME, OIDC, K8SSA, AWS, GCP, Azure, X5C, SSHPOP, SCEP, Nebula),
optional x509/SSH template files and data, claims block (validity durations,
`--disable-renewal`, `--allow-renewal-after-expiry`,
`--disable-smallstep-extensions`), then per-type `create<Type>Details`
constructors. `createJWKDetails` generates or loads the provisioner keypair
and stores an `encryptedKey` (JWE) — the same structure
`step ca provisioner get`/`jwe-key` retrieve.

Sub-groups: `provisioner list`, `remove`, `update`, and
`provisioner webhook add/remove/update` (webhook entries print an ID and
secret used to sign CA→webhook requests,
command/ca/provisioner/webhook/add.go:48).

## `step ca admin` and ACME EAB

The `admin` group (add/list/remove/update; command/ca/admin/add.go:80) and
`acme eab` (`step ca acme eab add|list|remove` creating and binding
External Account Binding key/nonce pairs; command/ca/acme/eab/add.go:73)
all construct `cautils.NewAdminClient(ctx)` directly — there is **no**
ca.json fallback here, so these require a step-ca instance with the admin API
enabled.

`eab` ships platform-specific `sigchild` helpers: on non-Windows a SIGCHLD
handler reaps the paging child (command/ca/acme/eab/sigchild.go:1-16) and
Windows has a separate `sigchild_windows.go`.

## `step ca policy` — layered issuance policy

`policy.Command()` assembles three levels — `policy authority`,
`policy provisioner <name>`, `policy acme <account>`, each with
`x509` and `ssh (host|user)` sub-trees offering `allow/deny/remove/view`
actions (command/ca/policy/policy.go:11-27).

The level is carried **in the Go context**, not in function arguments:
`policycontext.WithAuthorityPolicyLevel/WithProvisionerPolicyLevel/
WithACMEPolicyLevel` mark the invocation, and
`WithX509Policy/WithSSHHostPolicy/WithSSHUserPolicy` mark the configuration
type (command/ca/policy/policycontext/context.go:7-80). The shared action
engine in `policy/actions/policy.go` then performs
`retrieveAndInitializePolicy`/`updatePolicy` against the AdminClient
(`*ca.AdminClient`, policy.go:42, 164), translating "policy not initialized"
admin errors into locally-built policy objects. This is why new policy
actions implement flags once in `actions/` and the leaf commands
(`policy/x509/allow.go`, `policy/ssh/host/deny.go`, …) only differ by the
context markers they set.

## Status and discovery commands

- `step ca health` — requires `ca-url` via `flags.ParseCaURL` and a root file
  (defaults to `pki.GetRootCAPath()`, erroring if absent) before calling the
  CA's health endpoint (command/ca/health.go:57-73).
- `step ca root`/`roots`/`federation` — `rootsAction` and
  `federationAction` share one flow that opens a plain `ca.NewClient` and
  prints/ writes either the roots or the federated roots, optionally with
  `--install`-style handling (command/ca/federation.go:114-160).
- `step ca rekey/renew/revoke` are issuance-side commands built on
  `cautils` flows (covered in the certificate lifecycle page).

## Operational consequences

- `provisioner add/update/remove` **succeed differently** depending on CA
  configuration: offline `ca.json` edits are not visible to a running
  `step-ca` until reload, and the `SkipValidation = true` fallback can write
  provisioner shapes the live authority would reject
  (command/ca/provisioner/provisioner.go:121-123).
- Admin login during management commands writes nothing to disk; each
  invocation re-authenticates unless `--admin-cert/--admin-key` are provided
  (utils/cautils/client.go:121-203).

## See also

- [CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)
- [Certificate Issuance and Renewal Workflows](/openwiki/workflows/certificate-lifecycle.md)
