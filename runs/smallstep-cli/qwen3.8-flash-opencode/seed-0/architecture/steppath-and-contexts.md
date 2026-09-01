---
type: architecture
title: STEPPATH, Contexts, and Local State
description: How step persists local state under $STEPPATH (defaults.json, ca.json, contexts.json, current-context.json), how context/profile/authority selection works, and which behaviors live in the external cli-utils module.
tags: [steppath, contexts, configuration, persistence]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-6669e35954f940b6199385ca
    resource: repo://command/context/current.go
  - id: openwiki-source-afa1bb85ea22c4767c369398
    resource: repo://command/context/list.go
  - id: openwiki-source-046008c13a5e35bec19892a7
    resource: repo://command/context/remove.go
  - id: openwiki-source-4c7d6cc08b7c0449781d3990
    resource: repo://command/context/select.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---

# STEPPATH, Contexts, and Local State

The `step` CLI keeps its local state in a directory tree rooted at
**`$STEPPATH`** (default `$HOME/.step`, overridable via the `STEPPATH`
environment variable). This page documents the layout and the commands that
read/write it. The resolution logic itself (`step.Path()`,
`step.BasePath()`, `step.Contexts()`, etc.) lives in the external
`github.com/smallstep/cli-utils/step` package; this repository shows the
contract through usage and help text, and page claims are limited to what the
usage sites establish.

## Base path vs per-context path

`step path` prints the active path and exposes its variants
(command/path/path.go:92-103):

- `step path` → `step.Path()` — with a selected context this resolves to
  `$STEPPATH/authorities/<context>`; with no context it is the base path.
- `step path --base` → `step.BasePath()` — always `$STEPPATH` itself.
- `step path --profile` → `step.ProfilePath()` — `$STEPPATH/profiles/<profile>`
  for the current context's profile.

The current context is stored in `$STEPPATH/current-context.json`
(`{"context": "<name>"}`), and the context catalog in
`$STEPPATH/contexts.json` mapping context names to `{authority, profile}`
objects (command/path/path.go:39-80, command/context/context.go:20-36).

The practical consequence is that anything derived from `step.Path()` —
including the default `--ca-config` value `$(step path)/config/ca.json`
(flags/flags.go:291-296) — becomes per-context, so multiple authorities can
coexist under one base path. Paths derived from `step.BasePath()`
(the plugins dir, `config/ca.json` probe, `ssh/includes`) remain global.

## The `step context` command group

The context group is a thin client over `step.Contexts()` from cli-utils:

- `context select <name>` → `step.Contexts().SaveCurrent(name)`
  (command/context/select.go:34-44).
- `context list` → prints the current context with a `▶` marker, then
  `ListAlphabetical()` for the rest (command/context/list.go).
- `context current [--json]` → `GetCurrent()`; errors `no context selected`
  when none is set (command/context/current.go).
- `context remove <name>` → removes the context and also strips the
  authority's line from `$(step path --base)/ssh/includes`, keeping SSH config
  in sync (command/context/remove.go:117).

Every context subcommand (plus `version`, `completion`, `ca bootstrap`,
`ca init`, `ssh config`) declares `flags.HiddenNoContext`
(command/context/current.go, flags/flags.go:256-262) — a hidden `--no-context` bool flag telling
the external cli-utils environment layer not to apply the current context for
that invocation, which is required for commands that manage contexts globally
rather than per-context.

## defaults.json

`step ca bootstrap` is the reference writer of
`step.DefaultsFile()` (`$STEPPATH/config/defaults.json`). After fetching the
root it (utils/cautils/bootstrap.go:144-195):

1. Creates parent directories with mode `0700`.
2. Serializes the root certificate to `pki.GetRootCAPath()` with mode `0600`.
3. Normalizes the CA URL to `https` and writes `defaults.json` (mode `0644`)
   with keys `ca-url`, `fingerprint`, `root`, and optional `redirect-url`,
   `provisioner`, `min-password-length` (utils/cautils/bootstrap.go:89-95).
4. When contexts are enabled, seeds the per-profile defaults file
   (`step.ProfileDefaultsFile()`) with `{}` at mode `0600` if absent.
5. With `--install`, additionally installs the root into the OS trust store via
   `smallstep/truststore` (utils/cautils/bootstrap.go:212-219).

Commands then read `defaults.json` implicitly through the external `step`
environment (for example, the `--identity` flag exists specifically so an
argument "can be configured in $STEPPATH/config/defaults.json",
flags/flags.go:451-457). The `ca` group's help shows the resulting file
(command/ca/ca.go:36).

## Context opt-in and warnings

Two helpers in `utils/cautils/bootstrap.go:36-54` define policy:

- `UseContext(ctx)` returns true when `step.Contexts().Enabled()` or any of
  `--context`, `--authority`, `--profile` were explicitly set — callers (such
  as `ca init`/`ca bootstrap` team flows) then create a named context with
  `step.Contexts().Add(...)`, `SaveCurrent`, and `SetCurrent`
  (utils/cautils/bootstrap.go:120-141).
- `WarnContext()` prints an advisory if a legacy `$(step path --base)
  /config/ca.json` exists but the user is not using contexts.

Note the single-`ca.json` legacy layout at the base path versus the
per-context default value of `--ca-config`: the offline flow default points at
`step.Path()` (context-aware) while the migration warning probes
`step.BasePath()` (global).

## Other state written under STEPPATH

- **Plugins:** `$(step path --base)/plugins/step-<name>-plugin` is searched
  before `PATH` (internal/plugin/plugin.go:20-52).
- **Offline CA:** `ca.json` (the certificates authority config) is the default
  `--ca-config` file consumed by `OfflineCA` (flags/flags.go:291-296,
  utils/cautils/offline.go:41-81).
- **TPM material:** `step ca certificate` defaults its
  `--tpm-storage-directory` to `$(step path)/tpm` (command/ca/certificate.go:181-184).
- **SSH client config:** the `ssh` group templates reference `StepPath` and
  `StepBasePath` (command/ssh/config.go:203-204), and
  `$STEPPATH/ssh/includes` is managed by context removal.

## Global `--config` flag

`internal/cmd/root.go:128-131` adds a top-level `--config <file>` string flag
("path to the config file to use for CLI flags"). Its application to
flag-defaults is performed by the external cli-utils environment layer during
`step.Init()`; this repository only declares the flag.

## Non-obvious behaviors and uncertainty

- Because `--ca-config`'s default is computed at flag-definition time from
  `step.Path()`, changing `STEPPATH` or the selected context between processes
  silently changes which `ca.json` offline flows load.
- This repository does not contain the code that parses `contexts.json` or
  applies `--no-context`; those semantics live in `cli-utils` and are not
  claimed here beyond the observable usage contract.

## See also

- [CLI Runtime and Plugin Dispatch](/openwiki/architecture/cli-runtime.md)
- [CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)
- [Certificate Issuance and Renewal Workflows](/openwiki/workflows/certificate-lifecycle.md)
