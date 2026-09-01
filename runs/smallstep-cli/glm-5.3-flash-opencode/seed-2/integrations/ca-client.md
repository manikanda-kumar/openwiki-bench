---
type: integration
title: CA Client Integration
description: The CaClient abstraction — how commands obtain online step-ca clients, the offline in-process authority (and why it is a singleton), and the admin API client with on-the-fly admin credentials.
tags: [ca-client, offline, admin-api, integration]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# CA Client Integration

## The `CaClient` interface

`utils/cautils/client.go` defines `CaClient`, the interface every CA-touching
command programs against: `Sign`, `Renew`, `RenewWithToken`, `Revoke`,
`Rekey`, the SSH family (`SSHSign`, `SSHRenew`, `SSHRekey`, `SSHRevoke`,
`SSHRoots`, `SSHFederation`, `SSHConfig`, `SSHCheckHost`, `SSHGetHosts`,
`SSHBastion`), plus `Version`, `GetRootCAs`, and `GetCaURL`. Two
implementations exist: the network client from `smallstep/certificates`
(`ca.NewClient`) and the offline CA wrapper. The interface is what lets the
same command action serve both modes.

## Online client construction

`cautils.NewClient(ctx)` picks the implementation:

- `--offline` → `NewOfflineCA(ctx, --ca-config)` (`--ca-config` is then
  required).
- Otherwise → `flags.ParseCaURL` (required unless offline) and `--root`,
  defaulting to `$STEPPATH/certs/root_ca.crt` and erroring as a required
  flag when that file is missing; the client is built with
  `ca.WithRootFile(root)` plus any caller options (e.g. custom transports,
  retry hooks for login flows).

## The offline CA wrapper

`OfflineCA` (`utils/cautils/offline.go`) implements the full `CaClient`
interface in-process:

- **Construction**: parses the CA configuration JSON (`--ca-config`),
  requires at least one provisioner, merges `--password-file` into the
  config, and initializes `authority.Authority`.
- **Singleton**: a package-level `offlineInstance` is returned on subsequent
  calls. The stated reason (source comment) is that double initialization is
  sometimes impossible due to locks — badger, the CA's embedded database,
  is the example given.
- **Semantics**: URLs are synthesized, not dialed — `CaURL()`/`GetCaURL()` is
  `https://<config.DNSNames[0]>`, audiences follow the same per-token-type
  paths as the online flow, and `GetRootCAs()` returns nil (no TLS pool is
  needed). `Sign`, `Renew` (extracting the peer certificate from the caller's
  transport), `RenewWithToken` (`AuthorizeRenewToken` then `Renew`), `Revoke`,
  `Rekey`, and all SSH operations call the authority's methods directly and
  re-wrap results into the `api.*Response` shapes the commands expect.
- **Extras**: `Provisioners()` exposes the configured provisioners for
  offline token generation, and `VerifyClientCert` validates a client
  certificate/key pair against the offline root and intermediate pools.

## The admin API client

`NewAdminClient` / `NewUnauthenticatedAdminClient` build `ca.AdminClient`s
for the step-ca management API (provisioner, admin, and policy commands):

- Both require `--ca-url` (no offline variant) and a root, with the same
  `$STEPPATH/certs/root_ca.crt` default.
- `NewAdminClient` additionally authenticates. With `--admin-cert` and
  `--admin-key` on disk it loads them (each flag requires the other) and
  configures the client with `ca.WithAdminX5C`. Without them, it prints
  "No admin credentials found. You must login to execute admin commands."
  and mints credentials in memory: it prompts for the admin subject (or
  takes `--admin-subject`), generates an admin key, obtains a sign token via
  the standard token flow, sends a sign request, and uses the resulting
  chain as the X5C admin credential. `--admin-provisioner` and
  `--admin-password-file` parameterize that token generation.

## Failure behavior

Missing flags surface as `errs.RequiredFlag`/`InvalidFlagValue` errors with
the flag name; a missing default root becomes "required flag: root"; offline
configuration errors are wrapped with the config file path. Because the
interface is narrow, a command cannot silently fall back between online and
offline — the mode is fixed by `--offline` at client construction.
