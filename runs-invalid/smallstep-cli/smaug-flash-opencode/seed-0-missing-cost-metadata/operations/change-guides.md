---
type: "Reference"
title: "Change Guides for Common Maintenance Tasks"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-988c8cad0c37be7c2e621ebe
    resource: repo://command/ca/init_test.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---


# Change Guides for Common Maintenance Tasks

These guides assume the reader can build and test the CLI. The canonical build is
`make build` (outputs `bin/step`); unit tests via `go test ./...` and the CLI
integration suite via the `integration` test package. Many command groups have
focused Go tests, e.g. `command/ca/init_test.go`, `command/ca/sign_test.go`,
and `command/certificate/inspect_test.go`.

## Adding a new CLI subcommand

Most top-level command groups register themselves in a package under
`command/<group>` that `internal/cmd/root.go` imports blank. Follow the pattern
in `command/ca/ca.go` (for a group) or `command/version/version.go` (for a
simple leaf):

1. Create (or reuse) a package under `command/`, e.g. `command/foo`. In its
   `init()` build a `cli.Command` (with `Name`, `Usage`, `Description`, `Flags`,
   and `Subcommands`) and call `command.Register(cmd)`.
2. If this is a new top-level group, add a blank import for it in
   `internal/cmd/root.go` so its `init()` runs.
3. Implement the action function. Register it with
   `command.ActionFunc(...)` (or `cli.ActionFunc(...)`) so it composes with the
   context-injection machinery in `internal/command/inject.go`. If the action
   needs the Go context or to recover the CLI context, use the helpers there.
4. If the new command belongs to an existing group, instead add the subcommand
   to that group's `Subcommands` slice (e.g. add to `ca.Command()` in
   `command/ca/ca.go`).
5. Add a testscript case under `integration/testdata/` (e.g.
   `testdata/foo.txtar`) and a corresponding `TestFoo` in an `integration/*_test.go`
   wired through `testscript.Run` (see `integration/certificate_test.go`). If
   there is no preferred group, follow `TestVersionCommand` in
   `integration/main_test.go`.

Always run `go build ./...` and the relevant tests (`go test ./integration/...`).

## Adding a flag or option

Flags are largely centralized as package-level variables in `flags/flags.go`
(e.g. `KTY`, `Size`, `Curve`, `CaURL`, `Root`, `Offline`, `Token`,
`Provisioner`). Add a shared flag there as a `cli.XxxFlag` variable, then attach
it to the commands that need it by appending it to that command's `Flags` slice.

Flag-specific validation and parsing helpers live in the same file
(`ParseCaURL`, `ParseTimeDuration`, `GetTemplateData`,
`ParseFingerprintFormat`, `FirstStringOf`); add any new parsing logic here so it
is shared consistently. For key-type validation/rejection of incompatible
combinations, use the `errs` helpers from `smallstep/cli-utils/errs` (used all
over the commands, e.g. `errs.IncompatibleFlagWithFlag`,
`errs.RequiredWithFlag`, `errs.InvalidFlagValue`).

Test with a focused testscript case that exercises both the happy path and the
rejection path (mirror `integration/testdata/crypto/jwk-create-rsa.txtar`).

## Changing default key sizes and curves

Key generation behavior is centralized:

- The CLI-level defaults and validation live in `utils/cli.go`:
  `DefaultRSASize = 2048`, `DefaultECCurve = "P-256"`, and
  `GetKeyDetailsFromCLI` which returns EC/P-256 when no flags are given,
  rejects RSA < the `keyutil.MinRSAKeyBytes*8` minimum unless `--insecure`,
  and validates EC/OKP curves.
- The accepted `--kty`/`--size`/`--curve` flags and their help text live in
  `flags/flags.go` (`KTY`, `Size`, `Curve`).
- The actual key rollout happens in `go.step.sm/crypto/keyutil`
  (`keyutil.GenerateKey`/`GenerateKeyPair`/`GenerateSigner`), an external
  dependency — changing the default there affects all callers.

To change the EC default curve or RSA size, update `DefaultECCurve`/
`DefaultRSASize` in `utils/cli.go` and the corresponding flag defaults in
`flags/flags.go`, then update the integration testscript expectations
(`integration/testdata/...`). Enforced minima live in `utils/cli.go`
(`MinRSAKeyBytes`) consumed via `keyutil.MinRSAKeyBytes`.

## Modifying token claim semantics

Token semantics are concentrated in the `token` package and the flow code:

- Default claims/validity are in `token/token.go`
  (`DefaultIssuer`, `DefaultAudience`, `DefaultValidity`, `MinValidity`,
  `MaxValidity`, `MaxValidityDelay`, `DefaultClaims`, `Claims.Sign`).
- Claim/header setters are the `With...` options in `token/options.go`
  (`WithRootCA`/`WithSHA`, `WithSANS`, `WithStep`/`WithSSH`, `WithUserData`,
  `WithConfirmationFingerprint`/`WithFingerprint`, `WithX5C*`, `WithNebulaCert`,
  `WithSSHPOPFile`, `WithValidity`).
- Token type detection is `token/parse.go` (`Payload.Type`, `Payload` fields,
  `Parse`/`ParseInsecure`, the AWS/Azure decoding).
- The per-provisioner generators and the `TokenGenerator` are in
  `utils/cautils/token_generator.go`, and `NewTokenFlow`/`parseAudience` are in
  `utils/cautils/token_flow.go`.

To change a default (e.g. `DefaultValidity`), update `token/token.go`; to add a
claim, add a `WithXxx` option in `token/options.go` and set it in the
appropriate generator in `utils/cautils/token_generator.go`. If the claim affects
token-type detection, update `Payload.Type` in `token/parse.go`. Tests: the
`utils/cautils/token_flow_test.go` and `integration/testdata/crypto/jwt-sign.txtar` /
`jwt-verify.txtar` cover JWT behavior; add unit cases in `token/options_test.go`.
