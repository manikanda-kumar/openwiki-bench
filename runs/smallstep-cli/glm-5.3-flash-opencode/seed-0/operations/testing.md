---
type: operations-page
title: Testing Strategy
description: How the step CLI is validated - unit tests, the testscript-based integration suite, help-quality linters, and the commands used to run them.
tags: [testing, testscript, integration, quality, gotestsum]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-f22687e3ddd183c70e3a6bc8
    resource: repo://command/ssh/proxycommand_test.go
  - id: openwiki-source-67665f65f91aa2fa5de305a4
    resource: repo://flags/flags_test.go
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-a3cf1d1249d15e362b08c110
    resource: repo://integration/crypto_test.go
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
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-1f9163faf1423abb2391c756
    resource: repo://utils/read_test.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

The repository validates itself at two levels: colocated Go unit tests, and an
integration suite that drives the real command tree in-process through scenario
scripts. Both run under `make test`; a third, cross-cutting layer lints the help
output itself.

## Running the tests

- `make test` runs `gotestsum -- -coverprofile=coverage.out -short -covermode=
  atomic ./...` — the `-short` flag is baked in, but the integration tests do not
  gate on `testing.Short()`, so they run in default test invocations
  (Makefile:151-152).
- `make race` runs the full suite under the race detector without `-short`
  (Makefile:154-155).
- `make lint` runs golangci-lint (config fetched at runtime from the shared
  smallstep/workflows repository) and `govulncheck ./...` (Makefile:166-173).
- CI runs the same checks through the reusable goCI workflow across Go versions
  with CodeQL (.github/workflows/ci.yml:19-30).

## Unit tests

Unit tests live next to the code they test, following standard Go conventions.
Examples across the tree: `flags/flags_test.go` (CA URL parsing, template data),
`utils/read_test.go`, `token/token_test.go`, `token/parse_test.go`,
`token/options_test.go`, and `command/ssh/proxycommand_test.go` (a regression
test for smallstep/cli#1641 that injects custom I/O into `proxyDirectWithIO`).
The guidance for new tests is in the adding-a-command guide: pure logic gets
table-driven unit tests; behavior that crosses the CLI boundary belongs in the
integration suite.

## The testscript integration suite

The `integration/` package uses `github.com/rogpeppe/go-internal/testscript`.
`TestMain` binds the script command `step` to `cmd.Run` — the internal entrypoint,
not a built binary — so every scenario executes the real command tree in-process
(integration/shared_test.go:11-15). Scenarios are `.txtar` files under
`integration/testdata/`; each script runs commands like `exec step version` and
asserts `stdout`/`stderr`/exit status (integration/testdata/version.txtar:1-2;
`! exec` marks expected failure, e.g. bogus.txtar's "No help topic" assertion).

The suite currently covers the version/bogus dispatch basics, the help surfaces,
and focused command families:

- **certificate**: `sign` (with Go setup generating a CSR and mini-CA via
  `go.step.sm/crypto`), `sign-bad-csr`, `verify`, `verify-bad-pem`,
  `fingerprint` (integration/certificate_test.go:20-122). A custom script command
  `check_certificate` inspects the stdout of the previous command and fails unless
  exactly one certificate was produced (certificate_test.go:124-132) — this is
  the pattern for assertions beyond testscript's built-ins.
- **crypto**: JWK create (RSA/EC/OKP/oct variants), JWT sign/verify/inspect,
  keypair, OTP, and help (integration/crypto_test.go:30-312). The JWT tests
  cross-check against an independent implementation: `createTokenUsingOpenSSL`
  shells out to `integration/openssl-jwt.sh` to sign tokens with OpenSSL and the
  suite verifies `step crypto jwt verify` accepts them (crypto_test.go:565-573) —
  a deliberate interoperability oracle.
- **help**: `testdata/help/help.txtar` snapshots help output, and
  `testdata/help/html.txtar` drives the quality linters (below).

New scenarios follow the same shape: a Go test function selecting the `.txtar`
files, an optional `Setup` that materializes fixtures in the scenario's working
directory, and optional custom `Cmds`.

## Help-quality linters

`integration/help_test.go` enforces documentation conventions mechanically
(help_test.go:15-107):

- `TestHelpQuality` runs the `check_quality` script command over a generated HTML
  report (a `usage.Report` JSON produced by the help tooling).
- `checkHeadlineConsistency` fails on any uppercase section headline outside the
  expected set (COMMANDS, DESCRIPTION, EXAMPLES, EXIT CODES, OPTIONS, POSITIONAL
  ARGUMENTS, USAGE, ...), keeping section naming uniform across the tree
  (help_test.go:59-83).
- `checkThresholds` enforces minimum word/line counts per headline — e.g. every
  EXAMPLES section needs ≥10 words on ≥1 line, POSITIONAL ARGUMENTS ≥6 words on
  ≥2 lines — so stub documentation fails CI (help_test.go:43-57, 85-97).
- `checkNoTODOs` rejects TODOs in help output (help_test.go:99-107).

This is why help text is a release artifact: the full-release pipeline regenerates
the public reference docs from the binary itself (see the build and release page).

## Coverage and blind spots

`make test` writes `coverage.out` (Makefile:152), but the repository does not
enforce a coverage threshold. What the suite does not cover is worth knowing when
changing code:

- Anything requiring a live step-ca server: `step ca certificate`, renewal,
  bootstrap — these flows are only covered indirectly by token-package unit tests
  and the offline authority code path.
- Interactive flows (OAuth browser dance, `ca init` prompts).
- Platform-specific behavior (Windows agent quirks, WSL browser opening) —
  untestable in CI.

For such changes, the source-derived reasoning in the flow pages of this wiki is
the documentation of record, and manual verification against a real CA is the
residual risk the repository accepts.
