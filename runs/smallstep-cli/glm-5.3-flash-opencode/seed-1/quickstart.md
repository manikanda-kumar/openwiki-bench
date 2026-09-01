---
type: quickstart
title: Quickstart
description: Get oriented with the step-cli repository — build the binary, run the tests, try the first commands, and find the right deep-dive page.
tags: [quickstart, onboarding, build, testing]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-dd2083e3bfe29218ac712f40
    resource: repo://command/certificate/fingerprint.go
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# Quickstart

## What this repository is

`step` is a CLI for building, operating, and automating PKI, and the client for
the `step-ca` online CA. It covers X.509 certificates, JOSE (JWT/JWS/JWE/JWK),
SSH certificates, OAuth/OIDC SSO, and general crypto plumbing
(repo://README.md#L12-L70). The binary is assembled from `cmd/step/main.go`
with all command wiring in `internal/cmd` and `command/` packages
(repo://cmd/step/main.go#L10-L29). For the full picture see
[Architecture Overview](/openwiki/architecture/overview.md).

## Prerequisites

- Go installed (the latest two versions are supported; the minimum is in
  `go.mod`), `make`, and the repo checked out (repo://docs/local-development.md#L12-L27,
  repo://go.mod).
- `make bootstrap` installs the dev toolchain once: golangci-lint,
  govulncheck, gotestsum, goimports, and GoReleaser Pro
  (repo://Makefile#L104-L117, repo://docs/local-development.md#L29-L35).

## Build and verify

```sh
make build          # produces bin/step (CGO_ENABLED=0)
make test           # unit tests, short mode, atomic coverage
make lint           # golangci-lint + govulncheck
make race           # unit tests with -race
```

(repo://Makefile#L123-L143, repo://Makefile#L151-L174)
`make` (no target) runs `lint test build` (repo://Makefile#L30).
Details: [CI and Testing](/openwiki/operations/ci-and-testing.md),
[Build and Release](/openwiki/operations/build-and-release.md).

## First commands with your build

```sh
./bin/step version                       # version + release date
./bin/step certificate create foo foo.crt foo.key --no-password --insecure   # local, no CA
./bin/step certificate fingerprint foo.crt                       # SHA-256 of the cert
./bin/step oauth --bare                                  # obtain an OIDC token
```

`step certificate create --insecure` generates self-signed material without a
CA; `fingerprint` accepts files or `https://` hostnames
(repo://command/certificate/fingerprint.go#L43-L68). To exercise CA flows you
need a step-ca server: `step ca bootstrap --ca-url <url> --fingerprint <sha256>`
persists the root and defaults under `$STEPPATH`, then `step ca token` /
`step ca certificate` issue certificates (repo://utils/cautils/bootstrap.go#L98-L222,
repo://command/ca/ca.go#L24-L67).

## Where to go next

| Task | Page |
| --- | --- |
| Understand the module layout and library boundaries | [Architecture Overview](/openwiki/architecture/overview.md) |
| How commands register, flags, errors, STEPDEBUG | [Command Framework](/openwiki/architecture/command-framework.md) |
| How tokens authorize CA requests | [CA Tokens and Provisioners](/openwiki/concepts/ca-tokens-and-provisioners.md) |
| Where state lives (`$STEPPATH`, contexts) | [STEPPATH State and Contexts](/openwiki/concepts/steppath-and-contexts.md) |
| Online vs offline CA, bootstrap, admin API | [Online and Offline CA Flows](/openwiki/workflows/online-and-offline-ca-flows.md) |
| Issue, renew, revoke X.509 certificates | [Certificate Issuance and Renewal](/openwiki/workflows/certificate-issuance-and-renewal.md) |
| SSH certificates and SSO | [SSH Certificates](/openwiki/workflows/ssh-certificates.md) |
| `step oauth` mechanics | [OAuth and SSO](/openwiki/workflows/oauth-sso.md) |
| KMS/HSM/TPM and plugin delegation | [KMS and Plugin Integrations](/openwiki/integrations/kms-and-plugins.md) |
| Add a new subcommand | [Guide: Adding a Command](/openwiki/guides/adding-a-command.md) |

## Contribution expectations

Behavior changes must be documented in `CHANGELOG.md`; dependency changes go
through `go get` / `go mod tidy`; bug reports should include `step version`
output (repo://docs/local-development.md#L10, repo://docs/local-development.md#L63-L72,
repo://docs/CONTRIBUTING.md#L13-L17).
