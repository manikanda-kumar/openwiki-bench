---
type: operations
title: Debugging and Error Handling
description: How the step CLI propagates, formats, and surfaces errors — the messenger interface, STEPDEBUG, the panic handler, exit codes, and the common validation helpers and failure modes.
tags: [operations, debugging, errors]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-90c79f73277cd4b004ddf996
    resource: repo://utils/utils.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# Debugging and Error Handling

This page explains how errors flow through the CLI and how to debug failures.
The framework behavior lives in `internal/cmd/root.go`; per-command validation
uses helpers from cli-utils' `errs` package.

## Exit codes and the run loop

`run()` (internal/cmd/root.go:50-85) is the process entrypoint:

- Returns `0` on success.
- Returns `1` when `app.Run` returns an error.
- `panicHandler` (internal/cmd/root.go:156-170) recovers panics and exits with
  code `2` (unless `STEPDEBUG=1`, in which case it re-panics so a debugger can
  capture the trace).

`utils.Fail(err)` (utils/utils.go:14-23) is a smaller helper used in some
call sites: it prints the error (the full `%+v` stack only under STEPDEBUG) and
exits with code `1`.

## Error formatting and the messenger interface

Errors can implement `interface{ Message() string }` to supply a friendly,
user-oriented message. `run()` handles both cases:

- **Messenger errors**: with `STEPDEBUG=1` it prints the full error (`%+v`) then
  the message; otherwise it prints only `messenger.Message()` followed by
  `Re-run with STEPDEBUG=1 for more info.`
- **Plain errors**: printed directly, or as `%+v` under STEPDEBUG.

All error output goes to stderr (`app.ErrWriter = stderr`); normal results go to
stdout. This keeps pipes clean for commands like `step ca token` and
`step oauth --bare` whose output is consumed programmatically.

## STEPDEBUG

`STEPDEBUG=1` enables the verbose mode used for support/debugging:

- Prints wrapped error stack traces (`%+v`) instead of just messages.
- Re-panics in `panicHandler`, printing the version and release date first.
- Affects `utils.Fail` and the panic handler's "Something unexpected happened"
  output path.

## Flag and argument validation

Nearly every command validates its flags/arguments at the top of its action
using cli-utils' `errs` helpers. These produce consistent, actionable errors:

- `errs.NumberOfArguments`, `errs.MinMaxNumberOfArguments`,
  `errs.TooFewArguments`, `errs.EqualArguments`
- `errs.RequiredFlag`, `errs.RequiredWithFlag`, `errs.RequiredUnlessFlag`,
  `errs.RequiredWithFlagValue`, `errs.RequiredInsecureFlag`
- `errs.IncompatibleFlagWithFlag`, `errs.IncompatibleFlagValue`,
  `errs.MutuallyExclusiveFlags`
- `errs.InvalidFlagValue`, `errs.InvalidFlagValueMsg`,
  `errs.MinSizeFlag`, `errs.MinSizeInsecureFlag`, `errs.FileError`

Representative use: `step ca certificate` rejects `--offline`+`--token`,
`--attestation-uri`+`--kms`, and `--token`+`--san`
(command/ca/certificate.go:238-293); `step ca token` rejects `--ssh`+`--san`,
`--host` without `--ssh`, and `--cnf`+`--cnf-file`
(command/ca/token.go:303-316).

## Common failure modes

- **`--offline` without `--ca-config`**: `NewClient`/`NewOfflineCA` return
  `errs.InvalidFlagValue(ctx, "ca-config", "", "")` (utils/cautils/client.go:53-58).
  Offline mode reads the `ca.json` created by `step ca init`.
- **Missing CA URL/root**: online commands require `--ca-url` (or a token with a
  bootstrap `sha` claim + http audience) and `--root` (or the default root at
  `pki.GetRootCAPath()`); otherwise `errs.RequiredFlag` is returned
  (utils/cautils/certificate_flow.go:146-167).
- **Token/subject mismatches**: `step ca certificate` verifies the JWK token
  subject matches the CSR common name; `step ca sign` verifies the token subject
  matches the CSR CN (except OIDC/AWS/GCP/Azure/K8sSA, validated server-side);
  `step ca revoke` checks the token subject equals the serial number.
- **CSR/key problems**: `step ca sign` requires the file to be a valid CSR with
  a valid signature; `cryptoutil.CreateSigner` reports files that do not contain
  a signable key.
- **Incompatible provisioners**: using a token flow with an ACME or SCEP
  provisioner returns a typed `ACMETokenError`/`SCEPTokeError`, which the
  certificate commands catch and translate into the ACME protocol flow.

## Failure behavior of certificate lifecycle commands

- **Renew** wraps transport/API failures as `error renewing certificate` and
  file errors as `errs.FileError`. Daemon mode logs failures to stderr
  (`ERROR: ...` logger) and retries after one minute (`durationOnErrors`)
  rather than exiting (command/ca/renew.go:549-584).
- **Revoke** validates the `--reasonCode` early (`ReasonCodeToNum`), refuses
  offline+token combinations, and reports revocation success only after the
  client call succeeds.
- **Bootstrap** surfaces errors from downloading/validating the root certificate
  as `error downloading root certificate` and refuses to proceed on a failed
  trust check.

## Config and file-safety failures

File writes use explicit modes through `fileutil.WriteFile` and `pemutil`
(keys/tokens 0600, config 0644). `errs.FileError` wraps `os` errors with the
filename. `step ca init` runs a battery of flag-compatibility checks before any
filesystem or key-generation work (command/ca/init.go:240-279), so invalid
combinations fail fast without partial state.
