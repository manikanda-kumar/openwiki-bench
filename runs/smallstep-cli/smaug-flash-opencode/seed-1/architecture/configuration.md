---
type: architecture
title: Configuration, STEPPATH, Contexts and Trust
description: How step resolves its working directories, persists defaults.json, manages CA contexts and profiles, and derives ca-url/root/fingerprint for CA commands.
tags: [configuration, step-path, contexts, pki, step-cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:42:28.757Z
sources:
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-4c7d6cc08b7c0449781d3990
    resource: repo://command/context/select.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
generated: { by: "opencode", at: "2026-09-12T20:42:28.757Z" }
---

# Configuration, STEPPATH, Contexts and Trust

The `step` CLI stores all per-user state under a single base path (default
`$HOME/.step`, overridable with `STEPPATH`). CA-specific configuration,
trust roots, and "context" definitions all live beneath it RD, and most CA
commands inherit `--ca-url`, `--root`, and related values from files there
unless overridden by flags.

## STEPPATH and path resolution

`step path` prints the resolved working directory and offers two variants:

- `--base` prints the base path (`$STEPPATH` or `$HOME/.step`).
- `--profile` prints the profile path of the currently-configured context.

When a current context is set (via `current-context.json`), `step path`
defaults to
`<base>/authorities/<current-context>/`, so each authority's config and trust
material is isolated. Without a current context it defaults to the base path
(`command/path/path.go`).

`step.Init()` runs at process startup in `internal/cmd/root.go`; it sets up
the base path and contexts, so every command goes through the same path
resolution before any command action runs.

## Contexts and profiles

Contexts let a machine switch between multiple CAs/teams. Context metadata
(`contexts.json`) maps context name to `authority` and `profile`. The active
context is recorded in `current-context.json` at the base path
(`command/path/path.go` usage docs).

The `step context` command group manages these:

- `step context current` prints the current context name or JSON detail.
- `step context list` lists available contexts.
- `step context select <name>` writes the selected context into
  `current-context.json`.
- `step context remove` deletes a context.

`step.Contexts().SaveCurrent(name)` persists the selection
(`command/context/select.go`).

## defaults.json and trust roots

`step ca bootstrap` downloads the root certificate and writes two files:

- The root certificate at `<base>/certs/root_ca.crt`.
- A `config/defaults.json` containing `ca-url`, `fingerprint`, `root`, and
  optionally `redirect-url`, `provisioner`, and `min-password-length`
  (`utils/cautils/bootstrap.go`).

After bootstrap, CA commands inherit `--ca-url`, `--root`, and
`--fingerprint` from defaults.json. When contexts are enabled, bootstrap also
writes a per-profile defaults file under the profile path
(`utils/cautils/bootstrap.go`).

Root path resolution: when a command's `--root` flag is empty, `pki.GetRootCAPath()` returns the default `$STEPPATH/certs/root_ca.crt`; if that file does not exist, several commands report that `--root` is required
(`utils/cautils/client.go`).

## ca-url, root and fingerprint resolution

The `flags` package centralizes CA URL parsing:

- `ParseCaURL` requires a non-empty value and enforces an `https` scheme,
  prepending `https://` when absent.
- `ParseCaURLIfExists` allows an empty value, used by flows that fall back to
  a token-derived URL (`flags/flags.go`).

`ca.NewClient` builds an online client using a parsed CA URL and a root
crt file, appending `ca.WithRootFile(root)` (`utils/cautils/client.go`).
`NewClient` returns an offline client instead when the `--offline` flag and a
`--ca-config` file are provided.

## Trust store and fingerprint

`step ca bootstrap` can `--install` the downloaded root into the system trust
store via `truststore.InstallFile` (`utils/cautils/bootstrap.go`).
`step certificate install` installs a root certificate into supported trust
stores (system, Java, Firefox) (`command/certificate/install.go`).
`coocker step certificate fingerprint` computes certificate fingerprints for
verification and token `cnf` claims.

## Deployment types and CA init

`step ca init` writes CA configuration (defaults.json, ca.json and the PKI)
under STEPPATH and, when contexts are enabled, registers a new context named
after the first DNS name. It supports standalone, linked, and hosted
(deployment) CAs, plus CloudCAS and StepCAS registration authorities
(`command/ca/init.go`).
