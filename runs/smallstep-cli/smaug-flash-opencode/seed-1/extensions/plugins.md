---
type: extension
title: Plugins and ext
description: How step discovers and runs step-<name>-plugin executables, supports Windows, and integrates the step-kms-plugin for KMS/HSM-backed keys.
tags: [plugins, kms, hsm, extension, step-cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:42:28.757Z
sources:
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-12T20:42:28.757Z" }
---

# Plugins and ext

`step` can be extended through plugin executables named `step-<name>-plugin`.
When a user runs a first-argument that is not a built-in command, the CLI
searches for and executes the corresponding plugin; if the name is a known
plugin, the CLI can point the user to its download URL.

## Plugin resolution

`plugin.LookPath(name)` searches for an executable named `step-<name>-plugin`:

- In `$STEPPATH/plugins`.
- Then in the directories listed by `PATH` (via `exec.LookPath`).

On Windows, `.com`, `.exe`, `.bat`, `.cmd`, and `.ps1` extensions are checked
in `$STEPPATH/plugins` first, then `PATH` (with `PATHEXT` extensions honored).

`plugin.Run` executes the plugin, forwarding stdin/stdout/stderr)Skip`. On
Windows, `.ps1` plugins are invoked through PowerShell
(`internal/plugin/plugin.go`).

## Dispatch in the CLI

When `step` runs and the first argument isn't a known command, `app.Action`
resolves the plugin with `plugin.LookPath` and runs it; if it is a known plugin
with a download URL (e.g. `kms`), an error instructs the user to download it
from the URL (`internal/cmd/root.go`, `internal/plugin/plugin.go`).

## KMS plugin integration

`internal/cryptoutil` ties into the `step-kms-plugin` binary. Commands can
reference keys by a KMS URI (e.g. `yubikey:`, `pkcs11:`, `tpmkms:`, `cloudkms:`,
`awskms:`, `azurekms:`) or a KMS-style name. `cryptoutil.CreateSigner(kms, key,
…)` opens a signer backed by the plugin, `cryptoutil.LoadCertificate` loads a
certificate from a KMS, and `cryptoutil.CreateAttestor` produces an attestor
for TPM-based flows (`internal/cryptoutil/cryptoutil.go`,
`utils/cautils/tpm.go`, `utils/cautils/acmeutils.go`). The KMS URI grammar and
supported types are documented by `flags.KMSUri`
(`flags/flags.go`).

Key handling routes through the plugin when `IsKMS(uri)` detects a KMS URI
(unless a real file exists with that name), so certificates and tokens can be
signed with hardware- or cloud-backed keys (see
`command/certificate/create.go`, `command/ca/token.go`).

## Well-known plugins

`plugin.GetURL` returns a download URL for known plugins; currently `kms`
points to the `step-kms-plugin` GitHub project (`internal/plugin/plugin.go`).
The README documents the plugin naming and search-path conventions and lists
the known plugins (`step-kms-plugin`, `step-kmsproxy-plugin`)
(`README.md`).

## Constraints

- Plugin extension must not be confused with the built-in plugin dispatch for
  normal commands; `--config`-style app flags are global.
- On Windows, PowerShell script plugins require `powershell` on PATH
  (`internal/plugin/plugin.go`).
