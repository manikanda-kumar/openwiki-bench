---
type: "Reference"
title: "Testing Strategy and Integration Harness"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-a3cf1d1249d15e362b08c110
    resource: repo://integration/crypto_test.go
  - id: openwiki-source-7cb094ef8fab44ceb877ed7f
    resource: repo://integration/help_test.go
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---


# Testing Strategy and Integration Harness

The repository combines standard Go unit tests with CLI integration tests built
on `github.com/rogpeppe/go-internal/testscript`, and ships build/test/lint
tooling through a `Makefile`.

## Test entrypoint

`integration/shared_test.go` defines `TestMain` that registers the `step`
command with `testscript.Main(m, map[string]func(){"step": cmd.Run})`. This
execute rules for the testscript harness, so `txtar` scripts can invoke the
real `step` command (in-process) via `cmd.Run`.

## testscript/txtar fixtures

Integration tests run `txtar` fixtures under `integration/testdata/**`:

- `integration/main_test.go` — `TestVersionCommand` (version.txtar) and
  `TestBogusCommandFails` (bogus.txtar).
- `integration/certificate_test.go` — `TestCertificateSignCommand`,
  `TestCertificateVerifyCommand`, and `TestCertificateFingerprintCommand`. These
  generate keys/CSRs/CAs in a `Setup` callback before running the `sign.txtar`,
  `verify.txtar`, `fingerprint.txtar` (and negative-case) scripts, and register
  custom check commands (e.g. `check_certificate`).
- `integration/crypto_test.go` — JWK/JWT/JWE/OTP/keypair/help scripts. Multiple
  Setups write (or generate) keys, tokens, and OTP secrets; custom commands
  (`check_jwk`, `check_otp`, `check_key_pair`, etc.) validate the output.
- `integration/help_test.go` — `TestHelp` (help.txtar), `TestHelpQuality`
  (html.txtar) which renders a help-quality HTML report and checks it.

Additional runtime helper fixtures are in `integration/openssl-jwt.sh` (used to
create OpenSSL-signed JWTs for cross-implementation verification).

## Help-quality checks

`integration/help_test.go:21-107` implements `TestHelpQuality`:

- `checkHelpQuality` mandates headline consistency, per-section minimum
  word/line thresholds, and no "TODO" text.
- `expectations` (help_test.go:43-57) lists the accepted canonical headlines
  (e.g. `SECURITY CONSIDERATIONS` requiring 220 words / 25 lines) and
  `checkHeadlineConsistency` fails on any unexpected uppercase headline.
- `checkThresholds` fails if any section is short on words or lines.
- `checkNoTODOs` fails if any section contains "TODO".

These checks keep command help narratively complete and consistent across the
whole CLI.

## Makefile tooling

The `Makefile` centralizes build, test, and lint:

- `make build` — compiles `github.com/smallstep/cli/cmd/step` into
  `$(PREFIX)/step` (default `bin/step`), with linker-injected `Version` and
  `BuildTime`. `CGO_OVERRIDE` defaults to `CGO_ENABLED=0`, and `GOOS_OVERRIDE`
  supports cross-compilation via the `binary-linux-*`/`binary-darwin-*`/
  `binary-windows-*` targets.
- `make test` — runs `gotestsum -- -coverprofile=coverage.out -short
  -covermode=atomic ./...`. `make race` runs with `-race`.
- `make lint` — `golangci-lint run` against the smallstep workflows config plus
  `govulncheck ./...`. `make bootstrap` installs the toolchain
  (golangci-lint, govulncheck, gotestsum, goimports, and GoReleaser Pro).
- `make goreleaser` — builds parity with CI via GoReleaser Pro using
  `.goreleaser.yml`.
- `make install`/`uninstall` — copy the binary to `$(DESTDIR)`.

## Related

- [CLI Runtime and Command Registration](../architecture/command-runtime.md) — what the tests exercise.
- [Quickstart](../quickstart.md) — how to build and run tests.
