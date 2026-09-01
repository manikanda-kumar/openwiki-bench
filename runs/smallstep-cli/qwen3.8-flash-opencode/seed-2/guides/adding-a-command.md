---
type: guide
title: "Change Guide: Add a New Command"
description: "Step-by-step recipe for adding a new step subcommand: package placement, cli.Command registration, root.go enablement, usage-text and help-quality requirements, shared flag/error conventions, CHANGELOG entry, and the validation commands to run."
tags: [guide, commands, contributing, changelog]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-ca6cb4b1a14fd7969dfae3ec
    resource: repo://CHANGELOG.md
  - id: openwiki-source-2e6c694726c08169fdc82b8d
    resource: repo://command/base64/base64.go
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7cb094ef8fab44ceb877ed7f
    resource: repo://integration/help_test.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-362b503187f3ead50d917bf1
    resource: repo://internal/cmd/root_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# Change Guide: Add a New Command

This recipe turns an idea into a merged subcommand. The mechanics build directly on [Command Framework and Registration](/openwiki/architecture/command-framework.md); the checks belong to [Testing Strategy](/openwiki/testing/test-strategy.md).

## 1. Decide placement

`command/README.md` is the in-repo authoring guide: the urfave/cli tree supports N-level hierarchies and *each level should live in its own package* (like `version` and `help` under `command/`), while code without command-specific business logic belongs in shared top-level packages such as `flags/` and `utils/` (`command/README.md:5-22`). So:

- New top-level verb → new `command/<name>/` package.
- New subcommand of an existing group → add a `xxxCommand()` constructor to that group's `Subcommands` list (as in `command/ca/ca.go:68-85`) or, for a nested group, a subpackage exposing `Command()` (as `crypto/jwk` does).
- Reusable flag or parser → add it to `flags/flags.go` rather than defining it inline.

## 2. Write the command

The minimal template is `command/version/version.go`: package-level `init()` builds a `cli.Command` with `Name`, `Usage`, `UsageText`, `Description`, `Action`, and `Flags`, then calls `command.Register(cmd)` from `github.com/smallstep/cli-utils/command` (`command/version/version.go:13-26`). Conventions visible in every command:

- `UsageText`/`Description` use `**bold**` markup for literals and a `## EXAMPLES` section; flag usages embed a `<placeholder>` because `stringifyFlag` derives the help placeholder from it (`command-framework` page, `internal/cmd/root.go:182-194`).
- Commands that shouldn't receive context-derived values take `flags.HiddenNoContext` (`command/version/version.go:20-22`).
- Wrap actions in `command.ActionFunc(...)` (`command/base64/base64.go:21`).
- Signal destructive/insecure capabilities through the shared gates `flags.Force`, `flags.DryRun`, `flags.Insecure`, `flags.Subtle`, `flags.PasswordFile` (`flags/flags.go:71-124`), report problems through `cli-utils/errs` helpers (`errs.RequiredFlag`, `errs.IncompatibleFlagWithFlag`, …) so wording stays uniform (`command/ca/bootstrap.go:96-111`), and write files via `fileutil.WriteFile`/`pemutil` — the hooks installed in `newApp` make prompts and overwrite behavior consistent (`internal/cmd/root.go:97-103`).
- Anything that talks to a CA must use `cautils.NewClient`/`NewCertificateFlow` and honor `flags.CaURL`/`flags.Root`/`flags.Offline`/`flags.CaConfig`; don't build HTTP calls by hand (`utils/cautils/client.go:50-74`).

## 3. Enable it

Add a blank import `_ "github.com/smallstep/cli/command/<name>"` to the enabled-commands block in `internal/cmd/root.go:31-43`. Then run the unit test — `TestAppHasAllCommands` asserts the exact top-level name list and will fail until you update it (`internal/cmd/root_test.go:11-27`).

## 4. Help text is gated by CI

Help quality is machine-checked: `TestHelp`/`TestHelpQuality` run the binary through `go-internal/testscript` (`integration/testdata/help/help.txtar`, `html.txtar`) and validate a `usage.Report` for headline consistency, threshold compliance, and no TODO markers (`integration/help_test.go:14-45`). Write the description so the top sentence is a clean headline; expect this test to fail first for sloppy usage text.

## 5. Tests

Add a colocated `_test.go` unit test (the repo uses `testify/require` and `smallstep/assert`, e.g. `command/ca/health_test.go`, `utils/cautils/token_flow_test.go`), and an end-to-end txtar case under `integration/testdata/` if the command changes observable behavior — the pattern is `testdata/version.txtar` driving `TestVersionCommand` (`integration/main_test.go:8-19`). Verify locally with:

```
make build   # bin/step
make test    # go test ./...
make lint    # golangci-lint + govulncheck
```

(`Makefile:123-176`)

## 6. Changelog and commit hygiene

- Every behavior change must be documented in `CHANGELOG.md` under the "Unreleased"-style top section, following the Keep-a-Changelog template preserved at the file head (`CHANGELOG.md:6-12`, `docs/local-development.md:13-14`).
- `docs/CONTRIBUTING.md` requires: test cases for new code, `go fmt`, docs updated, commits squashed to one, an imperative-mood capitalised subject (e.g. "Add step certificate install"), issue references as `Fixes #1234`, and the Smallstep CLA (`docs/CONTRIBUTING.md:63-101`).

## Gotchas

- The registry lives in the external `cli-utils` module; `command/README.md` predates that split and its sample imports reference the old in-repo `github.com/smallstep/cli/command` path — follow `command/version/version.go` instead (`command/README.md:26-33`).
- Commands are opt-in only through `root.go`; forgetting the blank import yields the plugin-fallback "not found" behavior rather than a compile error (`internal/cmd/root.go:134-147`).
- If your command writes to STEPPATH, resolve paths through `step.Path()`/`step.BasePath()` (never `~/.step`) so contexts work (`command/path/path.go:92-103`).

## See also

- [Testing Strategy](/openwiki/testing/test-strategy.md) — what CI runs and how txtar tests work
- [Change Guide: Support a New Provisioner Type](/openwiki/guides/adding-a-provisioner-type.md)
