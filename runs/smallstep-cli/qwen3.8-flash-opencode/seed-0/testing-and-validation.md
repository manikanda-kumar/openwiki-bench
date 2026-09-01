---
type: operations
title: Testing and Validation
description: The step CLI's two-tier test strategy — co-located table-driven unit tests and testscript-based integration tests that run the real app — plus the make/CI validation loop.
tags: [testing, integration, testscript, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-7cb094ef8fab44ceb877ed7f
    resource: repo://integration/help_test.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-0427a29079df0e9dd1633bac
    resource: repo://integration/testdata/bogus.txtar
  - id: openwiki-source-2d42e139d28b99ef1065b6e9
    resource: repo://integration/testdata/version.txtar
  - id: openwiki-source-362b503187f3ead50d917bf1
    resource: repo://internal/cmd/root_test.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---

# Testing and Validation

Validation is split into co-located Go unit tests, black-box CLI tests built on
`github.com/rogpeppe/go-internal/testscript`, and the `make test/lint/race`
loop that CI reuses.

## Running tests locally

```sh
make test          # gotestsum -- -coverprofile=coverage.out -short -covermode=atomic ./...
make race          # gotestsum -- -race ./...
make lint          # golangci-lint (shared smallstep config) + govulncheck
go test ./utils/cautils/ -run TestOfflineCA   # focused package/run
```

The `./...` pattern includes `integration/` in the same run
(Makefile:151-152).

## Unit tests

Unit tests live next to their packages (27 non-integration `*_test.go` files)
and are predominantly table-driven:

- **Parsers/contracts:** `flags/flags_test.go`, `token/parse_test.go`,
  `token/options_test.go`, `utils/cautils/offline_test.go`
  (CaURL/Audience mapping), `utils/cautils/token_flow_test.go`
  (`TestProvisionerPromptPrompts`).
- **Command logic:** `command/ca/init_test.go`, `command/ca/sign_test.go`,
  `command/ca/health_test.go`, `command/ca/provisioner/provisioner_test.go`,
  `command/ca/policy/...`, `command/certificate/inspect_test.go`,
  `command/ssh/proxycommand_test.go`.
- **Runtime:** `internal/cmd/root_test.go` and
  `internal/command/inject_test.go`.

### The registry pin

`TestAppHasAllCommands` (internal/cmd/root_test.go:11-26) builds the app via
`newApp(io.Writer, io.Writer)` and asserts the **exact ordered list** of
top-level commands (`help, api, base64, fileserver, path, certificate,
completion, context, crl, crypto, oauth, version, ca, beta, ssh`). Adding or
renaming a top-level group fails this test until the list is updated — it is
the tripwire for the blank-import registration pattern. `TestAppRuns`
(internal/cmd/root_test.go:33-45) executes bare `step` against buffered
writers and checks help output after ANSI stripping, proving why `newApp`
takes writers as parameters.

## Integration tests (`integration/`)

The integration suite executes the **real command entrypoint** in a sandbox:

- `TestMain` registers `cmd.Run` as a testscript program named `step` via
  `testscript.Main(m, map[string]func(){"step": cmd.Run})`
  (integration/shared_test.go:11-15). Each `.txtar` script then runs in an
  isolated temp dir with its own `exec step …` invocations — no compiled
  binary needed.
- Each Go test selects scripts by path, e.g. `testscript.Run(t,
  testscript.Params{Files: []string{"testdata/version.txtar"}})`
  (integration/main_test.go:9-19).

### Script anatomy

`testdata/version.txtar` is two lines: `exec step version` +
`stdout 'Smallstep CLI/0000000-dev'` (the `0000000-dev` string is what
`git describe` yields in the test environment). `testdata/bogus.txtar` shows
negative testing: `! exec step bogus` with
`stderr 'No help topic for ''bogus'''` — this exercises the plugin-fallback
path from [CLI Runtime and Plugin Dispatch](/openwiki/architecture/cli-runtime.md).

### Fixtures and setup

- Static crypto fixtures (keys, JWKs, certs, CSRs, a malformed
  `bad-pem.crt`) live directly in `testdata/` and are referenced by scripts
  (integration/testdata).
- Tests that need generated material do it in Go `Setup` functions:
  `TestCertificateSignCommand` creates a CSR + ephemeral CA with
  `keyutil`/`minica`-style tooling and serializes them into the script's temp
  dir before running `testdata/certificate/sign.txtar`
  (integration/certificate_test.go:20-50).
- Coverage: `testdata/certificate/` (sign, verify, fingerprint, negative
  `sign-bad-csr`, `verify-bad-pem`), `testdata/crypto/` (jwk create per key
  type, jwt sign/verify/inspect, keypair, otp, help), `testdata/help/`.

### Help-quality gate

`TestHelpQuality` (integration/help_test.go:21-29) registers a custom
testscript command `check_quality` that loads a generated `report.json`
(`usage.Report` from cli-utils) and enforces headline consistency, quality
thresholds, and "no TODOs" across command help text
(integration/help_test.go:32-40). Documentation regressions in any command's
Description fail CI, not just behavior.

## CI wiring

- `ci.yml` delegates to `smallstep/workflows/.github/workflows/goCI.yml@main`
  (test + lint + CodeQL, pinned golangci-lint v2.12.1) — CI therefore runs the
  same `make test`/`make lint` surface
  (.github/workflows/ci.yml:17-30).
- `actionci.yml` validates the workflow files themselves
  (.github/workflows/actionci.yml:11-18).
- `code-scan-cron.yml` schedules the shared code scan nightly.
- Releases must pass `ci.yml` first (release.yml `needs: ci`), so these tests
  gate shipping (see
  [Build, Packaging, and Release Operations](/openwiki/operations/build-and-release.md)).

## What to run when you change X

| Change | Fastest meaningful validation |
| --- | --- |
| A command's flags/help | `make test` (help quality + registry tests) or `go test ./integration -run TestHelpQuality` |
| Token/claim logic | `go test ./token/... ./utils/cautils/` |
| CA flow behavior | unit tests above + a new/adjusted `testdata/**.txtar` case |
| New top-level command | update `TestAppHasAllCommands` list, then `make test && make lint` |
| CI workflows | `make lint` won't catch it; actionci runs on the PR |

Note the `-short` flag in `make test`: no in-repo test currently branches on
`testing.Short()`; it is passed by convention from the shared CI template.

## See also

- [Change Guide: Adding or Modifying Commands](/openwiki/changes/adding-and-modifying-commands.md)
- [Build, Packaging, and Release Operations](/openwiki/operations/build-and-release.md)
