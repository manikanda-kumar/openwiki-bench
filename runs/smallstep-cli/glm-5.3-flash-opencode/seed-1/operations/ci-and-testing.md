---
type: ci-and-testing-infrastructure
title: CI and Testing
description: How the repository verifies changes — GitHub Actions CI, unit tests, the testscript integration harness, linting, vulnerability scanning, and release-time doc generation.
tags: [testing, ci, integration-tests, testscript, linting, workflows]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
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
  - id: openwiki-source-2d42e139d28b99ef1065b6e9
    resource: repo://integration/testdata/version.txtar
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-fe701a9db3b467667b0bc90d
    resource: repo://token/token_test.go
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# CI and Testing

## CI workflow

`.github/workflows/ci.yml` triggers on pushes to `master` (excluding `v*`
tags), pull requests, and `workflow_call`. It delegates to the reusable
`smallstep/workflows` `goCI.yml` with CodeQL enabled, multiple Go versions, and
a pinned golangci-lint version (`v2.12.1`); concurrency is grouped per PR/ref
with cancel-in-progress (repo://.github/workflows/ci.yml). Supporting workflows
cover scheduled code scans, dependabot auto-merge, package publishing, and
triage (repo://.github/workflows/code-scan-cron.yml, repo://.github/workflows/dependabot-auto-merge.yml,
repo://.github/workflows/publish-packages.yml).

## Local development loop

`make test` runs the unit test suite in short mode with atomic coverage via
`gotestsum`; `make race` runs with `-race`. `make lint` runs golangci-lint
(config fetched at runtime from the smallstep/workflows repository) plus
`govulncheck`. `make bootstrap` installs the toolchain (golangci-lint,
govulncheck, gotestsum, goimports, GoReleaser Pro) (repo://Makefile#L104-L174).
`docs/local-development.md` and `docs/CONTRIBUTING.md` describe the workflow
(repo://docs/local-development.md, repo://docs/CONTRIBUTING.md).

## Unit test layout

Unit tests live next to the code they cover — e.g. `token/token_test.go`,
`utils/cautils/token_flow_test.go`, `flags/flags_test.go`,
`internal/kdf/kdf_test.go`, `command/ca/init_test.go` — and use
`testify/require` plus the `smallstep/assert` helper (repo://token/token_test.go,
repo://flags/flags_test.go).

## Integration harness: testscript

The integration suite in `integration/` uses
`github.com/rogpeppe/go-internal/testscript`, which executes scenario scripts
against the *in-process* CLI: `TestMain` registers the `step` entrypoint as
`cmd.Run`, so scripts invoke the real command tree without spawning a separate
binary (repo://integration/shared_test.go#L9-L14).

Scenarios are `.txtar` archives under `integration/testdata/`, registered via
`testscript.Run` with explicit `Files` lists (repo://integration/main_test.go#L9-L19).
For example, `testdata/version.txtar` runs `exec step version` and asserts
stdout matches `Smallstep CLI/0000000-dev` (repo://integration/testdata/version.txtar).
Go-level fixtures are prepared in a `Setup` hook: `certificate_test.go`'s
`TestCertificateSignCommand` generates a CA/CSR with `go.step.sm/crypto`
helpers, serializes them into the test working directory, and then runs the
`sign.txtar` scenario (repo://integration/certificate_test.go#L17-L53).

The harness covers help output (`testdata/help/help.txtar`, `html.txtar`),
certificate flows (`certificate/sign.txtar`, `verify.txtar`,
`fingerprint.txtar`), and crypto flows (`crypto/jwt-*.txtar`,
`crypto/jwk-create-*.txtar`, `crypto/otp.txtar`, `crypto/keypair.txtar`)
(repo://integration/crypto_test.go, repo://integration/help_test.go).

## Release workflow and reference docs

`.github/workflows/release.yml` fires on `v*` tags. It first runs CI, extracts
version metadata (and computes `IS_PRERELEASE` from `-rc` tags), then reuses
shared workflows from `smallstep/workflows` for GoReleaser (with
`enable-packages-upload`) and for multi-arch Docker builds of both the Alpine
(`smallstep/step-cli:<version>`, `latest` on full releases) and Debian
(`:<version>-trixie`) images (repo://.github/workflows/release.yml).

For full (non-rc) releases, the `update_reference_docs` job builds the binary
and regenerates the CLI reference into the separate `smallstep/docs`
repository using `step help --markdown`, rebuilding the docs route manifest
with `jq` (repo://.github/workflows/release.yml update_reference_docs job).

## Failure behavior and invariants

- CI is a required gate for releases: the `goreleaser` job `needs: ci`
  (repo://.github/workflows/release.yml).
- Integration assertions run inside the same process as the CLI; a panic in a
  command is caught by the app-level panic handler, not by the test framework
  (repo://internal/cmd/root.go#L156-L170, repo://integration/shared_test.go#L9-L14).
- The version assertion `Smallstep CLI/0000000-dev` shows that integration
  tests run against an unversioned dev build rather than a released version
  string (repo://integration/testdata/version.txtar).
