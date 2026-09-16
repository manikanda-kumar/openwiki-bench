---
type: flows
title: "Bootstrap, Root Distribution, and Contexts"
description: "How step ca bootstrap establishes trust (fingerprint-validated root, defaults.json, optional context and truststore install), team/authority bootstrap against api.smallstep.com, step ca root/roots/federation/health, and the context/profile/authority switching system."
tags: [bootstrap, trust, roots, contexts, team, truststore, health]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-4871c514390de4c3447b7738
    resource: repo://command/ca/federation.go
  - id: openwiki-source-b1fd6484864a367818d3ab86
    resource: repo://command/ca/health.go
  - id: openwiki-source-bd45ebb80f1a74f84552aea9
    resource: repo://command/ca/root.go
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-afa1bb85ea22c4767c369398
    resource: repo://command/context/list.go
  - id: openwiki-source-046008c13a5e35bec19892a7
    resource: repo://command/context/remove.go
  - id: openwiki-source-4c7d6cc08b7c0449781d3990
    resource: repo://command/context/select.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

## What the CLI writes vs. what the server provides

`step ca bootstrap` is the trust-establishment entry point. Division of labor:

| Artifact | Owner | Written by CLI |
|---|---|---|
| Root certificate (`<$STEPPATH/certs/root_ca.crt`, 0600) | Server-provided, fingerprint-validated | Yes — `pemutil.Serialize(..., pemutil.ToFile(rootFile, 0o600))` after `client.Root(fingerprint)` (`utils/cautils/bootstrap.go:145-161`). |
| `<$STEPPATH/config/defaults.json` (0644, parent dirs 0700) | CLI | Yes — `ca-url` (normalized to https), `fingerprint`, `root`, optional `redirect-url`, `provisioner`, `min-password-length` (`utils/cautils/bootstrap.go:88-93,146-195`). |
| Contexts file (`contexts.json`) + `profiles.json` | CLI | Yes — a context is added and made current when contexts are enabled; `profiles.json` is created as `{}` (0600) on first use (`utils/cautils/bootstrap.go:197-208`). |
| System truststore entry | OS | Only with `--install`, via `truststore.InstallFile(rootFile)` (`utils/cautils/bootstrap.go:210-216`). |
| Authority metadata for team bootstrap (`url`, `fingerprint`, `redirect-url`, `provisioner`, `min-password-length`) | Server (`api.smallstep.com` or custom endpoint) | No — fetched with a plain `http.Get` and consumed to drive the same bootstrap flow. |

## `step ca bootstrap`

The action dispatches on flag combinations (`command/ca/bootstrap.go:85-112`):

- `--team` with `--ca-url` or `--fingerprint` → `IncompatibleFlagWithFlag` error.
- `--team <name> [--team-authority <sub>]` → `cautils.BootstrapTeamAuthority(ctx, team, teamAuthority)`, where `teamAuthority` defaults to **`ssh`**.
- `--team-authority` without `--team` → `RequiredWithFlag` error.
- Otherwise `--ca-url` and `--fingerprint` are both required → `cautils.BootstrapAuthority(ctx, caURL, fingerprint)`.

**Authority bootstrap** (`utils/cautils/bootstrap.go:296-316`): the default context/authority name is the CA host (port stripped, via `getHost`), overridable with `--authority`; an explicit `--redirect-url` must parse.

**Team bootstrap** (`utils/cautils/bootstrap.go:224-287`): the default endpoint is exactly
`https://api.smallstep.com/v1/teams/<team>/authorities/<teamAuthority>`,
built from a `url.URL` with host `api.smallstep.com`; a custom `--team-url` replaces the `<>` placeholder with the team name. The response is a JSON `bootstrapAPIResponse` (`url`, `fingerprint`, `redirect-url`, `provisioner`, `min-password-length`). Redirect precedence: `--redirect-url` flag > API value > default **`https://smallstep.com/app/teams/sso/success`**. The default context name is `<teamAuthority>.<team>` (e.g. `ssh.superteam`). HTTP 404 yields `error getting authority data: authority not found`.

**Core bootstrap** (`utils/cautils/bootstrap.go:98-216`):
1. Create the client with `ca.WithInsecure()` and call `client.Root(fingerprint)` — the comment *"Root already validates the certificate"*: the root is validated against the SHA-256 fingerprint before trust.
2. If contexts apply (`UseContext`: contexts enabled or `--context`/`--authority`/`--profile` set), add a `step.Context{Name, Profile, Authority}` (authority and profile default to the context name), then `SaveCurrent` + `SetCurrent`; otherwise print a warning when a legacy `config/ca.json` exists (`WarnContext`, `utils/cautils/bootstrap.go:46-54`).
3. Write the root (0600, parent 0700) and `defaults.json` (0644, parent 0700).
4. Optionally install into the system truststore with `--install`.

## Root distribution commands

- **`step ca root [<file>]`** (`command/ca/root.go:69-108`): requires `--fingerprint`, uses `ca.WithInsecure()` + `client.Root(fingerprint)` (fingerprint validation), then writes the root via `pemutil.ToFile` (or prints to STDOUT) with the same file/force semantics as other file outputs.
- **`step ca roots [<file>]`** and **`step ca federation [<file>]`** share `rootsAndFederationFlow` (`command/ca/federation.go:114-189`): the client is **not** insecure — it is built with `ca.WithRootFile(root)` where root defaults to `pki.GetRootCAPath()` and must exist (`errs.RequiredFlag` otherwise). `client.Roots()` / `client.Federation()` return server-provided certificate bundles; each certificate is PEM-serialized and concatenated, written 0600 when a file argument is given, or printed to STDOUT.
- **`step ca health`** (`command/ca/health.go:55-89`): resolves `--ca-url`/`--root` (root defaults to `pki.GetRootCAPath()`, must exist), calls `HealthWithContext` on the `/health` endpoint, and prints the response `Status` (`ok` when healthy).

## Contexts

<!-- openwiki: broken internal link [./configuration-and-state.md] file "./configuration-and-state.md" does not exist. Fix the href or restore the target, then delete this comment. -->
Contexts are the CLI's multi-environment mechanism (data model on the [configuration page](./configuration-and-state.md)). The `step context` group has four subcommands (`command/context/context.go:50-58`):

- **`current`** — prints `step.Contexts().GetCurrent()` (`command/context/current.go:47`).
- **`list`** — prints all contexts alphabetically, marking the current one with a `▶ ` prefix (`command/context/list.go:38-52`).
- **`select <name>`** — `step.Contexts().SaveCurrent(name)` and prints `ui.PrintSelected("Context", name)` (`command/context/select.go:34-42`).
- **`remove <name>`** — refuses when context management is disabled, and resolves the target by name (`command/context/remove.go:47-59`).

<!-- openwiki: broken internal link [./architecture/command-lifecycle.md] file "./architecture/command-lifecycle.md" does not exist. Fix the href or restore the target, then delete this comment. -->
Resolution order when a command runs (see the [command lifecycle page](./architecture/command-lifecycle.md)): explicit `--context`/`--authority`/`--profile` flags → current context if enabled → `defaults.json` → flag/env defaults. `UseContext` (`utils/cautils/bootstrap.go:38-44`) reports whether contexts are in play for the current invocation.
