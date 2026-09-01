---
type: "Reference"
title: "STEPPATH, Configuration, and Contexts"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
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
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---


# STEPPATH, Configuration, and Contexts

`step` keeps all of its persistent state in a single base directory, `$STEPPATH`
(default `$HOME/.step`, overridable with the `STEPPATH` environment variable).
From that base, the CLI derives where it stores CA configuration, root
certificates, contexts, profiles, and provisioner material. The actual path
logic lives in the external `github.com/smallstep/cli-utils/step` package; this
page describes the on-disk model as exercised by `step path`, `step context`,
and the bootstrap flow.

## The path model

`step path` prints the derived path:

- `step path` prints the **authority path**: the base path when no context is
  selected, or `$STEPPATH/authorities/<context>` when a current context is
  configured.
- `step path --base` prints the base path (`$STEPPATH`).
- `step path --profile` prints the current profile path, `$STEPPATH/profiles/<profile>`.

So the on-disk layout is hierarchical per context and profile:

```
$STEPPATH/                        # base path (default $HOME/.step)
├── authorities/<context>/        # per-authority config (path of a context)
├── profiles/<profile>/           # per-profile config (path of a profile)
├── config/
│   ├── ca.json                   # CA configuration (--ca-config default)
│   └── defaults.json             # bootstrap authority config
├── certs/root_ca.crt             # downloaded root certificate
├── contexts.json                 # context definitions (name -> authority/profile)
└── current-context.json          # name of the current context
```

## Contexts

Contexts bundle a name, an **authority**, and a **profile** so users can switch
between step-ca environments. They are managed with `step context`:

- `step context list` lists contexts alphabetically, marking the current one
  with a `▶` prefix.
- `step context select <name>` sets the current context by persisting it
  (`step.Contexts().SaveCurrent`), which is what writes
  `current-context.json`.
- `step context current` prints the current context name, or JSON containing
  `name`, `authority`, and `profile` with `--json`; it errors with
  "no context selected" when none is set.
- `step context remove <name>` removes a context and its associated
  configuration. It refuses to remove the current context, and it only
  deletes the authority and/or profile directories that are not shared with
  another context. Unless `--force` is given it prompts for confirmation
  before deleting. It also tries to remove the authority line from the SSH
  includes file at `$STEPPATH/ssh/includes`.

Contexts are considered "enabled" either globally
(`step.Contexts().Enabled()`) or per-invocation through the `--context`,
`--authority`, and `--profile` flags. The `--no-context` hidden flag
(`flags.HiddenNoContext`) opts a single command out of context application; the
context subcommands themselves declare it to avoid recursion.

## Bootstrap configuration

`step ca bootstrap` (and `step ca bootstrap --team ...`) populates this layout.
The shared `bootstrap()` flow in `utils/cautils/bootstrap.go`:

1. Connects to the CA with an insecure client and downloads the root
   certificate, validating it against the provided fingerprint.
2. Creates the parent directories with `0700` permissions.
3. Writes the root certificate PEM to `pki.GetRootCAPath()` (mode `0600`).
4. Writes an authority configuration JSON to `step.DefaultsFile()`
   (`config/defaults.json`, mode `0644`) containing `ca-url`, `fingerprint`,
   `root`, and optionally `redirect-url`, `provisioner`, and
   `min-password-length`.
5. Sets `ca-url`, `fingerprint`, and `root` in the CLI context so subsequent
   commands in the same invocation use the bootstrapped values.
6. If contexts are in use (enabled globally, or `--context`/`--authority`/
   `--profile` passed), it adds a new context (default name `<authority>.<team>`
   for team bootstraps, or the CA hostname otherwise), makes it current, and
   creates an empty profile defaults file (`step.ProfileDefaultsFile()`, mode
   `0600`).
7. If `--install` is set, it installs the root into the system trust store via
   `github.com/smallstep/truststore`.

When not using contexts, bootstrap emits a warning recommending contexts if an
older `config/ca.json` already exists.

## Flags tied to configuration

- `--ca-config` defaults to `$(step path)/config/ca.json` and selects the CA
  configuration file used by offline mode and `step ca init`.
- `--root` overrides the root certificate path; when empty, commands fall back
  to `pki.GetRootCAPath()`.
- `--context`, `--authority`, and `--profile` select the context to apply for
  a single invocation.

The filesystem effect of the config flags is that CA commands resolve the root
certificate and defaults from `$STEPPATH` rather than hard-coding paths.
