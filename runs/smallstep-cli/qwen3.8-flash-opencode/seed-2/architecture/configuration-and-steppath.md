---
type: architecture
title: "Configuration, STEPPATH, and Contexts"
description: "How step persists CLI state: STEPPATH layout, contexts.json/current-context.json, defaults.json written by bootstrap, step context subcommands, and how --ca-url/--root/fingerprint values are resolved, validated, and defaulted."
tags: [configuration, steppath, contexts, bootstrap, cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-b1fd6484864a367818d3ab86
    resource: repo://command/ca/health.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-046008c13a5e35bec19892a7
    resource: repo://command/context/remove.go
  - id: openwiki-source-4c7d6cc08b7c0449781d3990
    resource: repo://command/context/select.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# Configuration, STEPPATH, and Contexts

`step` keeps persistent client state under a single root directory (`STEPPATH`) and layers named *contexts* (authority + profile pairs) on top of it. The mechanics of reading/writing these files live in the external `smallstep/cli-utils/step` package; this page documents the observable contracts from this repository's call sites and command help text.

## STEPPATH layout

- The default base path is `$HOME/.step`, overridable with the `STEPPATH` environment variable (`command/path/path.go:15-36`).
- `step path` prints the *effective* path for the current command environment: the base path when no context is configured, or `$STEPPATH/authorities/<authority>` when a current context exists (`command/path/path.go:38-46`, action at `command/path/path.go:92-103`). `--base` returns the raw `STEPPATH` base, `--profile` returns `$STEPPATH/profiles/<profile>` of the current context (`command/path/path.go:48-77`).
- The base directory holds `contexts.json` (the context registry: name → `{authority, profile}`) and `current-context.json` (`{"context": "<name>"}`) as the selected-context pointer (`command/path/path.go:40-77`, `command/context/context.go:21-35`).
- Other consumers anchor into this layout: plugins live in `$(step BasePath)/plugins` (`internal/plugin/plugin.go:40-51`), the TPM key directory defaults under `step.Path()` (`command/ca/certificate.go:183`), and SSH config templates receive `StepPath`/`StepBasePath` plus the active context name (`command/ssh/config.go:200-210`).

## Contexts

A context binds an *authority* (where certs/state live) to a *profile* (identity state), letting one machine talk to several CAs. The registry is manipulated exclusively through `step.Contexts()` — `Add`, `Get`, `List`, `Remove`, `GetCurrent`, `SaveCurrent`, `SetCurrent`, `Enabled`, `Apply` — from cli-utils (`command/context/select.go:39`, `command/context/remove.go:53-70`, `command/ssh/config.go:147`).

The `step context` group exposes four subcommands (`command/context/context.go:50-55`):

- `select <name>` persists the choice via `step.Contexts().SaveCurrent(name)` (`command/context/select.go:34-43`).
- `current` prints the current context object (`command/context/current.go:46-48`).
- `list` enumerates contexts, marking the current one (`command/context/list.go:38`).
- `remove <name>` refuses when contexts are disabled, when the name is unknown, or when it is the current context; it computes whether the target's authority/profile directories are shared with any other context, prompts (skippable with `--force`) before `os.RemoveAll` of the unshared authority/profile directories, removes the registry entry, and strips the authority line from `$STEPPATH/ssh/includes` (`command/context/remove.go:48-118`).

Contexts are created implicitly: `step ca bootstrap` and `step ca init` add a `{name, authority, profile}` context, `SaveCurrent`, and `SetCurrent` when context usage is active. `UseContext` is true when `step.Contexts().Enabled()` or when any of `--context`/`--authority`/`--profile` was passed; otherwise bootstrap falls back to legacy behavior and warns if `config/ca.json` already exists (`utils/cautils/bootstrap.go:36-54`, `utils/cautils/bootstrap.go:115-144`, `command/ca/init.go:545-568`). Commands can opt out of context application entirely with the hidden `--no-context` BoolT flag (`flags/flags.go:256-264`).

## defaults.json and bootstrap

`step ca bootstrap` records the trust anchor and CA location in `$(step path --base)/config/defaults.json` — keys `ca-url`, `fingerprint`, `root` — which is then consulted by later commands and shown in the `step ca` group's help (`command/ca/ca.go:31-42`). The authoritative writer is `cautils.bootstrap`:

1. It creates an *insecure* `ca.Client` and calls `client.Root(fingerprint)`; the root endpoint download itself verifies the certificate against the expected SHA-256 fingerprint before anything is trusted (`utils/cautils/bootstrap.go:104-113`).
2. It serializes the verified root to `pki.GetRootCAPath()` (0600 under a 0700 directory) and writes `defaults.json` with the URL normalized to https via `utils.CompleteURL`, the fingerprint, and the stored root path, then mirrors those values into the live `cli.Context` (`utils/cautils/bootstrap.go:145-195`).
3. When contexts are enabled it seeds an empty `profile-defaults.json` (`step.ProfileDefaultsFile()`) if missing (`utils/cautils/bootstrap.go:197-210`), and with `--install` it pushes the root into the OS trust store via `truststore.InstallFile` (`utils/cautils/bootstrap.go:212-219`).

`bootstrapAction` supports two mutually-exclusive sources: explicit `--ca-url` + `--fingerprint`, or `--team` (optionally `--team-authority`, defaulting to `ssh`) which fetches `{url, fingerprint, redirect-url, provisioner, min-password-length}` from `https://api.smallstep.com/v1/teams/<team>/authorities/<authority>` (overridable with `--team-url`; an explicit `--redirect-url` wins over the API value) (`command/ca/bootstrap.go:85-112`, `utils/cautils/bootstrap.go:224-294`).

## Resolution and validation of CA-targeting flags

At request time, `cautils.NewClient` requires either `--offline` or a parsed `--ca-url` plus a root file: when `--root` is unset it silently defaults to `pki.GetRootCAPath()` and errors (`errs.RequiredFlag`) only if that default doesn't exist on disk (`utils/cautils/client.go:50-74`). `flags.ParseCaURL` enforces scheme policy — prepending `https://` when absent and rejecting non-https URLs — and repairs bracketless IPv6 hosts; `ParseCaURLIfExists` allows the empty case for best-effort paths (`flags/flags.go:645-705`). The same https-normalization rule applies at write time through `utils.CompleteURL` (`utils/cautils/bootstrap.go:163-167`).

Environment variables participate through urfave/cli's `EnvVar` plumbing: the help text for `step ca health` documents `STEP_CA_URL` and `STEP_ROOT` as sources for those flags (`command/ca/health.go:38-41`), and the `--config <file>` flag registered on the root app loads CLI flag defaults from a JSON file (`internal/cmd/root.go:127-131`). Exact precedence between context profiles, environment variables, and explicit flags is implemented inside cli-utils (not in this tree), so this repository does not establish an ordering beyond "explicit flags win over context-derived values" — e.g. bootstrap stores values back with `ctx.Set` only after validating user input.

Offline mode closes the loop between configuration and signing: `flags.CaConfig` defaults to `<step path>/config/ca.json` *computed against the current context path*, so `step ca certificate --offline` transparently uses the active context's CA configuration (`flags/flags.go:289-296`).

## See also

- How these flags feed the request pipeline: [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md)
- Where command registration applies these flags: [Command Framework and Registration](/openwiki/architecture/command-framework.md)
- Process and module boundaries: [System Architecture Overview](/openwiki/architecture/overview.md)
