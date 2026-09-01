---
type: quickstart
title: "Quickstart"
description: "Get step building, running, and issuing certificates fast: the make loop for development, one-minute offline PKI, local CA initialization, bootstrapping against a step-ca server, and which wiki page covers each next task."
tags: [quickstart, build, getting-started, routing]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# Quickstart

Prerequisites: a Go toolchain (`go.mod` pins the minimum, `go 1.25.x`) and GNU make; `docs/local-development.md:22-35` also assumes make and a Go install (its GOPATH checkout guidance is historical — modules make the path irrelevant).

## Build, run, test loop

```bash
make bootstrap   # one-time: golangci-lint, govulncheck, gotestsum, goimports, goreleaser
make build       # -> bin/step (static, CGO off, version stamped via -ldflags)
./bin/step version
make test        # gotestsum unit + integration suites
make lint        # golangci-lint (shared config) + govulncheck
```

(`Makefile:104-115`, `Makefile:121-128`, `Makefile:147-176`; the version stamping is `git describe`-based — see [Build, Packaging, and Release Pipeline](/openwiki/operations/build-and-packaging.md).) State lives under `STEPPATH`, default `$HOME/.step`; `step path` prints the effective directory and `STEPPATH=/tmp/step` redirects everything (`command/path/path.go:15-46`).

## One-minute offline PKI

No server needed — these are the checked-in examples from the `create` command's own help (`command/certificate/create.go:166-181`):

```bash
step certificate create root-ca root-ca.crt root-ca.key --profile root-ca
step certificate create intermediate-ca intermediate-ca.crt intermediate-ca.key \
  --profile intermediate-ca --ca ./root-ca.crt --ca-key ./root-ca.key
step certificate create foo foo.crt foo.key --profile leaf \
  --ca ./intermediate-ca.crt --ca-key ./intermediate-ca.key
step certificate inspect foo.crt
step certificate verify foo.crt --roots root-ca.crt
```

Profiles supply validity and extension defaults; `--san`, `--template`, `--kty/--curve/--size` vary the result ([X.509 and Crypto Toolkit](/openwiki/flows/x509-and-crypto-toolkit.md)). JOSE is equally local: `step crypto keypair`, `step crypto jwt sign/verify`, `step crypto kdf hash` ([Testing Strategy](/openwiki/testing/test-strategy.md) exercises these end to end).

## Local CA and offline issuance

`step ca init` is the starting point for a self-managed authority: it walks deployment type (Standalone / Linked / Hosted), prompts for name, DNS, validity, and provisioner, then generates the PKI material via the certificates `pki` package (`command/ca/init.go:220-660`, `command/ca/ca.go:26-30`). With that configuration in place, the `--offline` flag makes the CLI sign locally against `ca.json` — including enrollment and renewal:

```bash
step ca certificate internal.example.com internal.crt internal.key --offline
step ca renew --daemon --renew-period 16h internal.crt internal.key
```

(`command/ca/certificate.go:76-79` and `command/ca/renew.go:160-163` for the offline examples, `utils/cautils/offline.go:27-80`; the same CaClient interface serves both modes — see [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md).)

## Against a running step-ca server

Bootstrap the root of trust by fingerprint, then use tokens for enrollment (these are the canonical examples from the `step ca` group help, `command/ca/ca.go:31-66`):

```bash
step ca bootstrap --ca-url https://ca.smallstep.com \
  --fingerprint 0d7d3834...058cf3
TOKEN=$(step ca token internal.example.com)
step ca certificate internal.example.com internal.crt internal.key --token $TOKEN
step ca renew internal.crt internal.key
```

Bootstrap verifies the downloaded root against the fingerprint before saving it plus `ca-url`/`root` into `$STEPPATH/config/defaults.json` ([Configuration, STEPPATH, and Contexts](/openwiki/architecture/configuration-and-steppath.md)). A containerized trial image exists as `smallstep/step-cli` published by the release workflow (`release.yml:74-86`).

## Task routing

| I want to… | Go to |
|---|---|
| Understand entrypoint, layers, module ownership | [System Architecture Overview](/openwiki/architecture/overview.md) |
| Add or register a command | [Command Framework and Registration](/openwiki/architecture/command-framework.md) → [Change Guide: Add a New Command](/openwiki/guides/adding-a-command.md) |
| Debug token/CSR/signing behavior | [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md), [Change Guide: Support a New Provisioner Type](/openwiki/guides/adding-a-provisioner-type.md) |
| Work with ACME/OIDC enrollment | [ACME and OAuth Flows](/openwiki/flows/acme-and-oauth.md) |
| Set up SSH SSO | [SSH Certificate Workflows](/openwiki/flows/ssh-certificates.md) |
| Automate renewals / systemd | [Renewal Automation and systemd Units](/openwiki/operations/renewal-and-systemd.md) |
| Ship a build or fix CI | [Build, Packaging, and Release Pipeline](/openwiki/operations/build-and-packaging.md), [Testing Strategy](/openwiki/testing/test-strategy.md) |
| Use X.509/JOSE/KDF locally | [X.509 and Crypto Toolkit](/openwiki/flows/x509-and-crypto-toolkit.md) |
