---
type: "Reference"
title: "Build, Test, and Change Guides"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
---

# Build, Test, and Change Guides

The project builds with the `Makefile` (binary `bin/step`, CGO disabled by default), tests with `gotestsum`, lints with `golangci-lint` plus `govulncheck`, and releases through GoReleaser. Contribution rules live in `docs/CONTRIBUTING.md` and `docs/local-development.md`, and command-authoring conventions in `command/README.md`.

## Makefile targets

Key variables (`Makefile:9`): `BINNAME` (default `step`), `PREFIX` (default `bin`), `DESTDIR` (default `/usr/local/bin`), `GOOS_OVERRIDE` (e.g. `GOOS=linux GOARCH=arm GOARM=6`), and `CGO_OVERRIDE` (default `CGO_ENABLED=0`).

- `all` runs `lint test build`; `ci` runs `test build` (`Makefile:30`).
- **Version detection:** when `GITHUB_REF` is set (CI tags), the version is the tag with `refs/tags/` stripped and classified as `release-candidate` if it contains `-rc`, else `release`; otherwise it falls back to `git describe --tags --always --dirty="-dev"`, then to `make/version.sh .VERSION` (which reads the `git archive`-substituted slug), classified as `branch`; a leading `v` is stripped (`Makefile:40`).
- **LDFLAGS:** non-debug builds use `-ldflags='-w -X "main.Version=$(VERSION)" -X "main.BuildTime=$(DATE)"'`; `DEBUG=1` drops `-w` and adds `-gcflags "all=-N -l"` (`Makefile:64`). `cmd/step/main.go` declares the `Version` and `BuildTime` variables that the ldflags populate and passes them to `step.Set` in `init()` (`cmd/step/main.go:10`).
- `build` compiles `github.com/smallstep/cli/cmd/step` to `bin/step` with `$(GOOS_OVERRIDE) $(CGO_OVERRIDE) go build`; `goreleaser` runs `goreleaser build --snapshot --single-target --clean` for a CI-parity binary (`Makefile:123`).
- `test` runs `gotestsum -- -coverprofile=coverage.out -short -covermode=atomic ./...`; `race` runs with `-race` (`Makefile:151`).
- `lint` runs `golint` (golangci-lint with the shared config fetched at runtime from `smallstep/workflows/master/.golangci.yml`, 30-minute timeout) and `govulncheck ./...`; `fmt` runs `goimports -local github.com/golangci/golangci-lint` (`Makefile:163`).
- `bootstrap` installs the dev toolchain once: `golangci-lint`, `govulncheck`, `gotestsum`, `goimports`, and GoReleaser Pro into `$(go env GOPATH)/bin` (`Makefile:104`).
- `install`/`uninstall` copy the binary to/from `DESTDIR`; `clean` removes `bin/step` and `dist`; `binary-<os>-<arch>` targets (linux amd64/arm64/armv7/mips, darwin amd64/arm64, windows amd64) cross-build into `output/binary/` via the `BUNDLE_MAKE` macro (`Makefile:181`, `Makefile:204`).

CI calls the shared `smallstep/workflows` goCI workflow with golangci-lint v2.12.1 (`.github/workflows/ci.yml:24`), and the release workflow runs `V=1 make build` (`.github/workflows/release.yml:121`); release packaging is driven by `.goreleaser.yml`.

## Contribution requirements

`docs/CONTRIBUTING.md` expects contributions to:

- fit naturally into a toolkit for creating and working with cryptographic primitives and higher-order resources,
- strive not to break existing functionality, and
- close or update an open issue (`docs/CONTRIBUTING.md:31`).

Pull requests must sign the CLA, include test cases, run `go fmt`, add documentation for new or changed behavior, squash into a single commit, and follow the commit-message guidelines (imperative-mood subject, `Fixes #1234` to close an issue, descriptive branch names) (`docs/CONTRIBUTING.md:60`). `docs/local-development.md` adds that all changes to behavior must be documented in `CHANGELOG.md` (`docs/local-development.md:10`), which follows Keep a Changelog with a `## TEMPLATE` section and semver headings (e.g. `## [0.30.3] - 2026-06-09` with `### Added`/`### Fixed` sections).

## Local development

`docs/local-development.md` requires Go (the latest two versions are supported; `go.mod` declares `go 1.25.8`), `make`, and the repo checked out; read the urfave/cli style guide before changing CLI behavior (`docs/local-development.md:6`). The workflow:

1. `make bootstrap` once to install `golangci-lint`, `gotestsum`, `govulncheck`, `goimports`, and GoReleaser Pro.
2. `make build` to produce `bin/step`.
3. `make` (i.e. `all`) to lint + test + build, or `make test` / `make lint` individually; the enabled linters are defined in the shared `smallstep/workflows` golangci-lint config (`docs/local-development.md:57`).
4. Dependencies are added by importing and running `go get <pkg>` and removed with `go mod tidy` (`docs/local-development.md:63`).

## Command conventions (`command/README.md`)

- One package per command-hierarchy level (e.g. `version` and `help` in their own packages under `command/`).
- Shared non-business code used by many commands belongs at the repository top level (`flags`, plus cli-utils packages like `errs`).
- Commands self-register in `init()` via `command.Register` and are enabled by blank-importing the package so `init` runs.
- Helper packages: `flags` (reuse preexisting flags, add reusable ones), `errs` (errors that become `urfave/cli.ExitError` with proper exit codes), `usage` (argument annotations for help), and a prompts wrapper; `Hidden: true` hides deprecated/unready commands from help.

Note: the README's example imports `github.com/smallstep/cli/command` and a `github.com/smallstep/cli/prompts` package and says to blank-import in `cmd/step/main.go`; in the current tree the registration package is `github.com/smallstep/cli-utils/command`, there is no top-level `prompts` package, and the blank imports live in `internal/cmd/root.go` (see `command/context/context.go:6` and `internal/cmd/root.go:31`).

## Integration tests

`integration/` uses `testscript` (rogpeppe/go-internal) with `.txtar` files in `integration/testdata/`: `TestVersionCommand` runs `exec step version` and expects the `Smallstep CLI/<version>` output (the checked-in script pins `Smallstep CLI/0000000-dev`, matching the binary the CI builds), and `TestBogusCommandFails` asserts the unknown-command help error (`integration/main_test.go:10`). These tests invoke the `step` binary through the environment, so a built `step` must be available; `make test` runs them as part of `./...` with `-short`.

## Change guides

### 1. Add a new top-level command

1. Create `command/<name>/<name>.go` with an `init()` that builds a `cli.Command` and calls `command.Register(cmd)` from `github.com/smallstep/cli-utils/command`, following `command/context/context.go:10`.
2. Blank-import the package in `internal/cmd/root.go` next to the other enabled commands (`internal/cmd/root.go:31`).
3. Reuse shared flags from `flags/flags.go` where possible; add command-specific flags in the command file.
4. Add a `_test.go` (unit) and, for user-visible behavior, a `integration/testdata/<name>.txtar` plus a `testscript.Run` case in `integration/main_test.go`.
5. Update `CHANGELOG.md` under a new version section. Validate: `make lint`, `make test`, and `bin/step <name> --help` after `make build`.

### 2. Add a shared flag

1. Add the flag to the `var` block in `flags/flags.go` with a documented `Usage` using the `<placeholder>` convention so help output picks it up (`internal/cmd/root.go:182` stringifies the first `<...>` in usage).
2. Add a `Parse*` helper next to existing ones (`flags/flags.go:546`) if the value needs parsing; add hidden variants (`SubtleHidden`-style) for flags that must be accepted but not shown.
3. Wire the flag into the consuming commands' `Flags` lists. Validate: `make lint` and a targeted `go test ./flags/...` plus the consuming command's tests.

### 3. Add a new crypto or certificate subcommand

1. Add `<name>Command() cli.Command` in the appropriate existing group package (e.g. `command/certificate/` or `command/crypto/`) with `command.ActionFunc` actions.
2. Register it in the group's `Subcommands` slice (the group command's `init()` in the package, e.g. `command/ssh/ssh.go:84` shows the pattern).
3. For CA operations, build one-time tokens with the flows in `utils/cautils/` and call the `caClient` API; for local crypto, use `go.step.sm/crypto` and `internal/cryptoutil` rather than reimplementing key handling.
4. Test: unit tests beside the command, `go test ./command/<group>/...`, `make lint`.

### 4. Add an integration test

1. Write a `.txtar` script in `integration/testdata/` using `exec step ...` with `stdout`/`stderr`/`cmpenv` assertions (see `integration/testdata/version.txtar` and `bogus.txtar`).
2. Add a `testscript.Run(t, testscript.Params{Files: []string{"testdata/<name>.txtar"}})` test in `integration/main_test.go`.
3. Run it with a built binary on the PATH: `make build` then `PATH=$PWD/bin:$PATH go test ./integration/...`; full suite via `make test`.

### 5. Update a provisioner token flow

1. Token types and their CA audiences live in `utils/cautils/token_flow.go` (e.g. the `parseAudience` switch at `utils/cautils/token_flow.go:39`); add a new `Type` constant and its path mapping if the flow needs a new endpoint.
2. Add the matching `Generate*Token` method on the relevant flow in `utils/cautils/flow.go` (certificate/SSH flows) and call it from the command; X5C/SSHPOP/JWK key material comes from the shared flags documented in `flags/flags.go:298`.
3. Validate: `go test ./utils/cautils/... ./command/...` and `make lint`.

## External-module ownership

Behaviors owned by modules outside this repo (not verifiable here): the `command.Register`/`command.Retrieve` registration mechanism, `errs`, `usage`, `ui`, and the `step` package (STEPPATH, contexts, defaults) from `github.com/smallstep/cli-utils`; the `ca` client and API types from `github.com/smallstep/certificates`; all key/pem/jose/ssh primitives from `go.step.sm/crypto`; the exact linter set (fetched from `smallstep/workflows` at lint time); and the CI test harness that builds the `step` binary consumed by the integration tests (shared `smallstep/workflows` goCI).
