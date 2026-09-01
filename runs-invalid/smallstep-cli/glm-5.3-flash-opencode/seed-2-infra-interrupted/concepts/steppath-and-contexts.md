---
type: on-disk-state-and-contexts
title: STEPPATH, defaults.json, and contexts
description: Where step persists client state on disk, what defaults.json contains, and how authority/profile contexts select between CA environments.
tags: [steppath, state, persistence, contexts, configuration]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:55:27.913Z
---

# STEPPATH, defaults.json, and contexts

The `step` CLI keeps its client-side state on disk under a single base path,
and layers an optional "contexts" model on top so one machine can hold several
independent CA environments. This page covers the directory model, the two
JSON files that drive it, and the commands that manage it. How that state gets
created is covered in [CA initialization and
bootstrap](/openwiki/flows/ca-init-and-bootstrap.md).

## The base path

The default base path is `$HOME/.step`, overridable with the `STEPPATH`
environment variable (`command/path/path.go:17-22`). The `step path` command
prints the effective path:

- `step path` — the *effective* path: the base path when no context is
  selected, or the current context's **authority** path otherwise (e.g.
  `$HOME/.step/authorities/machine.step-internal.net`)
  (`command/path/path.go:39-46`).
- `step path --base` — always the base path (`command/path/path.go:48-52`).
- `step path --profile` — the current context's **profile** path (e.g.
  `$HOME/.step/profiles/beta-corp`) (`command/path/path.go:61-80`).

The action just delegates to the cli-utils accessors
`step.BasePath()`, `step.ProfilePath()`, and `step.Path()`
(`command/path/path.go:92-103`); their resolution logic (env var handling,
context selection) is owned by `github.com/smallstep/cli-utils`, not this
repository.

## Directory and file layout

Established by the code and documented examples:

- `<base>/current-context.json` — selects the current context, e.g.
  `{"context": "machine.step-internal.net"}` (`command/path/path.go:39-42`).
- `<base>/contexts.json` — the context registry mapping names to
  `{profile, authority}` pairs (`command/path/path.go:63-77`,
  `command/context/context.go:21-36`).
- `<base>/authorities/<authority>` — per-authority state (certificates,
  config); `<base>/profiles/<profile>` — per-profile state. `step path`
  resolves into these when a context is active (`command/path/path.go:39-46`,
  61-80).
- `<base>/certs/root_ca.crt` — the bootstrapped root certificate; documented as
  the default root location for CA commands (`command/ca/health.go:41-43`).
- `<base>/config/defaults.json` — the default CA connection configuration
  (`command/ca/ca.go:35-41` shows it populated by `step ca bootstrap`).
- `<base>/ssh/includes` — per-authority SSH config includes; `step context
  remove` strips the removed context's authority line from this file
  (`command/context/remove.go:116-118`).

Note a documentation inconsistency: the `step ca bootstrap` help text says the
config file is created in `$STEPPATH/configs/defaults.json`
(`command/ca/bootstrap.go:28-30`), while every other reference — including the
`step ca` group examples and the `flags` package — uses
`$STEPPATH/config/defaults.json` (`command/ca/ca.go:35-41`,
`flags/flags.go:452-456`). The code itself writes to `step.DefaultsFile()`
(`utils/cautils/bootstrap.go:146`), so the file location is decided by
cli-utils.

## defaults.json

`step ca bootstrap` serializes the connection configuration into this file
(`utils/cautils/bootstrap.go:89-96, 170-185`):

```go
type bootstrapConfig struct {
	CA                string `json:"ca-url"`
	Fingerprint       string `json:"fingerprint"`
	Root              string `json:"root"`
	Redirect          string `json:"redirect-url,omitempty"`
	Provisioner       string `json:"provisioner,omitempty"`
	MinPasswordLength int    `json:"min-password-length,omitempty"`
}
```

Only `ca-url`, `fingerprint`, and `root` are always written; the rest appear
when the bootstrap flow provides them (team authority API data can set
`redirect-url`, `provisioner`, and `min-password-length`).

After bootstrap, CA commands do not need `--ca-url`, `--root`, or
`--fingerprint` for the same environment (`command/ca/bootstrap.go:32-33`), and
some flags are explicitly designed to be configured in this file — e.g. the
`identity` flag exists "so it can be configured in
$STEPPATH/config/defaults.json" (`flags/flags.go:452-456`). Command help also
documents environment-variable fallbacks, e.g. `STEP_CA_URL` and `STEP_ROOT`
for `step ca health` (`command/ca/health.go:38-43`). The mechanism that merges
defaults.json values and environment variables into a command's flags is owned
by cli-utils' command framework, not this repository.

Permissions are deliberate: bootstrap creates the containing directories with
`0700`, writes the root certificate with `0600` (`pemutil.Serialize(...,
pemutil.ToFile(rootFile, 0o600))`), and writes defaults.json with `0644`
(`utils/cautils/bootstrap.go:148-193`).

## Contexts

A context binds a **name** to an **authority** and a **profile**. Bootstrap
creates one unless contexts are disabled
(`utils/cautils/bootstrap.go:115-141`):

```go
if UseContext(ctx) {
	ctxName := ctx.String("context")       // falls back to a flow-specific default
	ctxAuthority := ctx.String("authority") // falls back to ctxName
	ctxProfile := ctx.String("profile")     // falls back to ctxName
	step.Contexts().Add(&step.Context{...})
	step.Contexts().SaveCurrent(ctxName)
	step.Contexts().SetCurrent(ctxName)
} else {
	WarnContext()
}
```

**When contexts activate.** `UseContext` returns true when
`step.Contexts().Enabled()` or any of the `--context`, `--authority`,
`--profile` flags is set (`utils/cautils/bootstrap.go:37-42`). The default
context name is flow-specific: for a team bootstrap it is
`<teamAuthority>.<team>`; for a plain authority bootstrap it is the CA URL's
hostname (`utils/cautils/bootstrap.go:283-286, 297-317`). When contexts are
*not* used but a `$STEPPATH/config/ca.json` already exists (i.e. an authority
was previously initialized), bootstrap prints a warning suggesting contexts
(`utils/cautils/bootstrap.go:46-54`).

Contexts being enabled also changes what bootstrap writes: with contexts on it
additionally creates the profile-level defaults file (`step.ProfileDefaultsFile()`)
containing `{}` (mode `0600`) if it does not exist, and prints its location
(`utils/cautils/bootstrap.go:197-210`).

Individual commands can opt out of context configuration via the hidden
`--no-context` flag (`flags.HiddenNoContext`, a hidden `BoolTFlag` that
defaults to true so it is "on" unless negated —
`flags/flags.go:256-261`); it is attached to commands like `step version` and
the `step context` subcommands themselves.

## Managing contexts

The `step context` group (`command/context/context.go:50-55`) provides four
subcommands:

- **`current`** — prints the current context name, or a JSON object
  `{name, authority, profile}` with `--json`; errors with "no context
  selected" when none is set (`command/context/current.go:46-69`).
- **`list`** — prints all contexts alphabetically, marking the current one with
  `▶` (`command/context/list.go:37-51`).
- **`select <name>`** — makes a context current via `step.Contexts().SaveCurrent`
  (`command/context/select.go:34-44`).
- **`remove <name>`** — deletes a context and its on-disk state with several
  guards (`command/context/remove.go:47-118`):
  - requires contexts to be enabled (else "step path context management not
    enabled");
  - refuses to remove the *current* context;
  - removes the authority and profile directories only if no other context
    shares them (reference-counted across the context list);
  - prompts for confirmation listing the directories to be removed unless
    `--force` is given;
  - finally removes the context's authority line from
    `<base>/ssh/includes`.

## Failure behavior and invariants

- Bootstrap is directory-creating and idempotent (`os.MkdirAll` before each
  write, `utils/cautils/bootstrap.go:148-161`); re-running it rewrites the root
  and defaults.json.
- The root is fetched and verified against the `--fingerprint` before any state
  is written (the CA client validates the certificate; see
  `utils/cautils/bootstrap.go:104-113` and [CA initialization and
  bootstrap](/openwiki/flows/ca-init-and-bootstrap.md)).
- Context mutation goes only through `step.Contexts()` in cli-utils; this repo
  never serializes contexts.json itself.

## Uncertainty

- The exact on-disk schema of `contexts.json`/`current-context.json` and the
  semantics of `Contexts().Enabled()` are owned by cli-utils; this repository
  establishes only the call patterns and the file paths shown in help text.
- `pki.GetRootCAPath()` (the default root location used by bootstrap and
  client construction) is provided by the `smallstep/certificates` module; its
  STEPPATH-context-aware resolution is not restated here as established fact.
