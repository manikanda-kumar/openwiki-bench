---
type: state-model-concept
title: STEPPATH, Contexts, and Configuration
description: The on-disk state model of the step CLI - $STEPPATH layout, defaults.json, ca.json, contexts, environment variables, and how CA commands resolve ca-url and root.
tags: [steppath, contexts, defaults-json, ca-json, configuration, environment]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-b1fd6484864a367818d3ab86
    resource: repo://command/ca/health.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-57260b234ea7f7b2e5fd2415
    resource: repo://command/completion/completion.go
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
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

Most `step` commands operate against on-disk state rooted at a single directory.
Understanding where that state lives and how it is resolved is prerequisite knowledge
for the CA, SSH, and context command families.

## $STEPPATH resolution

The `$STEPPATH` root is resolved by the external cli-utils `step` package during
`step.Init()`, which runs before any command executes
(internal/cmd/root.go:54-57). By default it is `$HOME/.step`, overridable with the
`STEPPATH` environment variable; `step path` prints the resolved value, `--base`
prints the base even under contexts, and `--profile` prints the current profile's
path (command/path/path.go:17-59, 92-103). Within the base directory, the code and
help text establish these conventions:

- `certs/root_ca.crt` — the default root certificate location. `pki.GetRootCAPath()`
  (from the external certificates module) is the canonical accessor, and commands
  fall back to it when `--root` is empty: `step ca health` (command/ca/health.go:67-74),
  `step ca token` (command/ca/token.go:351-357), and every flow that resolves a root
  default. Bootstrap writes the downloaded root there with mode 0600
  (utils/cautils/bootstrap.go:145-161).
- `config/defaults.json` — the client-side authority configuration (see below).
- `config/ca.json` — the CA server configuration used by offline mode; the
  `flags.CaConfig` flag defaults to `$(step path)/config/ca.json`
  (flags/flags.go:290-296).
- `plugins/` — the first search location for `step-<name>-plugin` executables
  (internal/plugin/plugin.go:40-51).
- `contexts.json` and `current-context.json` — the context registry and the
  currently selected context, documented via `step path` examples
  (command/path/path.go:39-47, 62-80).
- `ssh/includes` — per-authority SSH config includes; context removal strips the
  authority's line from this file (command/context/remove.go:116-118).

One documented discrepancy worth knowing: the `step ca bootstrap` help text says
defaults.json lives in `$STEPPATH/configs/defaults.json` (command/ca/bootstrap.go:29),
but the code writes to `step.DefaultsFile()` (utils/cautils/bootstrap.go:146, 191) and
the `step ca health` help text locates it at `$STEPPATH/config/defaults.json`
(command/ca/health.go:38-43). The code path (`step.DefaultsFile()`) is authoritative;
the `configs/` spelling in the help text appears to be stale.

## defaults.json: the client's authority configuration

`step ca bootstrap` is the primary writer of defaults.json. Its `bootstrap()`
helper (utils/cautils/bootstrap.go:98-222):

1. Creates an insecure step-ca client and fetches the root by fingerprint with
   `client.Root(fingerprint)` — the fingerprint is validated during download
   (bootstrap.go:104-113).
2. Normalizes the CA URL to https via `utils.CompleteURL` (bootstrap.go:163-167).
3. Serializes the root to `pki.GetRootCAPath()` (mode 0600) and writes a
   `bootstrapConfig` JSON document to `step.DefaultsFile()` (mode 0644) with keys
   `ca-url`, `fingerprint`, `root`, and optional `redirect-url`, `provisioner`,
   `min-password-length` (bootstrap.go:89-96, 170-195; struct at bootstrap.go:89-96).
4. Pushes `ca-url`, `fingerprint`, and `root` back into the CLI context so the
   invoking command can use them without re-reading the file (bootstrap.go:187-189).
5. Optionally installs the root into the system trust store with `--install`
   (bootstrap.go:212-219).
6. When contexts are enabled, also creates/sets the context (bootstrap.go:115-144)
   and writes an empty profile-scoped defaults file `{}` if absent
   (bootstrap.go:197-210).

After bootstrap, `step ca` commands work without `--ca-url`/`--root`, as the
bootstrap help text documents (command/ca/bootstrap.go:32-33).

## How CA commands resolve ca-url and root

The resolution order implemented in the `flags` package is: explicit flag →
environment variable → defaults.json, with https enforcement. Concretely:

- `flags.ParseCaURL` requires a non-empty `--ca-url` (unless `--offline`) and
  `flags.ParseCaURLIfExists` tolerates empty; both prepend an `https` scheme when
  missing and reject non-https schemes, with IPv6 bracket normalization
  (flags/flags.go:645-706). The `--ca-url` flag definition itself is plain
  (flags/flags.go:244-248); the fallback to env/defaults happens inside the
  urfave/cli flag sources configured by cli-utils (environment variables
  `STEP_CA_URL` for `--ca-url` and `STEP_ROOT` for `--root`, as documented in the
  `step ca health` help text at command/ca/health.go:36-43, and defaults.json values
  loaded by `step.Init()`). The repository does not re-implement that precedence;
  it relies on the external cli-utils flag wiring.
- The root flag (`flags.Root`, flags/flags.go:250-254) follows the same pattern:
  empty value → fall back to `pki.GetRootCAPath()`, and error as a required flag if
  that file does not exist (command/ca/health.go:67-74, command/ca/token.go:351-357).
- `flags.FirstStringOf` is the generic "first defined flag wins, then first
  non-empty default" helper used where multiple flags can carry the same value
  (flags/flags.go:708-729).

`step ca health` is the minimal consumer of this machinery: parse CA URL, resolve
root, build a `ca.NewClient` with `ca.WithRootFile`, and call
`HealthWithContext` (command/ca/health.go:57-88).

## Contexts

Contexts let one machine hold several authority/profile configurations side by side.
The model, per the `step path` and `step context` documentation: `contexts.json`
maps context names to `{authority, profile}` pairs, and `current-context.json`
selects the active one; the active context redirects `step path` into
`$STEPPATH/authorities/<name>` and `$STEPPATH/profiles/<name>`
(command/path/path.go:39-80, command/context/context.go:18-49). Implementation of
the context store lives in the external cli-utils `step` package; this repository's
touchpoints are:

- `cautils.UseContext(ctx)` decides whether context mode applies: enabled globally,
  or when `--context`, `--authority`, or `--profile` is set
  (utils/cautils/bootstrap.go:36-42). `cautils.WarnContext` warns users who already
  have a `config/ca.json` but are not using contexts (bootstrap.go:44-54).
- `step context` manages them: `select` persists the default via
  `step.Contexts().SaveCurrent` (command/context/select.go:34-44), `current` prints
  the active context (command/context/current.go:46-70), `list` marks the current
  one with `▶` (command/context/list.go:37-52), and `remove` deletes a context
  (command/context/remove.go:47-118).
- `flags.HiddenNoContext` is the hidden `--no-context` BoolT flag that prevents
  context-specific environment from being applied for a single command invocation
  (flags/flags.go:256-262); it is attached to commands that must not inherit context
  state, such as `step version` (command/version/version.go:21-23), `step
  completion` (command/completion/completion.go:39-41), and `step context remove`
  (command/context/remove.go:40-43).
- `ca init` also participates: it checks `UseContext`/`WarnContext` and, in context
  mode, registers and saves the newly initialized context (command/ca/init.go:299-302
  and the context-save block within `initAction`).

### Context removal semantics

`step context remove` refuses to remove the current context (remove.go:62-64),
computes whether the target's authority/profile directories are shared with other
contexts (remove.go:66-82), prompts for confirmation unless `--force` — and only
skips the prompt when both directories are shared (remove.go:84-100) — then removes
unshared directories with `os.RemoveAll`, removes the context from the registry, and
cleans the SSH include line (remove.go:102-118).

## Offline mode and ca.json

`--offline` (flags.Offline, flags/flags.go:282-288) switches CA commands from the
network client to an in-process authority built from the CA server configuration
file. The file defaults to `$(step path)/config/ca.json` via `flags.CaConfig`
(flags/flags.go:290-296). `--offline` is incompatible with token template data
(`step ca token` rejects `--set`/`--set-file` under offline at
command/ca/token.go:397-405). The mechanics of the in-process authority are covered
by the issuance flow page.

## Uncertainty note

The exact env-var names, defaults.json precedence, and context storage format are
implemented in the external `smallstep/cli-utils` module rather than this
repository. The repository's own evidence (help texts and call sites cited above)
establishes the observable behavior; the internal precedence rules of
`step.Init()` and `step.Contexts()` cannot be confirmed from this codebase alone.
