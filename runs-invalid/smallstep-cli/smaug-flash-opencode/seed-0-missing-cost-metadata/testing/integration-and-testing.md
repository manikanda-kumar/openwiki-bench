---
type: "Reference"
title: "Testing Strategy: Unit, CLI Integration, and Testscripts"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-988c8cad0c37be7c2e621ebe
    resource: repo://command/ca/init_test.go
  - id: openwiki-source-27d1d3b8dd01d4218df95de4
    resource: repo://command/ca/sign_test.go
  - id: openwiki-source-c235e9d914e9d229ac661f15
    resource: repo://command/certificate/inspect_test.go
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-a3cf1d1249d15e362b08c110
    resource: repo://integration/crypto_test.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-2d42e139d28b99ef1065b6e9
    resource: repo://integration/testdata/version.txtar
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-eac4c6d87c1234945c50c143
    resource: repo://utils/cautils/offline_test.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---


# Testing Strategy: Unit, CLI Integration, and Testscripts

The repository relies on two complementary testing layers: focused Go unit tests
colocated with the code, and black-box CLI integration tests driven by the
`testscript` ecosystem.

## Unit tests

Targeted Go tests inspect small units without running the binary. Representative
examples:
- `command/ca/init_test.go` and `command/ca/sign_test.go` for CA-specific logic.
- `command/certificate/inspect_test.go` and `command/certificate/remote_test.go`
  for certificate inspection/remote peer retrieval.
- `command/ssh/proxycommand_test.go` for the SSH proxy helper.
- `utils/cautils/offline_test.go` and `utils/cautils/token_flow_test.go` for the
  offline CA and token flows.
- `token/options_test.go`, `flags/flags_test.go`, `internal/command/inject_test.go`,
  and various `internal/*` tests (e.g. `internal/cast`, `internal/kdf`,
  `internal/sliceutil`, `internal/sshutil`).

These are Go `*_test.go` files in the same package and run with `go test ./...`.

## CLI integration tests via testscript

The `integration` package treats the binary as a black box using the
[`rogpeppe/go-internal/testscript`](https://github.com/rogpeppe/go-internal)
framework. `integration/shared_test.go` registers the `step` command in
`TestMain` via `testscript.Main(m, map[string]func(){ "step": cmd.Run })`, which
installs a `step` command that invokes `cmd.Run()` in-process. This means the
integration tests run the real command tree without shelling out.

`integration/main_test.go` defines simple end-to-end cases over txtar fixtures:
- `TestVersionCommand` runs `integration/testdata/version.txtar`, which asserts
  `step version` prints `Smallstep CLI/0000000-dev`.
- `TestBogusCommandFails` runs `testdata/bogus.txtar` for an unknown command.

`integration/certificate_test.go` and `integration/crypto_test.go` build richer
fixtures. They use `Setup` callbacks to materialize certs/keys/csrs into the
temporary test directory (e.g. `TestCertificateSignCommand` writes a CSR and CA
cert/key), plus custom `Cmds` helpers (`check_certificate`, `check_jwk`,
`check_otp`) that assert on stdout. The crypto tests cover JWK create
(RSA/EC/OKP/oct), JWT sign/verify/inspect (including OpenSSL interop), keypair,
OTP, and help output.

The txtar fixtures live under `integration/testdata/`:
- `testdata/version.txtar`, `testdata/bogus.txtar`.
- `testdata/certificate/` (`sign.txtar`, `sign-bad-csr.txtar`, `verify.txtar`,
  `verify-bad-pem.txtar`, `fingerprint.txtar`).
- `testdata/crypto/` (`jwk-create*.txtar`, `jwt-*.txtar`, `keypair.txtar`,
  `otp.txtar`, `help.txtar`).
- `testdata/help/` (`help.txtar`, `html.txtar`).

## Makefile targets

`Makefile` targets include:
- `test`: `gotestsum -- -coverprofile=coverage.out -short -covermode=atomic ./...`
  (short mode; coverage enabled).
- `race`: `go test -race ./...`.
- `build`: builds `PREFIX/step` (`bin/step`) with `CGO_ENABLED=0` by default and
  optional `GOOS_OVERRIDE`; `-ldflags` inject `main.Version`/`main.BuildTime`.
- `goreleaser`: builds through GoReleaser Pro (used in CI parity).
- `lint`: `golangci-lint` (config fetched from the smallstep workflows repo) plus
  `govulncheck ./...`.
- `install`/`uninstall`: copy/remove the `step` binary under `DESTDIR`.

`make ci` runs `test` then `build`.

## Coverage caveats

The integration suite exercises a representative set of command paths but is
not a full end-to-end coverage of every subcommand against a live CA: many
online-CA behaviors (renew against a real step-ca, revocation, policy/Admin API
calls) are only covered at the unit level or rely on mock/embedded flows like the
offline CA, not real server round-trips against a live `step-ca`. The txtar
fixtures above are explicitly for the offline/crypto paths.
