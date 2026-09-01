---
type: integration
title: Provisioner, Admin, and Policy Management API
description: How step ca provisioner, step ca admin, and step ca policy manage CA configuration through the step-ca Admin API (linkedca objects) with a ca.json config-file fallback, plus webhooks.
tags: [integration, admin, provisioners, policy, webhooks]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-567b7cca98d1eb42c96305c8
    resource: repo://command/ca/admin/admin.go
  - id: openwiki-source-1eb895615a355761cf5df664
    resource: repo://command/ca/policy/policy.go
  - id: openwiki-source-89561342b10ee9b0dec2b2c5
    resource: repo://command/ca/provisioner/caConfigClient.go
  - id: openwiki-source-51f7878faa17e037aba1e3fa
    resource: repo://command/ca/provisioner/list.go
  - id: openwiki-source-e0cfffd9e5ebd278d6cab5c2
    resource: repo://command/ca/provisioner/provisioner.go
  - id: openwiki-source-fb2c9482bc847805ca5f7524
    resource: repo://command/ca/provisioner/webhook/webhook.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# Provisioner, Admin, and Policy Management

The `step ca provisioner`, `step ca admin`, and `step ca policy` command groups
let operators manage a step-ca's runtime configuration. They talk to the
step-ca **Admin API** (the management surface of `ca.AdminClient`) using
`linkedca` protobuf objects for provisioners, admins, policies, and webhooks —
and they transparently fall back to editing the `ca.json` configuration file
when the Admin API is not implemented.

## Command groups and their objects

- `step ca provisioner` (command/ca/provisioner/provisioner.go) — subcommands
  `list`, `jwe-key`, `add`, `update`, `remove`, and `webhook`. Provisioner
  creation supports many types (JWK, OIDC, AWS, GCP, Azure, ACME, X5C, K8SSA,
  SSHPOP, SCEP, Nebula) with per-provisioner claim flags such as
  `--x509-min-dur`, `--x509-max-dur`, `--ssh-user-max-dur`, `--disable-renewal`,
  `--allow-renewal-after-expiry`, and templates.
- `step ca admin` (command/ca/admin/admin.go) — subcommands `list`, `add`,
  `remove`, `update` over `linkedca.Admin` objects. An admin is an entity that
  manages authority, provisioner, and other admin resources; `--super` marks a
  super admin, and `--provisioner` filters admins by provisioner.
- `step ca policy` (command/ca/policy/policy.go) — subcommands `authority`,
  `provisioner`, and `acme` for managing certificate issuance policies.
- `step ca provisioner webhook` (command/ca/provisioner/webhook/webhook.go) —
  manages webhooks attached to a provisioner, with `--url`, `--kind`
  (default `ENRICHING`), bearer-token/basic-auth/mTLS auth options, and
  `--cert-type` (X509/SSH/ALL).

## Admin client and credential handling

The CRUD commands build their client through `cautils.NewUnauthenticatedAdminClient`
or `cautils.NewAdminClient` (utils/cautils/client.go):

- `NewUnauthenticatedAdminClient` creates a bare client to probe whether the
  Admin API is reachable (`IsEnabled`).
- `NewAdminClient` supplies credentials. When `--admin-cert`/`--admin-key` are
  given they are used directly; otherwise the CLI generates an ephemeral admin
  identity in memory: it mints a `SignType` token via the token flow, prompts
  for the admin subject, creates a fresh key and CSR, calls `client.Sign`, and
  uses the returned chain with `ca.WithAdminX5C`.

## Admin API vs. ca.json fallback

`newCRUDClient` (command/ca/provisioner/provisioner.go:105-132) resolves which
backend to use:

1. It calls `IsEnabled()` on the unauthenticated Admin client.
2. On a network error or `ca.ErrAdminAPINotImplemented`, it falls back to
   `newCaConfigClient`, which loads the local `ca.json` (with
   `cfg.SkipValidation = true`), builds an in-process authority using a noop
   admin DB (`nodb`), and performs the requested change directly against that
   authority.
3. On `ca.ErrAdminAPINotAuthorized`, it prompts for admin credentials through
   `cautils.NewAdminClient`.

The config-file client (`caConfigClient`, command/ca/provisioner/caConfigClient.go)
persists changes by reloading all provisioners, setting them on the config, and
calling `cfg.Save(caConfigFile)`. After writing it prints that the step-ca
process must be restarted or sent `SIGHUP` to pick up the new configuration.

Webhook management is stricter: its `newCRUDClient`
(command/ca/provisioner/webhook/webhook.go:96-120) requires the Admin API —
if a config file exists but admin is not enabled it returns an error.

## Listing provisioners

`step ca provisioner list` does **not** use the Admin API. It calls
`pki.GetProvisioners(caURL, root)` against the CA's public endpoint and prints
the JSON list, requiring only `--ca-url` (and `--root` as needed)
(command/ca/provisioner/list.go:40-63).

## Admin selection and filtering

`step ca admin` commands reuse a selection helper: `adminPrompt` filters admins
by subject and `--provisioner`, auto-selects when a single candidate remains,
and otherwise shows an interactive `ui.Select` list
(command/ca/admin/admin.go:96-151). Each admin row is enriched with its
provisioner name/type by calling `client.GetProvisioner`.

## Failure behavior

Because the fallback edits the local config file rather than the live server,
changes made through the fallback path only take effect after the step-ca
process is reloaded (SIGHUP or restart), which the CLI explicitly tells the
user. Errors converting between `provisioner.Interface` and `linkedca.Provisioner`
(`authority.ProvisionerToLinkedca`) surface as wrapped errors from the CRUD
methods.
