---
type: testing-guide
title: Testing, Integration, and Operations
description: How the step CLI is built, tested (unit and integration), packaged for Docker/systemd, and how certificate renewal is orchestrated.
tags: [testing, integration, build, systemd, docker, operations]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:42:28.757Z
sources:
  - id: openwiki-source-7f1ca00753e95588bc8efa39
    resource: repo://docker/Dockerfile
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-fe5b002eb6bab88c8a9f5a2c
    resource: repo://systemd/cert-renewer%40.service
generated: { by: "opencode", at: "2026-09-12T20:42:28.757Z" }
---

# Testing, Integration, and Operations

The repository uses the Makefile for building, testing, and linting; Go tests
for unit and focused integration coverage; and Docker/systemd/package scripts
for distribution and operations.

## Build and tooling

The `step` binary is built from `cmd/step` with Go. The Makefile exposes:

- `make build` builds the binary to `bin/step` (with `--ldflags` embedding
  version/build time).
- `make install`, `make uninstall`.
- `make goreleaser` builds using GoReleaser, with `GORELEASER_BUILD_ID`
  selecting a build config; cross-compilation targets (`binary-linux-amd64`,
  `binary-darwin-arm64`, etc.) are provided.
- `make bootstrap` installs golangci-lint, govulncheck, gotestsum, and
  goimports, plus GoReleaser Pro.
- `make test` runs `gotestsum` with a short, coverage profile across `./...`.
- `make race` runs tests with the race detector.
- `make lint` runs golangci-lint (downloading a shared workflow config) and
  `govulncheck`.

`VERSION` is derived from git tags or `.VERSION`, and `PUSHTYPE` distinguishes
release-candidate/release/branch builds (`Makefile`).

## Unit and integration tests

Tests live alongside source in each package (e.g. `internal/cmd/root_test.go`,
`internal/cast/cast_test.go`, `utils/cautils/token_flow_test.go`, and
`token/parse_test.go`).

Integration tests under `integration/` use `rogpeppe/go-internal/testscript`
with `.txtar` fixture directories:

- `integration/main_test.go` runs `testdata/version.txtar` (checks `step
  version`) and `testdata/bogus.txtar`.
- `integration/certificate_test.go` exercises `step certificate sign`,
  `verify`, and `fingerprint` commands against in-process generated CA keys
  and certificates, using `testscript` Setup hooks to write fixture PEM files
  and custom command helpers like `check_certificate`.

These integration tests compile/run the real CLI and verify its filesystem and
stdout behavior (`integration/certificate_test.go`, `integration/main_test.go`).

## Deployment packaging

- **Docker**: `docker/Dockerfile` builds `step` in a multi-stage builder
  (Go `bin/step`) and produces a minimal runtime image running as a non-root
  `step` user with `STEPPATH=/home/step`.
- **systemd**: `systemd/` ships unit files for automating certificate renewal:
  `cert-renewer@.service`, `cert-renewer@.timer`, and
  `ssh-cert-renewer.{service,timer}`, plus a `cert-renewer.target`. The
  `cert-renewer@.service` uses `step certificate needs-renewal` as
  `ExecCondition` and `step ca renew --force` as `ExecStart`, then tries to
  reload or restart the depending service. Docs point to
  smallstep.com/docs for renewal timers (`systemd/cert-renewer@.service`,
  `systemd/ssh-cert-renewer.service`, `systemd/README.md`).
- **Debian/scripts/powershell/autocomplete**: `debian/` package metadata,
  `scripts/` package repo import/upload hooks, `powershell/` install scripts,
  and shell completion scripts.

## Operational notes

- The Docker runtime image runs `step` as uid `$STEPGID/1000` user `step` with
  a writable `$STEPPATH`.
- Renewal automation should rely on `step certificate needs-renewal` prior to
  `step ca renew` to avoid unnecessary authority calls; systemd `ExecCondition`
  codifies this pattern.
