---
type: architecture
title: Plugin System
description: How step discovers and executes external step-<name>-plugin executables from the plugins directory or PATH, including Windows PowerShell handling and well-known plugin resolution.
tags: [architecture, plugin, extension, subprocess]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---

# Plugin System

`step` supports user extension through plugins: executable files named
`step-<name>-plugin`. When a user runs `step <name>` and no built-in command
matches, the CLI attempts to find and run the corresponding plugin executable
(`internal/cmd/root.go:134-147`).

## Discovery and resolution order

`plugin.LookPath` (internal/plugin/plugin.go:20-52) searches for an executable
named `step-<name>-plugin`:

1. On Unix-like systems, it first checks the plugins directory
   `$(step path)/plugins` and falls back to the `$PATH` environment via
   `exec.LookPath`.
2. On Windows, it has special handling: it inspects the `PATHEXT` variable (or
   a default set of extensions), checking `$(step path)/plugins` first for
   `.com`, `.exe`, `.bat`, `.cmd`, and `.ps1` variants before consulting
   `$PATH`.

The `$(step path)` here refers to `step.BasePath()` from `cli-utils`, which by
default resolves to `$HOME/.step` (or the `STEPPATH` override).

## Execution

`plugin.Run` (internal/plugin/plugin.go:56-72) starts the plugin executable as
a subprocess with the remaining arguments, and connects its stdin/stdout/stderr
to the current process so the plugin behaves like a built-in command. On
Windows, if the resolved plugin is a PowerShell script (`.ps1` extension), it
invokes `powershell` with `-noprofile -nologo` and the script file as
arguments instead of executing the script directly.

## Well-known plugin URLs

`plugin.GetURL` (internal/plugin/plugin.go:74-82) returns the repository URL of
a handful of well-known plugins. Currently only `kms` is known and maps to
`https://github.com/smallstep/step-kms-plugin`. In `app.Action`
(root.go:134-147), if a plugin name is not found on the system but has a known
URL, the CLI prints an error directing the user to download it from that URL;
otherwise it falls back to showing help for the subcommand.

## Related

- [CLI Runtime and Command Registration](command-runtime.md) — how `app.Action` dispatches to plugins.
