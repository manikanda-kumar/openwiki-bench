---
type: quickstart
title: Quickstart
description: Build the step binary, run the tests, understand the 30-second architecture, and jump to the deeper wiki pages for flows, integrations, and change guides.
tags: [quickstart, build, testing, navigation]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# Quickstart

This repository is `github.com/smallstep/cli` — the `step` command-line tool
for PKI workflows and the client for the `step-ca` online certificate
authority.

## Build and run

```sh
make build          # compiles cmd/step into bin/step (CGO disabled, version stamped via ldflags)
./bin/step version  # prints the version; 'N/A' unless built with make/goreleaser
```

Prerequisites: Go (latest two versions; see `go.mod` for the minimum) and
`make`. `make bootstrap` installs the dev toolchain (golangci-lint,
govulncheck, gotestsum, goimports, GoReleaser Pro).

## Test and lint

```sh
make test           # unit suite via gotestsum, -short, coverage profile
make race           # suite with -race
make lint           # golangci-lint (shared Smallstep config) + govulncheck
```

End-to-end scenarios live in `integration/` as testscript `.txtar` files
driven through the real `internal/cmd.Run` entrypoint. Details:
[Testing and CI](/openwiki/operations/testing.md).

## The 30-second architecture

`cmd/step/main.go` delegates to `internal/cmd.Run()`, which assembles a
`urfave/cli` app from commands that self-register via `command.Register` in
their `init()` (imported blank in `internal/cmd/root.go`). Command behavior
lives in `command/<group>/`; shared flag definitions in `flags/`; JWT token
machinery in `token/`; the end-to-end CA flows (bootstrap, token generation,
certificate issuance, offline mode) in `utils/cautils/`; and unexported
cross-cutting helpers (plugins, KMS signers, SSH agent) in `internal/`.
Unknown commands fall back to executing `step-<name>-plugin` binaries.
Deeper: [Architecture Overview](/openwiki/architecture/overview.md) and
[Command Dispatch](/openwiki/architecture/command-dispatch.md).

## Where to go next

- **Understand**: [STEPPATH and Contexts](/openwiki/concepts/steppath-and-contexts.md),
  [Shared Flags and Configuration](/openwiki/concepts/shared-flags-and-configuration.md)
- **Core flows**: [CA Bootstrap](/openwiki/flows/ca-bootstrap.md),
  [Token Generation](/openwiki/flows/token-generation.md),
  [X.509 Issuance](/openwiki/flows/x509-certificate-issuance.md),
  [Renewal](/openwiki/flows/certificate-renewal.md),
  [SSH Certificates](/openwiki/flows/ssh-certificates.md),
  [OAuth/SSO](/openwiki/flows/oauth-and-sso.md)
- **Integrations**: [CA Client](/openwiki/integrations/ca-client.md),
  [KMS and Plugins](/openwiki/integrations/kms-and-plugins.md)
- **Operate**: [Testing and CI](/openwiki/operations/testing.md),
  [Build, Release, and Packaging](/openwiki/operations/build-release-packaging.md)
- **Change safely**: [Guide: Adding a Command](/openwiki/guides/adding-a-command.md),
  [Guide: Extending CA Flows](/openwiki/guides/extending-ca-flows.md)

Behavior changes must be documented in `CHANGELOG.md`, per
`docs/local-development.md`.
