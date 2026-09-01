---
type: "Reference"
title: "Testing strategy"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-7cb094ef8fab44ceb877ed7f
    resource: repo://integration/help_test.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-362b503187f3ead50d917bf1
    resource: repo://internal/cmd/root_test.go
  - id: openwiki-source-0a16b950c7efe8121f8f5cbe
    resource: repo://internal/kdf/kdf_test.go
  - id: openwiki-source-d9f61f7b049ac89c0195979d
    resource: repo://internal/sshutil/sshutil_test.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-810170e37dbea715fcf454da
    resource: repo://token/parse_test.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# Testing strategy

The repository relies on standard Go unit tests plus a `testscript`-based
integration harness that executes the real `step` binary entrypoint against
`.txtar` scenarios.

## Unit tests

Package-level `_test.go` files cover the internal helpers and token logic:

- `internal/kdf/kdf_test.go` verifies each KDF (scrypt, bcrypt, argon2i,
  argon2id) produces the expected PHC/Modular-Crypt prefix and that
  `Compare`/`CompareString` round-trips arbitrary inputs.
- `internal/sshutil/sshutil_test.go` covers SSH public-key parsing (ECDSA
  curves, RSA, Ed25519) round-tripped through `golang.org/x/crypto/ssh`.
- `token/parse_test.go` and `token/token_test.go` cover token parsing
  (JWK/OIDC/GCP/AWS/Azure fixtures), `Payload.Type()` classification, claim
  signing, key-ID generation, and validity bounds.
- `internal/cmd/root_test.go` asserts the registered top-level command list and
  that `newApp` runs and renders the app help.
- Other focused tests exist alongside their packages (`flags/flags_test.go`,
  `internal/sliceutil/sliceutil_test.go`, `internal/cast/cast_test.go`,
  `command/ca/init_test.go`, `command/ca/sign_test.go`,
  `command/crypto/winpe/winpe_test.go`, and more).

## Integration tests

The `integration` package drives end-to-end CLI behavior with
`github.com/rogpeppe/go-internal/testscript`:

- `TestMain` registers the in-process `step` entrypoint via
  `testscript.Main` mapping the `step` command to `internal/cmd.Run`
  (`integration/shared_test.go:11-14`), so `.txtar` scripts invoke the real
  command tree.
- `integration/main_test.go` runs simple version/bogus-command scenarios
  (`testdata/version.txtar`, `testdata/bogus.txtar`).
- `integration/certificate_test.go` generates real keys/CSRs/CAs in Go, writes
  them into the test directory in `Setup`, and then asserts CLI behavior via
  `.txtar` files such as `testdata/certificate/sign.txtar`,
  `sign-bad-csr.txtar`, `verify.txtar`, and `fingerprint.txtar`, including a
  custom `check_certificate` command that parses the command's stdout
  (`integration/certificate_test.go:42-57`, `124-132`).
- `integration/crypto_test.go` exercises crypto command scenarios.
- `integration/help_test.go` runs `testdata/help/help.txtar` and a help-quality
  harness (`testdata/help/html.txtar`) that parses a JSON help report and
  enforces documentation consistency: expected ALL-CAPS section headlines,
  minimum word/line counts per section, and no `TODO` markers
  (`integration/help_test.go:21-107`).

## Test/build commands

The Makefile wires the tooling (Makefile:151-175):

- `make test` runs `gotestsum` with `-short` and coverage over `./...`.
- `make race` runs the suite with the race detector.
- `make lint` runs `golangci-lint` (config fetched from
  `smallstep/workflows`) plus `govulncheck`; `make bootstrap` installs the
  required tools.

The CI workflow (`ci.yml`) delegates to the reusable `smallstep/workflows`
`goCI.yml`, running Go CI across Go versions with CodeQL and
`golangci-lint` (`.github/workflows/ci.yml:19-30`).
