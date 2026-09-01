---
type: quickstart
title: Quickstart
description: Practical onboarding for the step CLI repository - build, test, run, repository layout, and where to start making changes.
tags: [quickstart, build, layout, onboarding]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-ca6cb4b1a14fd7969dfae3ec
    resource: repo://CHANGELOG.md
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-7cb094ef8fab44ceb877ed7f
    resource: repo://integration/help_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

This repository is [smallstep/cli](https://github.com/smallstep/cli), the `step`
CLI: a toolkit for PKI and X.509/JOSE/SSH certificate operations, and the client
for the [step-ca](https://github.com/smallstep/certificates) online certificate
authority. It is a Go module (`github.com/smallstep/cli`, Go per `go.mod`) that
builds a single static binary with CGO disabled.

## Build and run in three commands

```
make bootstrap   # once: installs golangci-lint, govulncheck, gotestsum, GoReleaser Pro
make build       # produces bin/step (CGO_ENABLED=0, version injected via ldflags)
./bin/step version
```

`make build` compiles `github.com/smallstep/cli/cmd/step` with
`-ldflags='-X "main.Version=..." -X "main.BuildTime=..."'`; the version comes
from `git describe` (Makefile:40-71, 123-132). `./bin/step help` explores the
command tree; every command also documents itself with `step <cmd> --help`, and
that help text is machine-linted (see below).

## Validate your work

```
make test    # gotestsum, -short, coverage across ./... (includes integration tests)
make lint    # golangci-lint (shared config fetched from smallstep/workflows) + govulncheck
make race    # full suite under the race detector
```

Two test layers: unit tests colocated with source, and the `integration/`
package that runs the real command tree in-process via testscript `.txtar`
scenarios. The integration suite also lints help-text quality (headline
consistency, minimum section sizes, no TODOs) across every command — nonconforming
help fails `make test`. Details and conventions: the testing strategy page.

## Repository map

| Path | Role |
|---|---|
| `cmd/step/` | Binary entrypoint (thin; sets version, delegates to internal/cmd) |
| `internal/cmd/` | The real dispatcher: app assembly, error/panic contract, command imports |
| `command/` | All commands, one package per group (ca, certificate, crypto, ssh, oauth, ...) |
| `flags/` | Shared flag definitions and flag-string parsers |
| `token/`, `utils/cautils/` | JOSE one-time-token machinery and CA client flows |
| `internal/cryptoutil`, `internal/plugin`, `exec/` | KMS-URI key access and step-kms-plugin dispatch |
| `internal/sshutil/` | ssh-agent client used by the ssh command family |
| `utils/`, `internal/kdf`, `pkg/` | Input/password helpers, KDF primitives, vendored primitives |
| `integration/` | testscript-based end-to-end suite |
| `systemd/`, `docker/`, `debian/`, `powershell/`, `scripts/` | Packaging and operational examples |
| `Makefile`, `.goreleaser.yml`, `.github/workflows/` | Build, release, CI |

The architecture is documented in depth by the pages linked at the bottom; the
two that explain the most with the least reading are **Runtime and Command
Dispatch** (how a `step` invocation flows to an action) and **Command
Implementation Anatomy** (the pattern every command follows).

## Where to make your first change

- **A new command or command tweak**: follow the guide to adding a command —
  package placement, `command.Register`, the guard-clause action pattern, help
  format, tests, changelog. Remember that behavior changes require a
  CHANGELOG.md entry under the TEMPLATE section (docs/local-development.md:10).
- **CA/token behavior**: start from the tokens and provisioners page, then the
  issuance flow; the extending-provisioning guide lists every layer a new token
  type must touch.
- **Build/release questions**: the build and release page traces the tag-to-
  artifact pipeline (GoReleaser Pro, cosign, S3/GCS/winget/scoop, docs
  regeneration).

## Working conventions worth knowing upfront

- Registration is side-effect driven: commands register in `init()`; a new
  top-level command is activated by a blank import in `internal/cmd/root.go`
  (the README's mention of `cmd/step/main.go` predates a refactor).
- Errors are returned, never printed: the root runner renders them (with
  `STEPDEBUG=1` for stacks) and maps them to exit codes (1 error, 2 panic).
- Private key material is written 0600 through `fileutil.WriteFile`; crypto
  belongs in the `go.step.sm/crypto` libraries, not hand-rolled.
- `$STEPPATH` (default `$HOME/.step`, override with the `STEPPATH` env var) holds
  all client state: `certs/root_ca.crt`, `config/defaults.json`, `config/ca.json`,
  contexts. See the configuration page.
- The contribution rules (CLA, squash, imperative commit subjects, `Fixes #NNN`)
  are in docs/CONTRIBUTING.md:60-101.

## Learn the CLI by using it

The best orientation is functional: `step ca init --pki` stands up a throwaway
PKI (the authority-setup page), `step certificate create foo foo.crt foo.key
--profile root-ca` exercises the offline crypto path, and `step crypto jwt sign`
shows the toolkit conventions (`--subtle`/`--insecure` gates, key-use
enforcement). The wiki pages under `flows/` and `toolkit/` each explain one of
these surfaces with source references.
