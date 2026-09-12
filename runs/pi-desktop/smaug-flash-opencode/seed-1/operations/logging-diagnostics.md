---
type: reference
title: Logging and Diagnostics
description: The rotating main-process log, log sanitization and redaction, diagnostics export and its privacy rules, crash reporting, and the packaged startup/custom validation reports.
tags: [logging, diagnostics, redaction, crash-reporting, validation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-a8c37ae25e6ba3e4e8557ccd
    resource: repo://src/main/diagnostics-redaction.ts
  - id: openwiki-source-4409b8bcec1076bcf5e8ef33
    resource: repo://src/main/diagnostics.ts
  - id: openwiki-source-7d4ff0d4e0ab85b2b91fbb5a
    resource: repo://src/main/logger-core.ts
  - id: openwiki-source-4d903eaf7a3b75c622fde541
    resource: repo://src/main/logger.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Logging and Diagnostics

This page documents how Pi Agent Desktop writes its main log, how it is
sanitized and redacted, how diagnostics are exported, how crash reports are
handled, and the packaged startup/custom validation reports.

## Main log

`src/main/logger.ts` routes Main-process messages to an
`AsyncRotatingFileLogger` (`src/main/logger-core.ts`) at
`<logs>/main.log`.

- Each line is timestamped and passed through `sanitizeLogLine` before write.
- The file rotates at 5 MiB across 3 generations (`logger.ts:8-9`), with an
  in-memory queue of 512 KiB, a 50ms flush interval, and dropped-entry
  accounting. On write failure entries are restored and retried at 1s
  (`logger-core.ts:93-225`).
- In dev, lines are also printed to the console and Host stdout/stderr are
  line-buffered into the log with `HostOutputLineBuffer`
  (`logger.ts:27-29`, `logger-core.ts:23-81`).

### Sanitization

`sanitizeLogLine` (`logger-core.ts:10-21`) collapses newlines, and redacts:

- private-key material → replaced wholesale;
- `Bearer <token>`;
- common secret assignments (`authorization`, `token`, `password`, `secret`,
  `api_key`, `cookie`, `set-cookie`, …);
- credentials embedded in URLs (`proto://user:pass@`).

It also bounds every line to 16k chars with a truncation marker.

## Diagnostics export

`exportDiagnostics` (`src/main/diagnostics.ts`) produces an explicitly
user-selected, redacted diagnostic folder:

- `system.json` — versions, platform, and a privacy note; paths are shown as
  static markers (`<userData>`, `<logs>`, `$HOME`).
- `toolchains.json` and `browser.json` when available.
- `main.log` and every `*.log` under the logs dir are **copied redacted**:
  bounded to 5 MiB, passed through `redactDiagnosticText`, and kept mode `0o600`.
- **Crash dumps are exported as metadata only** (`crash-dumps.json` with
  filename/size/mtime) — never raw dumps, because minidumps can contain process
  memory and credentials; a user may separately share a raw dump after review
  (`diagnostics.ts:73-76`).

`redactDiagnosticText` (`diagnostics-redaction.ts`) replaces the userData/logs/
home paths (with forward/back-slash variants) with static labels, redacts
authorization/proxy headers and sensitive env names (`NODE_AUTH_TOKEN`,
`NPM_TOKEN`, `PIP_INDEX_URL`, proxies, tokens/passwords/keys), and removes other
credential-like patterns.

Export is best-effort and never blocks on an unavailable log directory.

## Crash reporting

`crashReporter.start` is configured with `uploadToServer: false` and
`compress: false` (`main.ts:44-48`) — crash reports stay local on disk; nothing
is uploaded automatically. Reach export via the `desktop:export-diagnostics`
path and the Settings UI.

## Packaged startup/custom validation reports

- A packaged run with `--validate-packaged-startup` writes
  `packaged-startup-check.json` to `userData` (app/pi version, platform,
  revision, renderer/host readiness, host ack revision, bundled search health)
  and exits (0 on success). A 45s guard timer fails the check
  (`main.ts:51-52`, `:108-166`).
- A packaged run with `--validate-packaged-cleanup-fault` runs
  `runPackagedCleanupFaultValidation` and writes
  `packaged-cleanup-fault-check.json`, verifying managed-process cleanup can be
  confirmed under the production deadline (`main.ts:54-55`, `:369-390`).

These reports exist so CI/ops can validate that a freshly packaged instance
actually starts with the expected Pi + toolchain and shuts down cleanly.

## Related pages

- Architecture Overview
- Agent Host Supervision and Resilience
- Updates and Packaging
- Persistence and State Surface
