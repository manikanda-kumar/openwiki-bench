---
type: admin-commands
title: "CA Administration: Provisioners, Admins, Policies, ACME EAB"
description: "How the step CLI manages step-ca administrative resources: the provisioner CRUD backends (Admin API vs ca.json fallback), JWK provisioner key encryption, x5c-based admin credentials, issuance policies, ACME EAB keys, and the hidden Smallstep API token command."
tags: [provisioners, admins, policies, acme, admin-api, eab, webhook]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-4695ffe2593592cc94176478
    resource: repo://command/api/api.go
  - id: openwiki-source-cad2273c82bf9812b36092ec
    resource: repo://command/api/token/create.go
  - id: openwiki-source-9335ab9a0351c4e07a0bf3d1
    resource: repo://command/ca/acme/eab/add.go
  - id: openwiki-source-1469a9c4d225f283439896da
    resource: repo://command/ca/acme/eab/eab.go
  - id: openwiki-source-1a7471403e4089cff22dda24
    resource: repo://command/ca/admin/add.go
  - id: openwiki-source-d82ba690a258bfd504770f1e
    resource: repo://command/ca/admin/list.go
  - id: openwiki-source-a83b9fa0d942efadf96fe5ff
    resource: repo://command/ca/admin/remove.go
  - id: openwiki-source-1f558bec6272704eb53b1bb4
    resource: repo://command/ca/admin/update.go
  - id: openwiki-source-9a07a6a9b76f74e45c1b8b51
    resource: repo://command/ca/policy/authority/authority.go
  - id: openwiki-source-1eb895615a355761cf5df664
    resource: repo://command/ca/policy/policy.go
  - id: openwiki-source-a419e83392119424b6cfae48
    resource: repo://command/ca/provisioner/add.go
  - id: openwiki-source-89561342b10ee9b0dec2b2c5
    resource: repo://command/ca/provisioner/caConfigClient.go
  - id: openwiki-source-f8b0310182aba502aaa1d18a
    resource: repo://command/ca/provisioner/getEncryptedKey.go
  - id: openwiki-source-e0cfffd9e5ebd278d6cab5c2
    resource: repo://command/ca/provisioner/provisioner.go
  - id: openwiki-source-fb2c9482bc847805ca5f7524
    resource: repo://command/ca/provisioner/webhook/webhook.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

The `step ca provisioner`, `step ca admin`, `step ca policy`, `step ca acme eab`, and hidden `step api token` command groups implement the administrative surface of the CLI. They share one key architectural decision: **which backend performs the mutation**, chosen at runtime by probing the target CA.

## Backend selection for provisioner CRUD

`step ca provisioner` offers `list`, `jwe-key`, `add`, `update`, `remove`, and the `webhook` subgroup (`command/ca/provisioner/provisioner.go:26-38`). The `add`/`update`/`remove` actions (and the webhook subgroup, which has its own copy of the same logic in `command/ca/provisioner/webhook/webhook.go:96`) obtain a `crudClient` through `newCRUDClient` (`command/ca/provisioner/provisioner.go:105-132`), which:

1. Builds an **unauthenticated** admin client with `cautils.NewUnauthenticatedAdminClient` (`utils/cautils/client.go:77-96`).
2. Calls `IsEnabled()` on it and switches on the error:
   - **Network error or `ca.ErrAdminAPINotImplemented`** (CA reachable but without the Admin API / remote management): falls back to editing the local CA configuration file. It loads `--ca-config` with `config.LoadConfiguration`, sets `cfg.SkipValidation = true` (so the CLI does not need every step-ca feature enabled to modify provisioners), builds an in-process `authority.New` with a no-op admin DB (`nodb`, `command/ca/provisioner/caConfigClient.go:17-80`), and returns a `caConfigClient`.
   - **`ca.ErrAdminAPINotAuthorized`** (Admin API exists but needs credentials): returns the authenticated `cautils.NewAdminClient`.
   - **Any other error**: returned to the user.

`caConfigClient` performs CRUD in memory against the loaded `authority.Authority` and, after every mutation, re-serializes the provisioner list into the config file with `cfg.Save(configFile)` and prints: *"Success! Your `step-ca` config has been updated. To pick up the new configuration SIGHUP (kill -1 <pid>) or restart the step-ca process."* (`command/ca/provisioner/caConfigClient.go:207-221`). So in fallback mode the CLI mutates `ca.json` directly and relies on the operator to reload the running CA.

## Provisioner management

`step ca provisioner add <name>` accepts `--type JWK, ACME, OIDC, SSHPOP, K8SSA, NEBULA, SCEP, AWS, GCP, AZURE` (validated against the `linkedca.Provisioner_Type` enum) and dispatches to per-type details builders: `createACMEDetails`, `createSSHPOPDetails`, `createX5CDetails`, `createK8SSADetails`, `createOIDCDetails`, `createAWSDetails`, `createAzureDetails`, `createGCPDetails`, `createSCEPDetails`, `createNebulaDetails`, with JWK as the default (`command/ca/provisioner/add.go:333,430-453`).

JWK key material handling in `createJWKDetails` (`command/ca/provisioner/add.go:470-592`):

- With `--create`: the CLI generates a default JWK keypair and JWE-encrypts the private key using a prompted password (empty prompt generates one), or a password from `--password-file`.
- Without `--create`: `--public-key` is required. The JWK must be **asymmetric** (symmetric byte keys are rejected: *"a symmetric key cannot be used as a provisioner"*), and a missing `kid` is filled with the JWK thumbprint. An optional `--private-key` file is accepted either as an already-JWE-encrypted key or as a plain private key, which the CLI encrypts into JWE compact serialization.
- The result is a `linkedca.JWKProvisioner` with `PublicKey` (marshaled JWK) and optional `EncryptedPrivateKey` (JWE compact form).

Duration and renewal claims are mapped from flags such as `--x509-min-dur`/`--x509-max-dur`/`--x509-default-dur`, `--ssh-user-*`, `--ssh-host-*`, `--disable-renewal`, `--allow-renewal-after-expiry`, `--disable-smallstep-extensions` (`command/ca/provisioner/provisioner.go:166-260`, `add.go:385-428`). Templates are supported via `--x509-template`, `--x509-template-data`, `--ssh-template`, `--ssh-template-data`.

`step ca provisioner jwe-key <kid>` retrieves the encrypted private JWK for a key ID from the CA via `pki.GetProvisionerKey(caURL, root, kid)` and prints it to stdout (`command/ca/provisioner/getEncryptedKey.go:40-58`) — this is how an operator retrieves a provisioner signing key they previously stored encrypted.

Webhooks (`step ca provisioner webhook add/update/remove`) attach webhook URLs to provisioners; webhook responses are available to certificate templates under `Webhooks.<name>` and can be used to disallow signing for unknown entities (`command/ca/provisioner/webhook/webhook.go:20-45`).

## Admin management (x5c credentials)

`step ca admin` (`list`, `add`, `remove`, `update`) is **always** Admin-API based: every action calls `cautils.NewAdminClient(ctx)` (`command/ca/admin/list.go:81`, `add.go:80`, `remove.go:59`, `update.go:81`). Admins are `linkedca.Admin_ADMIN` by default or `linkedca.Admin_SUPER_ADMIN` with `--super` (`command/ca/admin/add.go:75-78`). Display resolves each admin's provisioner name/type through an extra `GetProvisioner` call (`command/ca/admin/admin.go:74-80`).

The interesting part is how `NewAdminClient` obtains admin credentials when `--admin-cert`/`--admin-key` are not given (`utils/cautils/client.go:99-204`):

1. It prints *"No admin credentials found. You must login to execute admin commands."*
2. It prompts for the admin subject (or uses `--admin-subject`).
3. It runs a **token flow** (`cautils.NewTokenFlow` with `SignType`) using the `--admin-provisioner` provisioner to obtain a one-time signing token.
4. It generates a fresh keypair in memory, builds a CSR for the subject, verifies the CSR signature, and sends it to `client.Sign` to obtain an admin certificate.
5. It returns `ca.NewAdminClient(caURL, ca.WithRootFile(root), ca.WithAdminX5C(adminCert, adminKey, passwordFile))`.

So the first admin credential is minted over the standard X.509 sign endpoint, and subsequent Admin API calls are authorized with the x5c header. The `nodb` no-op client in `command/ca/provisioner/caConfigClient.go:17-80` exists precisely so the `ca.json` fallback path can construct an `authority.Authority` whose admin methods are inert.

## Policies

`step ca policy` (`command/ca/policy/policy.go:14-33`) exposes `authority`, `provisioner`, and `acme` subcommands. The authority-level group wires `actions.ViewCommand`, `actions.RemoveCommand`, plus `x509` and `ssh` policy subgroups, and marks the context with the authority policy level via `policycontext.WithAuthorityPolicyLevel` (`command/ca/policy/authority/authority.go:14-28`). The concrete assertion types are implemented in `command/ca/policy/actions/` (`cn.go`, `dns.go`, `emails.go`, `ips.go`, `principals.go`, `uris.go`, `wildcards.go`, `view.go`, `remove.go`), with `policy.go` there assembling assertions from flags.

## ACME External Account Binding keys

`step ca acme eab` (`list <provisioner>`, `add <provisioner> <reference>`, `remove <provisioner> <key-id>`) manages ACME EAB keys through the authenticated admin client (`command/ca/acme/eab/eab.go:38-67`, `add.go:73`, `list.go:84`, `remove.go:63`). Keys are rendered with the HMAC key base64url-encoded and timestamps in `2006-01-02 15:04:05 -07:00` format (`command/ca/acme/eab/eab.go:16-35`). If the CA answers with an Admin API *not implemented* error, `notImplemented` wraps it with a pointer to Certificate Manager: *"this functionality is currently only available in Certificate Manager"* (`command/ca/acme/eab/eab.go:80-91`).

## Hidden `step api token` command

The `step api` group is registered hidden (`command/api/api.go:14-24`). `step api token create <team> <crt-file> <key-file>` (`command/api/token/create.go:71-145`) POSTs to `<--api-url>/api/auth` a JSON body containing the team UUID or slug and the full X.509 certificate bundle, using a **mTLS** transport (TLS >= 1.2) whose client certificate comes from the given files. A `201` response yields a token printed to stdout (human message goes to stderr). This authenticates the CLI against the Smallstep cloud API, not against a step-ca Admin API.

## Failure behavior and constraints

- Provisioner CRUD against a CA without the Admin API edits `ca.json` locally; the running CA is not reloaded by the CLI (the SIGHUP hint is the only guidance, `caConfigClient.go:218`).
- The config fallback deliberately skips config validation, so a partially-featured `ca.json` can still be edited (`provisioner.go:121-123`).
- Admin commands cannot use the `ca.json` fallback at all — `NewAdminClient` is required, and without stored admin credentials the CLI mints them interactively (`utils/cautils/client.go:136-197`).
- `step ca init --admin-subject` is only accepted with `--remote-management` (see the offline CA page), which matches this page's requirement that admins live in a DB-backed Admin API.

## Change guide: adding a new provisioner type

1. Add the type to the `linkedca.Provisioner_Type` switch in `createJWKDetails`-style dispatch in both `command/ca/provisioner/add.go` (`addAction`, ~line 430) and `command/ca/provisioner/update.go`, and to the `--type` usage string in `add.go:335`.
2. Write a `create<Type>Details(ctx)` builder returning `*linkedca.ProvisionerDetails`.
3. Ensure the `crudClient` interface (`provisioner.go:98-103`) covers the needed CRUD operations; the `caConfigClient` path only supports the four provisioner methods, so Admin-API-only features will not work against `ca.json`.
4. Update the token flow side (`utils/cautils/token_flow.go` `NewTokenFlow` switch) if the type needs to *mint* tokens, and `utils/cautils/offline.go` `GenerateToken` for the offline path.
