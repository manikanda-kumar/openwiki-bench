---
type: flow
title: CA Bootstrap Flow
description: How step ca bootstrap resolves authority data (direct or via team API), downloads and pins the root certificate, writes defaults.json, sets up contexts, and optionally installs trust.
tags: [bootstrap, ca, root-certificate, contexts, truststore]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-4871c514390de4c3447b7738
    resource: repo://command/ca/federation.go
  - id: openwiki-source-bd45ebb80f1a74f84552aea9
    resource: repo://command/ca/root.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# CA Bootstrap Flow

`step ca bootstrap` turns a bare environment into one where every `step ca`
command works without `--ca-url`, `--root`, or `--fingerprint`. The command
definition is thin (`command/ca/bootstrap.go`); the mechanics live in
`utils/cautils/bootstrap.go`.

## Command dispatch: two bootstrap variants

`bootstrapAction` first parses `--ca-url` (optional at this stage) and reads
`--fingerprint`, `--team`, and `--team-authority`, then selects a variant:

- `--team` together with `--ca-url` or `--fingerprint` is rejected as
  incompatible.
- `--team` + `--team-authority` → `BootstrapTeamAuthority(ctx, team, teamAuthority)`.
- `--team` alone → `BootstrapTeamAuthority(ctx, team, "ssh")` (the default
  authority sub-domain is `ssh`).
- `--team-authority` without `--team` → required-flag error.
- Otherwise, `--ca-url` and `--fingerprint` are both required and the direct
  variant `BootstrapAuthority(ctx, caURL, fingerprint)` runs.

## Variant 1: team authority resolution

`BootstrapTeamAuthority` builds an endpoint URL. By default it is
`https://api.smallstep.com/v1/teams/<team>/authorities/<teamAuthority>`;
with `--team-url`, every `<>` placeholder is replaced by the team ID (the
authority section of the URL cannot be templated). It performs a plain HTTP
GET (this endpoint serves public configuration, so no authentication), maps
`404` to "authority not found", and decodes:

```json
{"url": "...", "fingerprint": "...", "redirect-url": "...",
 "provisioner": "...", "min-password-length": ...}
```

The CLI's `--redirect-url` wins over the API-provided value, and if neither
exists the default redirect
`https://smallstep.com/app/teams/sso/success` is used. The variant then calls
`bootstrap(...)` with options: default context name
`<teamAuthority>.<team>`, the redirect URL, and — when present — the
provisioner name and minimum password length.

## Variant 2: direct authority

`BootstrapAuthority` derives the default context name from `--authority` or,
if unset, the hostname of the CA URL (port stripped), and calls
`bootstrap(...)` with that default context name and any `--redirect-url`.

## The shared `bootstrap` routine

1. **Root download and pinning.** It creates a step-ca client with
   `ca.WithInsecure()` (needed because there is no trusted root yet) and
   calls `client.Root(fingerprint)`. The client validates that the returned
   root matches the given SHA-256 fingerprint, so the fingerprint acts as the
   trust anchor; the same primitive backs the standalone
   `step ca root` command.
2. **Context handling.** If `cautils.UseContext(ctx)` holds (contexts enabled
   or `--context`/`--authority`/`--profile` set), it adds the context
   (name/authority/profile, each defaulting per the variant), saves it as the
   current context, and activates it. Otherwise it prints the "consider
   contexts" warning when `$STEPPATH/config/ca.json` already exists.
3. **Root persistence.** Creates the parent directory (mode `0700`) and
   serializes the root certificate to `pki.GetRootCAPath()` —
   `$STEPPATH/certs/root_ca.crt` — with file mode `0600`.
4. **URL normalization.** `utils.CompleteURL` defaults the scheme to `https`
   and completes bare hosts before anything is stored.
5. **defaults.json.** Writes `$STEPPATH/config/defaults.json` (mode `0644`)
   containing `ca-url`, `fingerprint`, `root`, and, when set, `redirect-url`,
   `provisioner`, and `min-password-length`. The `ca-url`, `fingerprint`, and
   `root` values are also injected into the live CLI context so subsequent
   logic in the same process sees them.
6. **Profile defaults.** With contexts enabled, a missing profile defaults
   file (`step.ProfileDefaultsFile()`) is seeded with `{}`.
7. **Optional trust installation.** With `--install`, the root is installed
   into the system trust store via `smallstep/truststore` (`truststore.InstallFile`).

After bootstrap, `step ca` commands resolve the CA URL from defaults and the
root from `$STEPPATH/certs/root_ca.crt` (see
[Shared Flags and Configuration](/openwiki/concepts/shared-flags-and-configuration.md)).

## Related commands

- `step ca root [<file>]` downloads and validates the root with an explicit
  fingerprint and either writes it to a file (mode `0600`) or prints the PEM.
- `step ca roots` and `step ca federation` fetch the full root and federation
  bundles from the CA using the same client primitives.
