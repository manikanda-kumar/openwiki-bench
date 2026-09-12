---
type: testing
title: Testing and Integration Tests
description: How the step CLI repository is tested — co-located unit tests, the go-internal testscript integration suite, and the Makefile, CI, and GoReleaser build pipeline.
tags: [testing, go-internal, testscript, goreleaser, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-67665f65f91aa2fa5de305a4
    resource: repo://flags/flags_test.go
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-a3cf1d1249d15e362b08c110
    resource: repo://integration/crypto_test.go
  - id: openwiki-source-0a16b950c7efe8121f8f5cbe
    resource: repo://internal/kdf/kdf_test.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---

## Responsibility

This page documents how the repository validates the `step` CLI: co-located Go
unit tests, an `integration/` package that drives the compiled binary through
`go-internal`'s `testscript` using `txtar` fixtures, and the Makefile/CI/GoReleaser
build and release pipeline that wires everything together.

## Unit tests

Most Go packages ship unit tests co-located with their sources. Examples:
`flags/flags_test.go`, `utils/read_test.go`, `internal/kdf/kdf_test.go`,
`internal/sliceutil/sliceutil_test.go`, `internal/cast/cast_test.go`,
`internal/command/inject_test.go`, `internal/cmd/root_test.go`,
`command/ca/health_test.go`, `command/ca/sign_test.go`,
`command/ca/init_test.go`, `token/*_test.go`. They use standard `testing` with
`github.com/stretchr/testify` and `github.com/smallstep/assert`.

## Integration tests (testscript)

The `integration/` package ([`integration/certificate_test.go`](../../integration/certificate_test.go),
[`integration/crypto_test.go`](../../integration/crypto_test.go),
[`integration/help_test.go`](../../integration/help_test.go),
[`integration/main_test.go`](../../integration/main_test.go)) builds against the
`rogpeppe/go-internal/testscript` dependency. Each test runs `testscript.Run`
over a set of `txtar` fixture files under
[`integration/testdata/`](../../integration/testdata/) (e.g.
`testdata/certificate/sign.txtar`, `testdata/certificate/verify.txtar`,
`testdata/crypto/jwk-create.txtar`, `testdata/crypto/otp.txtar`,
`testdata/help/...`, `version.txtar`). `testscript` invokes the real `step`
binary with the args in each `txtar` script and asserts on stdout/stderr/exit
codes, and the tests set up fixtures (PEM certs, keys, CA certs) in the test
environment before running the scripts. Custom testscript commands (e.g.
`check_jwk`) are registered via `Cmds` maps (see `integration/crypto_test.go`).
`integration/openssl-jwt.sh` exercises JWT interop with OpenSSL.

## Makefile targets

The [`Makefile`](../../Makefile) drives local development:

- `all` / `ci`: run lint, test, build (ci runs test+build).
- `build`: builds `bin/step` via `go build` of `github.com/smallstep/cli/cmd/step`;
  `goreleaser` builds with GoReleaser Pro (snapshot, single target, skipping
  upload hooks).
- `install` / `uninstall`: install/remove the binary into `$(DESTDIR)`.
- `test`: `gotestsum -- -coverprofile=coverage.out -short -covermode=atomic ./...`;
  `race`: `gotestsum -- -race ./...`.
- `lint`: `golangci-lint` (via the smallstep workflows config) plus
  `govulncheck`.
- Cross-compilation bundle targets: `binary-linux-amd64`, `binary-linux-arm64`,
  `binary-linux-armv7`, `binary-linux-mips`, `binary-darwin-amd64`,
  `binary-darwin-arm64`, `binary-windows-amd64` (parameterized via `BUNDLE_MAKE`).
- `bootstrap`: installs golangci-lint, govulncheck, gotestsum, goimports, and
  GoReleaser Pro.
- Version derivation from `GITHUB_REF`/`git describe`/`.VERSION` and `PUSHTYPE`.

## CI workflows

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on pushes to
`master` (ignoring `v*` tags), pull requests, and via `workflow_call`. It
delegates to the reusable `smallstep/workflows` `goCI.yml` with
`run-codeql: true`, a pinned `golangci-lint-version`, and accepts a
`CODECOV_TOKEN`. Other workflows include `actionci.yml`, `code-scan-cron.yml`,
`dependabot-auto-merge.yml`, `publish-packages.yml`, `release.yml`, and
`openwiki-update.yml`.

## GoReleaser release configuration

[`.goreleaser.yml`](../../.goreleaser.yml) is a Pro config (`pro: true`) that
builds `cmd/step` for many `goos`/`goarch` targets (darwin, freebsd, linux,
windows) with `CGO_ENABLED=0`, `-trimpath`, and LDFLAGS injecting `main.Version`
and `main.BuildTime`. A `nfpm` build produces `step-cli` for `.deb`/`.rpm`
packages. Archives/tarballs, and nfpm packages configure output naming and
`postinstall`/`postremove` scripts. The `before` hook runs `go mod download`
and the `after` hook runs `scripts/package-repo-import.sh`.

## Relationships

See [quickstart.md](quickstart.md) for local build/test commands and
[change-guide-add-command.md](change-guide-add-command.md)/[change-guide-modify-flows.md](change-guide-modify-flows.md)
for how to validate changes to commands and flows.
