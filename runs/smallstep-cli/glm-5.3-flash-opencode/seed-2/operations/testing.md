---
type: operations
title: Testing and CI
description: The test levels (unit tests, testscript integration tests), how to run them, coverage and race modes, and the GitHub Actions workflows that gate merges and scan code.
tags: [testing, ci, testscript, coverage]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-4f4245ead05274a1d62f4ce7
    resource: repo://.github/workflows/actionci.yml
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-dc25ce111ca97420888172ad
    resource: repo://.github/workflows/code-scan-cron.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-eb2dd71349b52fd1f886ac8e
    resource: repo://.github/workflows/triage.yml
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-41b7c00e664436c20c2a2f81
    resource: repo://integration/openssl-jwt.sh
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-0427a29079df0e9dd1633bac
    resource: repo://integration/testdata/bogus.txtar
  - id: openwiki-source-f8d260a097725a925dfc7f70
    resource: repo://integration/testdata/jwks.json
  - id: openwiki-source-2d42e139d28b99ef1065b6e9
    resource: repo://integration/testdata/version.txtar
  - id: openwiki-source-362b503187f3ead50d917bf1
    resource: repo://internal/cmd/root_test.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-eac4c6d87c1234945c50c143
    resource: repo://utils/cautils/offline_test.go
  - id: openwiki-source-d65498dad1900ee9e4309461
    resource: repo://utils/cautils/token_flow_test.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# Testing and CI

## Unit tests

`make test` runs the Go unit suite through `gotestsum` with `-short`,
`-covermode=atomic`, writing a coverage profile to `coverage.out`;
`make race` runs the same suite with `-race`. The suite is invoked over
`./...` with the Makefile's `CGO_OVERRIDE` (CGO disabled by default).

The repository carries roughly 100 test functions across 32 test files.
Notable entry points, by what they actually cover:

| Package | Tests |
| --- | --- |
| `internal/cmd` | `newApp` assembly: the pinned top-level command list and a bare `step` run rendering app help |
| `utils/cautils` | Offline CA URL/audience derivation (`offline_test.go`), provisioner prompt behavior (`token_flow_test.go`) |
| `flags` | Shared flag parsing helpers, including `FirstStringOf` precedence (`flags_test.go`) |
| `token` | Token options, parsing, and claims (`token_test.go`, `options_test.go`, `parse_test.go`) |
| `internal/*` | `cast`, `kdf` (PHC strings), `sliceutil`, `sshutil` (pipe), `command` (context injection), `cmd` |
| `command/ca` | `processDNSValue` (init), `mergeSans` (sign), health command output |
| `command/certificate` | `inspect`, `remote` (certificate fetch from live endpoints) |
| `command/ssh` | `proxycommand` |
| `command/crypto/winpe` | Windows PE parsing |
| `pkg/bcrypt_pbkdf` | KDF vectors |

## Integration tests

`integration/` hosts end-to-end tests built on
`rogpeppe/go-internal/testscript`. `integration/main_test.go` registers two
scenario tests, and `TestMain` wires the command name `step` to
`internal/cmd.Run`, so scripts exercise the real app assembly (not a mock):

- `testdata/version.txtar` — `step version` prints the dev version string.
- `testdata/bogus.txtar` — an unknown command prints
  `No help topic for 'bogus'` on stderr.

`testdata/` also holds fixtures (JWK/JWKS files, PEM keys and certificates,
bad-input variants, directories for `certificate`/`crypto`/`help` scenarios)
used by the script tests, plus `openssl-jwt.sh` for cross-checking JWT output
with OpenSSL.

## Linting and security scanning

- `make lint` = `golint` + `govulncheck`. `golint` runs `golangci-lint`
  with the shared Smallstep config fetched from
  `smallstep/workflows/master/.golangci.yml` (30-minute timeout);
  `govulncheck ./...` checks for vulnerable dependencies.
- `make fmt` applies `goimports` with the repo's local import grouping.
- `make bootstrap` installs the toolchain: golangci-lint, govulncheck,
  gotestsum, goimports, and GoReleaser Pro.

## CI workflows

- **`ci.yml`** — the merge gate: on pushes to `master` (tags ignored), all
  pull requests, and `workflow_call` (reused by the release workflow with a
  `CODECOV_TOKEN`). It delegates to the shared
  `smallstep/workflows/goCI.yml@main` with `only-latest-golang: false`,
  CodeQL enabled, and golangci-lint v2.12.1; concurrent runs for the same
  PR/ref are cancelled.
- **`actionci.yml`** — runs on the same triggers, analyzing the GitHub
  Actions definitions themselves (delegates to the shared workflow).
- **`code-scan-cron.yml`** — nightly scheduled code scan via the shared
  `code-scan.yml`.
- **`release.yml`** — calls `ci.yml` before any release artifact is produced
  (see [Build, Release, and Packaging](/openwiki/operations/build-release-packaging.md)).
- **`triage.yml`**, **`dependabot-auto-merge.yml`**, **`zizmor.yml`** —
  issue/PR triage, automated dependency PR merging, and Actions security
  linting respectively; `dependabot.yml` configures update schedules.

## Practical verification loop

For most changes: `make test` (plus `-race` when touching concurrency, e.g.
the renewal daemon), `make lint` before pushing, and `go build ./...` for a
fast compile check. Integration scenarios under `integration/testdata` are
the place to add end-to-end coverage for argument parsing and dispatch
behavior (see [Guide: Adding a Command](/openwiki/guides/adding-a-command.md)).
