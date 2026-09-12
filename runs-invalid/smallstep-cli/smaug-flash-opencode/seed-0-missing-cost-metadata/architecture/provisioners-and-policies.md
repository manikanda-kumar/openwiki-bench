---
type: concept
title: Provisioners, Admins, ACME EAB, and Certificate Policies
description: How step ca manages provisioners, admins, ACME external account binding keys, and certificate issuance policies, dispatching either to the online Admin API or the local ca.json configuration.
tags: [provisioners, admin-api, acme-eab, policies, ca-config]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-9335ab9a0351c4e07a0bf3d1
    resource: repo://command/ca/acme/eab/add.go
  - id: openwiki-source-1469a9c4d225f283439896da
    resource: repo://command/ca/acme/eab/eab.go
  - id: openwiki-source-1a7471403e4089cff22dda24
    resource: repo://command/ca/admin/add.go
  - id: openwiki-source-0bc0ddb0bb8176e70e041b4c
    resource: repo://command/ca/policy/actions/policy.go
  - id: openwiki-source-98cf9c9e3d8bea43005210de
    resource: repo://command/ca/policy/policycontext/context.go
  - id: openwiki-source-89561342b10ee9b0dec2b2c5
    resource: repo://command/ca/provisioner/caConfigClient.go
  - id: openwiki-source-e0cfffd9e5ebd278d6cab5c2
    resource: repo://command/ca/provisioner/provisioner.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---

# Provisioners, Admins, ACME EAB, and Certificate Policies

The `step ca` management commands (`provisioner`, `admin`, `acme eab`, and
`policy`) administer the entities that authorize certificate issuance. They
target either the online `step-ca` Admin API or, when it is unavailable or
unauthenticated, an embedded edit of the local `ca.json`.

## Provisioners

A provisioner is the entity that controls provisioning credentials used to
generate provisioning tokens. `step ca provisioner` (`command/ca/provisioner/
provisioner.go`) groups `list`, `get-encrypted-key`, `add`, `update`, `remove`,
and `webhook` subcommands.

Supported provisioner types (from the `--type` flag help): JWK (default), OIDC,
AWS, GCP, Azure, ACME, X5C, K8sSA, SSHPOP, SCEP, and Nebula. The command flags
address type-specific configuration — e.g. ACME challenges (`--challenge`,
`--require-eab`, `--attestation-format`, `--attestation-roots`), SCEP
(`--capabilities`, `--min-public-key-length`, `--encryption-algorithm-identifier`,
decrypter key flags), cloud provisioners (AWS accounts, Azure tenant/resource
groups/subscriptions/object IDs, GCP service accounts/projects/organizations,
`--disable-custom-sans`, `--disable-trust-on-first-use`), OIDC (client ID,
scopes, domains, groups, admin emails), X5C roots, JWK `--create`/`--private-key`,
and Nebula roots.

`newCRUDClient` (`provisioner.go#newCRUDClient`) selects the backend by probing
`cautils.NewUnauthenticatedAdminClient`'s `IsEnabled()`. If the Admin API is not
implemented or unreachable (`net.OpError` or `ca.ErrAdminAPINotImplemented`), it
loads the local `ca.json` with `config.LoadConfiguration` and returns a
`caConfigClient` operating on that file (with `SkipValidation` set). If the API is
reachable but calls are unauthorized, it builds an authenticated `cautils.NewAdminClient`
that generates admin credentials. Otherwise it returns the error.

### The ca-config client

`caConfigClient` (`command/ca/provisioner/caConfigClient.go`) implements the CRUD
interface by loading the authority from `ca.json` with a noop admin DB
(`nodb`), then using `authority.Authority` store/load operations. `CreateProvisioner`
stores the provisioner and calls `write()`, which reloads the provisioner list,
writes the updated `ca.json`, and prints a message telling the operator to SIGHUP
or restart step-ca. `GetProvisioners` pages through the authority with a default
limit of 100.

## Admins

An admin is an entity that manages authority configuration, provisioner
configuration, and other admins. `step ca admin` (`command/ca/admin/admin.go`)
groups `list`, `add`, `remove`, and `update`. `add` creates an admin with a
subject, a provisioner name, and either `linkedca.Admin_ADMIN` or
`linkedca.Admin_SUPER_ADMIN` (`--super`). Commands operate through
`cautils.NewAdminClient`, which uses `--admin-cert`/`--admin-key` when provided or
otherwise generates an in-memory admin certificate via the sign flow
(`utils/cautils/client.go#NewAdminClient`).

## ACME External Account Binding keys

`step ca acme eab` (`command/ca/acme/eab/eab.go`) manages ACME External Account
Binding (`linkedca.EABKey`) records with `list`, `add`, and `remove`. `add`
(`eab/add.go`) creates a key via the admin client
(`CreateExternalAccountKey`) and prints the key ID, provisioner, base64url-encoded
HMAC key, and reference. If the operation is not implemented in the CA
(`admin.ErrorNotImplementedType`), `notImplemented` rewrites the error to point to
Certificate Manager.

## Certificate issuance policies

`step ca policy` (`command/ca/policy/policy.go`) manages certificate issuance
policies at three levels — authority, provisioner, and ACME — each wiring the
policy commands through a context that records the policy level.

The policy level and configuration type are carried in the Go context by
`policycontext` (`command/ca/policy/policycontext/context.go`):
`authorityPolicyLevel`, `provisionerPolicyLevel`, `acmePolicyLevel`, plus
`x509PolicyType`, `sshHostPolicyType`, `sshUserPolicyType`, and `allow`/`deny`.
Each `authority.Command` calls `policycontext.WithAuthorityPolicyLevel(ctx)`, so
its subcommands operate at the authority level; provisioner and ACME commands do
the same for their levels.

`retrieveAndInitializePolicy`/`updatePolicy` (`command/ca/policy/actions/policy.go`)
dispatch on level: authority policies call
`GetAuthorityPolicy`/`CreateAuthorityPolicy`, provisioner policies require
`--provisioner`, and ACME policies require
`--provisioner` plus `--eab-key-reference` or `--eab-key-id`. When a policy is
not found the client creates a fresh, fully initialized empty policy
(`newPolicy`/`initPolicy`), which ensures the X.509 allow/deny and SSH host/user
allow/deny structures are present. Values are deduplicated before update and
policies are printed as indented JSON via `protojson`.

Policy actions (`actions`) and type-specific subcommands live under
`policy/actions`, `policy/x509`, `policy/ssh`, and `policy/acme`. X.509 allow/deny
operates on name kinds (CN, DNS, emails, IPs, principals, URIs, wildcards), and SSH
host/user policies scope their own allow/deny sets.
