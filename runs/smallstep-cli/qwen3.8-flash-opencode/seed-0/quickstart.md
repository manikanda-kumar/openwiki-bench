---
type: quickstart
title: Quickstart
description: Build the step CLI from source, run a first X.509 workflow, and route to the right wiki page for operating, debugging, or changing the repository.
tags: [quickstart, build, onboarding]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-d369a2fc6aab1546fc84613b
    resource: repo://command/certificate/verify.go
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---

# Quickstart

`step` is Smallstep's PKI CLI and client for `step-ca`
(README.md:12-14). This page gets you from checkout to a working binary and
routes common maintenance tasks to the right wiki page.

## 1. Build the binary

Prerequisites (docs/local-development.md:16-24):

- Go installed; the repo follows the "latest two Go versions" policy and
  `go.mod` pins `go 1.25.8` (go.mod:3)
- `make`
- One-time tooling: `make bootstrap` installs golangci-lint, govulncheck,
  gotestsum, goimports, and GoReleaser Pro (Makefile:104-117)

```sh
make build     # -> bin/step  (Makefile:123-132)
./bin/step version
```

`step version` prints `Smallstep CLI/<version>` — the version string is
injected by LDFLAGs (`main.Version`, `cmd/step/main.go:10-16`), so a plain
`go build` shows `N/A`.

## 2. Validate your checkout

```sh
make test              # unit + integration tests via gotestsum (Makefile:151-152)
go test ./token/...    # focused package run
make lint              # golangci-lint (shared config) + govulncheck (Makefile:166-175)
```

Details: [Testing and Validation](/openwiki/testing-and-validation.md).

## 3. First local workflow (no CA required)

Self-signed PKI material is fully local, straight from the `step certificate
create` examples embedded in the command's own help
(command/certificate/create.go:168-196):

```sh
# root CA
./bin/step certificate create root-ca root-ca.crt root-ca.key --profile root-ca
# leaf valid for 1h, with SANs
./bin/step certificate create foo foo.crt foo.key \
  --profile leaf --ca root-ca.crt --ca-key root-ca.key --not-after 1h
# inspect / verify
./bin/step certificate inspect foo.crt
./bin/step certificate verify foo.crt --roots root-ca.crt
```

Other purely local tools: `step crypto keypair`, `step crypto jwt sign`,
`step crypto kdf hash` — see
[OAuth and JOSE Toolkit Workflows](/openwiki/workflows/oauth-and-jose.md).

## 4. Working with a CA

Talking to a real CA needs a running `step-ca` **server**, which lives in the
`smallstep/certificates` repository — this repo ships only the client and the
`step ca init` configuration generator (go.mod:19; README.md:13-14).
Typical client loop once a CA exists:

```sh
step ca bootstrap --ca-url https://ca.example.com --fingerprint <sha256>
step ca certificate internal.example.com internal.crt internal.key
step ca renew internal.crt internal.key
```

(the shape from command/ca/ca.go's help examples, ca.go:33-68). Offline
signing against the `ca.json` created by `step ca init` works with
`--offline`. Deep dive:
[CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md),
[Certificate Issuance and Renewal Workflows](/openwiki/workflows/certificate-lifecycle.md).

## 5. State and plugins

- Local state lives under `$STEPPATH` (default `~/.step`): roots,
  `config/defaults.json`, per-context dirs — inspect with `step path`.
  See [STEPPATH, Contexts, and Local State](/openwiki/architecture/steppath-and-contexts.md).
- Executables named `step-<name>-plugin` in `$PATH` or
  `$STEPPATH/plugins` run transparently as `step <name>`
  (README.md:81-88, internal/plugin/plugin.go:20-52).
- Unknown behavior? Re-run anything with `STEPDEBUG=1` for full error dumps
  (internal/cmd/root.go:62-79).

## 6. Where to go next, by task

| I want to… | Read |
| --- | --- |
| Understand how commands are wired | [Architecture Overview](/openwiki/architecture/overview.md), [CLI Runtime and Plugin Dispatch](/openwiki/architecture/cli-runtime.md) |
| Add or change a command | [Change Guide: Adding or Modifying Commands](/openwiki/changes/adding-and-modifying-commands.md) |
| Change token/provisioner behavior | [Change Guide: Extending Token and Provisioner Flows](/openwiki/changes/extending-token-and-provisioner-flows.md) |
| Manage a CA (provisioners, admins, policy) | [CA Administration Commands](/openwiki/workflows/ca-administration.md) |
| Set up SSH cert automation | [SSH Certificate Workflows](/openwiki/workflows/ssh-certificates.md) |
| Ship a release / build packages | [Build, Packaging, and Release Operations](/openwiki/operations/build-and-release.md) |
| Know which test to run | [Testing and Validation](/openwiki/testing-and-validation.md) |
| Reuse a flag or fix flag parsing | [Shared Flags and Parsing Contracts](/openwiki/core/flags-and-configuration.md) |
