---
type: architecture
title: "Testing Strategy"
description: "How the repository is tested: colocated unit tests, the testscript/txtar integration suite in integration/ where TestMain maps step to cmd.Run so tests exercise the real command tree, testdata and check-helper conventions, and the make test/race/lint targets plus CI."
tags: [testing, testscript, txtar, unit-tests, lint, govulncheck, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-27d1d3b8dd01d4218df95de4
    resource: repo://command/ca/sign_test.go
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
  - id: openwiki-source-13422c994a2ed176f5002ae2
    resource: repo://integration/testdata/crypto/jwk-create.txtar
  - id: openwiki-source-d9f61f7b049ac89c0195979d
    resource: repo://internal/sshutil/sshutil_test.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-810170e37dbea715fcf454da
    resource: repo://token/parse_test.go
  - id: openwiki-source-fe701a9db3b467667b0bc90d
    resource: repo://token/token_test.go
  - id: openwiki-source-d65498dad1900ee9e4309461
    resource: repo://utils/cautils/token_flow_test.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

Testing has two layers: a modest set of **colocated unit tests** (27 `*_test.go` files) and a **testscript/txtar integration suite** in `integration/` that runs the *real* `step` command tree.

## The integration harness (testscript)

`integration/shared_test.go:11-15` installs the harness:

```go
func TestMain(m *testing.M) {
	testscript.Main(m, map[string]func(){
		"step": cmd.Run, // main entrypoint name
	})
}
```

`testscript.Main` registers the function `cmd.Run` (the same entrypoint `cmd/step/main.go` calls) under the script command name **`step`**. Every `exec step ...` line in a txtar file therefore runs the actual, fully-registered command tree in-process — no compiled binary, but the real `init()`-registered commands, flags, and error paths.

Each Go test is thin: it calls `testscript.Run` with a list of `testdata/**/*.txtar` files plus optional hooks (`integration/main_test.go:9-19`, `integration/certificate_test.go:20-72`):

- **`Files`** — the txtar scripts; each `--`-separated section is an independent scenario run in its own temporary working directory.
- **`Setup`** — a per-script function that materializes fixtures into the script's working dir (`e.Cd`): writing generated CAs/keys with `pemutil.Serialize(..., pemutil.WithFilename(...))`, pre-signing tokens, setting `e.Vars` (e.g. `NBF`/`EXP`/`IAT` timestamps in `jwt-sign`).
- **`Cmds`** — custom script verbs (`check_certificate`, `check_jwk`, `check_otp`, ...) implemented in Go that assert on command output or files (below).

**Txtar conventions** (see `integration/testdata/bogus.txtar`, `integration/testdata/crypto/jwk-create.txtar`):

```
exec step crypto jwk create --password-file password.txt defaults.pub defaults.priv
check_jwk defaults.pub defaults.priv ECDSA P-256

! exec step crypto jwk create --kty rsa ...
stderr 'invalid value ''rsa'' for flag ''--kty''; options are EC, RSA, OKP, or oct'
```

- `exec step ...` asserts success (exit 0); `! exec` asserts failure; `stdout`/`stderr` lines are glob-matched; `#` lines are comments.
- Scenarios group happy paths and a battery of flag-validation failures (bad `--kty` values, missing positionals, incompatible flags) in one file.

**Check helpers**: `checkCertificate` parses the *previous command's stdout* (`ts.ReadFile("stdout")`) and asserts a one-cert bundle (`integration/certificate_test.go:124-132`); `checkKeyPair`/`checkKeyDetails` parse the pub/priv JWKs (private key with the shared test password), compare SHA-1 thumbprints, and verify type/size/curve/algorithm expectations per key type (EC P-256/384/521, RSA size, OKP Ed25519, oct byte-slice) (`integration/crypto_test.go:321-454`); `checkOTP` validates TOTP code length and `otpauth://` URL fields (`integration/crypto_test.go:279-310`).

**Cross-tool verification**: `createTokenUsingOpenSSL` shells out to `integration/openssl-jwt.sh`, which signs JWTs with **OpenSSL** (RS256 directly; ES256 by re-encoding the DER signature) — the resulting `ossltoken.txt` fixtures make `step crypto jwt verify` prove interop with externally produced tokens (`integration/crypto_test.go:200-211,568-575`; `openssl-jwt.sh:1-30`). TOTP fixtures are computed independently with `pquerna/otp` (`integration/crypto_test.go:248-277`). Certificates are generated per-run with `minica` and `keyutil` rather than checked in (`integration/certificate_test.go:20-107`).

**Coverage area**: `TestVersionCommand` (version banner), `TestBogusCommandFails` (unknown command → `No help topic for 'bogus'`), `TestCertificateSignCommand`/`TestCertificateVerifyCommand`/`TestCertificateFingerprintCommand` (sign/verify/fingerprint with generated CAs, including invalid-PEM and bad-CSR negative cases), the crypto battery (`jwk create` per key type, `jwt sign`/`verify`/`inspect` including OpenSSL-produced and corrupted tokens, `keypair`, `otp`, help output), and the **help-quality gate**: `TestHelp` checks top-level help text, while `TestHelpQuality` runs a `check_quality` custom verb that parses a `usage.Report` (from `cli-utils/usage`) and enforces consistent capitalized headlines, per-section word/line **thresholds** (`expectations` map, e.g. `SECURITY CONSIDERATIONS` ≤ 220 words), and **no TODOs** in help text (`integration/help_test.go:21-107`).

## Colocated unit tests

The unit-test layer sits next to the code it covers, with the deepest coverage where pure logic lives: `token/` (`options_test.go`, `parse_test.go`, `token_test.go`, `provision/provision_test.go` — token construction, claim parsing, and type detection), `command/ca/` (`init_test.go`, `sign_test.go`, `health_test.go`, plus `policy/` and `provisioner/` subpackages), `utils/cautils/` (`offline_test.go`, `token_flow_test.go`), `internal/sshutil/` (`sshutil_test.go`, `pipe_test.go`), `command/certificate/` (`inspect_test.go`, `remote_test.go`), `internal/kdf/kdf_test.go`, `command/crypto/winpe/winpe_test.go`, `flags/flags_test.go`, `internal/cmd/root_test.go`, and the vendored `pkg/bcrypt_pbkdf/bcrypt_pbkdf_test.go`.

## Make targets and CI

From the `Makefile` (`CGO_ENABLED=0` is the default override for all test/build targets):

| Target | Command | Purpose |
|---|---|---|
| `make test` | `gotestsum -- -coverprofile=coverage.out -short -covermode=atomic ./...` | Short-mode unit+integration run with coverage (`-short` lets `testing.Short()` skip slow tests). |
| `make race` | `gotestsum -- -race ./...` | Full run under the race detector. |
| `make lint` | `golint` + `govulncheck` | Quality gate (below). |
| `make fmt` | `goimports -local github.com/golangci/golangci-lint -l -w $(SRC)` | Canonical import grouping. |

- **`golint`** runs `golangci-lint` with the **shared Smallstep config fetched at runtime** — `--config <(curl -s https://raw.githubusercontent.com/smallstep/workflows/master/.golangci.yml)` — at `LOG_LEVEL=error` with a 30-minute timeout (`Makefile:168-170`). `make bootstrap` installs the toolchain (golangci-lint, govulncheck, gotestsum, goimports, GoReleaser Pro).
- **`govulncheck`** scans `./...` against the Go vulnerability database (`Makefile:172-173`).
- **CI** (`.github/workflows/ci.yml`): on pushes to `master` (tags excluded), pull requests, and `workflow_call`, it delegates to the reusable `smallstep/workflows/.github/workflows/goCI.yml@main` with `only-latest-golang: false` (multiple Go versions), `run-codeql: true`, `golangci-lint-version: v2.12.1`, and an inherited `CODECOV_TOKEN` for coverage upload; a concurrency group cancels superseded runs. The same workflow directory contains `actionci.yml`, `code-scan-cron.yml`, `dependabot-auto-merge.yml`, `release.yml`, and the OpenWiki refresh workflow (see the build page).

**Change guide**: new user-visible behavior belongs in a txtar scenario under `integration/testdata/<group>/` (happy path plus the obvious failure modes, asserted via `! exec` + `stderr` globs); behavior that needs generated crypto or external tools uses `Setup` to write fixtures into `e.Cd`; new script verbs go in the test file's `Cmds` map; and pure Go logic (token parsing, KDFs, flag handling) gets colocated unit tests.
