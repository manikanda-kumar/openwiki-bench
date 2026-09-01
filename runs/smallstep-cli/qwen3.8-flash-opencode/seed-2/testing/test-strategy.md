---
type: testing
title: "Testing Strategy"
description: "How step changes are verified: in-process go-internal testscript integration suites with txtar cases and custom check commands, help-quality gates on usage reports, openssl interop helpers, unit test conventions (testify, smallstep/assert, minica), and the make/CI entry points."
tags: [testing, testscript, integration, unit-tests, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-dfbe54d743a2972ef08388fd
    resource: repo://command/ca/health_test.go
  - id: openwiki-source-c235e9d914e9d229ac661f15
    resource: repo://command/certificate/inspect_test.go
  - id: openwiki-source-f22687e3ddd183c70e3a6bc8
    resource: repo://command/ssh/proxycommand_test.go
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-a3cf1d1249d15e362b08c110
    resource: repo://integration/crypto_test.go
  - id: openwiki-source-7cb094ef8fab44ceb877ed7f
    resource: repo://integration/help_test.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-41b7c00e664436c20c2a2f81
    resource: repo://integration/openssl-jwt.sh
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-0427a29079df0e9dd1633bac
    resource: repo://integration/testdata/bogus.txtar
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# Testing Strategy

Verification splits into colocated unit tests, the `integration/` end-to-end suite, help-text quality gates, and CI entry points. There are no mocks of the CLI binary: the whole command tree runs *inside the test process*.

## The testscript harness

`integration/shared_test.go` wires `TestMain` to `testscript.Main`, registering `internal/cmd.Run` as the in-process `step` command — every txtar script executes the real app with a fresh sandboxed work directory, environment, and exit-code checks (`integration/shared_test.go:10-15`). Each suite adds setup and domain checks:

- `TestCertificateSignCommand` generates a CA, key, and CSR with `go.step.sm/crypto/minica` and `keyutil` in Go, serializes them into the test environment's `Setup` hook, and runs `testdata/certificate/sign.txtar`, whose script lines are `exec step certificate sign test.csr cacert.pem cakey.pem` plus a custom `check_certificate` command registered through `Params.Cmds` (`integration/certificate_test.go:19-58`). Failure cases live beside success cases (`sign-bad-csr.txtar`, `verify-bad-pem.txtar`) with their own fixtures.
- `TestCryptoJWKCommand` (and the RSA/EC/OKP/oct variants) inject a `password.txt` into the sandbox and register `check_jwk` to parse the produced JWK and decrypt/verify the key material (`integration/crypto_test.go:29-60`).
- Negative/plugin-path coverage: `testdata/bogus.txtar` asserts that an unknown verb fails with `No help topic for 'bogus'` — the exact `app.Action` fall-through described in [Command Framework and Registration](/openwiki/architecture/command-framework.md) (`integration/main_test.go:16-19`, `integration/testdata/bogus.txtar`).
- Interop fixtures: `integration/openssl-jwt.sh` builds RS256/other-algorithm JWTs with plain `openssl` (base64url-mangled header.payload.signature, including EC DER→concat conversion), and Go helpers like `createTokenUsingOpenSSL` feed those tokens into `step crypto jwt verify` tests so acceptance depends on an independent implementation, not step's own signer (`integration/openssl-jwt.sh:1-25`, `integration/crypto_test.go:567-575`).

Adding a command's e2e coverage therefore means: a `.txtar` file under `testdata/<area>/`, one `TestXxx` with a `Setup` seeding fixtures, and optional `Cmds` check functions (`integration/help_test.go:14-30`).

## Help-quality gates

The same harness polices documentation: `testdata/help/help.txtar` exercises help output, while `TestHelpQuality` runs the help-HTML generator into `report.json` and asserts on the parsed `usage.Report`: headline consistency against a per-command expectations map, section thresholds, and no TODO strings (`integration/help_test.go:14-45`). New commands with malformed descriptions fail here before review.

## Unit-test conventions

Colocated `_test.go` files use:

- `testify/require` + `assert` for structure and values (`internal/cmd/root_test.go:11-27`, `command/ca/health_test.go`), and `smallstep/assert` in older suites (`flags/flags_test.go`, `token/*_test.go`, `internal/kdf/kdf_test.go`).
- Real crypto/material rather than mocks: `minica`-backed HTTPS servers for CA API interactions (`command/ca/health_test.go:31-41`), hand-built certificates for inspect tests (`command/certificate/inspect_test.go:35-93`), and `net.Pipe`-style fakes for regressions like proxycommand's "server closes before stdin" deadlock test (`command/ssh/proxycommand_test.go:19`).
- Table tests over pure logic: token claim options (`token/options_test.go:26`), SAN merging (`command/ca/sign_test.go:21`), audience computation (`utils/cautils/offline_test.go:56`).

## Running and CI

```
make test    # gotestsum -- -coverprofile=coverage.out -short -covermode=atomic ./...
make race    # gotestsum -- -race ./...
make lint    # golangci-lint with the shared smallstep/workflows config, then govulncheck
```

(`Makefile:147-176`) — note `-short` is passed but no test currently checks `testing.Short`, so everything runs either way. CI (`ci.yml`) delegates to `smallstep/workflows/goCI.yml` with CodeQL and a pinned golangci-lint, and the release flow re-runs it before publishing (`ci.yml:18-30`, `release.yml:14-19`).

## What each change should touch

| Change | Minimum verification |
|---|---|
| New/changed command behavior | txtar in `integration/testdata/<area>/` + colocated unit test; `root_test.go` list if top-level (`guides/adding-a-command.md`) |
| Token/provisioner logic | `token/options_test.go`-style unit + `utils/cautils` flow tests (`guides/adding-a-provisioner-type.md`) |
| Help text | `make test` including `TestHelpQuality` |
| Dependency bump | `make lint` (govulncheck) + CI (`build-and-packaging`) |

## See also

- [Change Guide: Add a New Command](/openwiki/guides/adding-a-command.md)
- [Build, Packaging, and Release Pipeline](/openwiki/operations/build-and-packaging.md)
