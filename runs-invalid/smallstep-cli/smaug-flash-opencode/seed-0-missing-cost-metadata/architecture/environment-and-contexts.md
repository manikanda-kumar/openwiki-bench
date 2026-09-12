---
type: "Reference"
title: "Step Environment, STEPPATH, and CA Contexts"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-6669e35954f940b6199385ca
    resource: repo://command/context/current.go
  - id: openwiki-source-afa1bb85ea22c4767c369398
    resource: repo://command/context/list.go
  - id: openwiki-source-046008c13a5e35bec19892a7
    resource: repo://command/context/remove.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---


# Step Environment, STEPPATH, and CA Contexts

The `step` CLI stores its configuration and trust material on disk under a
"step path". This page covers that layout, the defaults/bootstrap files, and the
multi-authority "contexts" feature that lets one machine talk to several CAs.

## The step path and its layout

The step path defaults to `$HOME/.step` and is overridable via the `STEPPATH`
environment variable. `step path` (`command/path/path.go`) prints the current
effective path and supports `--base` (the base step path) and `--profile` (the
current default profile's path).

When contexts are in use, `step path` returns the current *authority* path rather
than the base path. Its help documents the layout:

- `$STEPPATH/certs/root_ca.crt` — the trust root for the configured CA.
- `$STEPPATH/config/defaults.json` — stored default flag values.
- `$STEPPATH/config/ca.json` — the offline CA configuration produced by
  `step ca init`.
- `$STEPPATH/current-context.json` — `{"context": "<name>"}` marking the current
  context.
- `$STEPPATH/contexts.json` — the map of context name -> `{authority, profile}`.
- `$STEPPATH/profiles/...` and `$STEPPATH/authorities/...` — per-profile/
  per-authority working directories.

The `-config <file>` global flag from `internal/cmd/root.go` lets users load
default flag values from an arbitrary JSON file instead of `defaults.json`.

Much of the path/context plumbing (the `step.Contexts()` singleton, file paths,
and current-authority resolution) lives in the external `smallstep/cli-utils/step`
dependency, which this repository only calls. The behavior described below is
grounded in the source that this repository owns (the `command/path`,
`command/context`, and `command/ca/bootstrap` packages), while path details that
reside in cli-utils are only referenced indirectly.

## defaults.json and bootstrap

`step ca bootstrap` (`command/ca/bootstrap.go`) is the typical entrypoint for
preparing a client for a CA. With `--ca-url` and `--fingerprint`, or with
`--team`/`--team-authority`, it configures the environment.

The authoritative implementation is `cautils.BootstrapAuthority`/`bootstrap`
(`utils/cautils/bootstrap.go`). It:
1. Creates an insecure `ca.NewClient` and calls `client.Root(fingerprint)` to
   download the root, whose fingerprint pins the certificate.
2. Optionally registers a context (when `UseContext` is true: when contexts are
   enabled or `--context`/`--authority`/`--profile` is set).
3. Writes the root to `pki.GetRootCAPath()` (i.e. `$STEPPATH/certs/root_ca.crt`).
4. Writes `defaults.json` at `step.DefaultsFile()` with the `ca-url`, the
   fingerprint, the root path, optional `redirect-url`, `provisioner`, and
   `min-password-length`.
5. Optionally installs the root into the system trust store when `--install` is
   passed.

The bootstrapped `defaults.json` becomes the source for subsequent commands that
read `--ca-url`, `--root`, etc. via the cli-utils defaults mechanism.

`BootstrapTeamAuthority` fetches the CA URL/fingerprint and other attributes from
an HTTP endpoint — by default `https://api.smallstep.com/v1/teams/<team>/authorities/<authority>` —
and honors `--team-url` (with `<>` replaced by the team ID) and `--redirect-url`.
This endpoint is external to the repository; its exact contract is only implied
by `bootstrapAPIResponse`.

## Contexts

`step context` (`command/context/context.go`) manages named contexts, each with
an `authority` and a `profile`. `step context list` lists contexts, marking the
current one with `▶`; `step context current [--json]` prints the current context
name and, with `--json`, its `name`/`authority`/`profile`; `step context select`
sets the current context; `step context remove` deletes a context's authority
and profile directories (keeping ones still referenced by other contexts), its
entry in `contexts.json`, and its line in `$STEPPATH/ssh/includes`.

When a context is active, CA commands resolve their flags from the context's
profile defaults rather than purely from `defaults.json`, which is what lets one
machine target multiple authorities. The context feature is exposed through
`step.Contexts()`; its on-disk details live in cli-utils.

## Relationships to the CA flows

The `flags` package (`flags/flags.go`) defines `--ca-url`, `--root`,
`--ca-config` (defaulting to `$(step path)/config/ca.json`), `--context`,
`--profile`, `--authority`, and `--no-context`. Clients built by
`cautils.NewClient`/`ParseCaURL` rely on the defaults loaded from `defaults.json`
(and contexts) to fill in unset flagsusing the cli-utils step environment. See the
[CA flows](ca-online-offline-flows.md) page for how these flags drive client
construction.
