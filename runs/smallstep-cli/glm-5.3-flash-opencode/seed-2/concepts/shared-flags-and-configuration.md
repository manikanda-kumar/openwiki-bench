---
type: concept
title: Shared Flags and Configuration
description: The flags package's reusable flag definitions, the parsing/precedence helpers, password sourcing rules, and how defaults.json fits into flag resolution.
tags: [flags, configuration, cli, passwords, precedence]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
  - id: openwiki-source-df2d16b29c2bbf9191277bfd
    resource: repo://utils/read.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# Shared Flags and Configuration

## The `flags` package

`flags/flags.go` is the single home for reusable `cli.Flag` definitions.
Commands embed these by reference so that a flag's name, aliases, and help text
stay identical across the CLI. The definitions fall into these families:

- **Key generation**: `KTY` (`--kty`, default `EC`), `Size`, `Curve`
  (`--crv,curve`), plus `Subtle`/`Insecure` gates (each with a hidden variant)
  for operations the CLI considers risky.
- **CA connection**: `CaURL` (`--ca-url`), `Root` (`--root`),
  `CaConfig` (`--ca-config`, whose default value is `$(step path)/config/ca.json`,
  computed at flag definition time), `Offline`, `Provisioner`
  (`--provisioner,issuer`), and `Token`.
- **Contexts**: `Context`, `ContextProfile`, `ContextAuthority`, and
  `HiddenNoContext` — a hidden `--no-context` boolean-true flag that commands
  include to opt out of context configuration.
- **Passwords**: `PasswordFile`, `NoPassword` (writes unencrypted keys and
  requires `--insecure`), `ProvisionerPasswordFile` and
  `AdminPasswordFile`, each also in a `WithAlias` variant that adds
  `password-file` as an alias.
- **JWT headers and claims**: `X5cCert`/`X5cKey`/`X5cChain`/`X5cInsecure`
  (x5c vs x5cInsecure header), `X5tCert`/`X5tKey`, `SSHPOPCert`/`SSHPOPKey`,
  `NebulaCert`/`NebulaKey`, and `Confirmation`/`ConfirmationFile`
  (`--cnf`/`--cnf-file`, restricting a token to a CSR fingerprint).
- **Admin API**: `AdminCert`, `AdminKey`, `AdminProvisioner`, `AdminSubject`.
- **Validity**: `NotBefore`/`NotAfter` and the SSH-only
  `CertNotBefore`/`CertNotAfter`, all accepting RFC 3339 times or Go
  durations relative to now.
- **Teams/bootstrap**: `Team`, `TeamURL` (with `<>` placeholder substitution),
  `TeamAuthority`, `RedirectURL`.
- **Templates**: `Template`, `TemplateSet` (`--set`, repeatable `key=value`),
  `TemplateSetFile` (`--set-file`).
- **Miscellaneous**: `Force`, `DryRun`, `Limit`, `NoPager`, `ServerName`,
  `Identity` (exists so an identity can be set from
  `$STEPPATH/config/defaults.json`), ACME EAB flags, `KMSUri` (whose help text
  documents the supported `yubikey:`, `pkcs11:`, `tpmkms:`, `cloudkms:`,
  `awskms:`, `azurekms:` URI schemes), `AttestationURI`, `Comment`, and
  `Console`.

## Parsing helpers

The package also owns shared parsing/validation logic:

- `ParseCaURL(ctx)` requires a non-empty `ca-url` (unless `--offline`), and
  `ParseCaURLIfExists(ctx)` allows empty. Both route through `parseCaURL`,
  which prepends `https://` when no scheme is present, rejects any scheme
  other than `https`, normalizes bare IPv6 hosts by adding brackets, and
  returns `scheme://host[:port]`.
- `ParseTimeOrDuration` accepts an empty string, RFC 3339 text, or a Go
  duration (interpreted relative to `time.Now`); `ParseTimeDuration` wraps the
  `not-before`/`not-after` flags into the CA API's `TimeDuration` type.
- `ParseFingerprintFormat` maps `hex`, `base64`, `base64-url`,
  `base64-raw`, `base64-url-raw`, and `emoji` onto fingerprint encodings.
- `GetTemplateData`/`ParseTemplateData` merge `--set-file` JSON with `--set`
  `key=value` pairs; values that parse as JSON keep their parsed type, others
  are stored as strings.

## Precedence rules established in source

- `FirstStringOf(ctx, flags...)` implements the shared precedence used for the
  provisioner name (`provisioner`, then `issuer`): the first flag explicitly
  set wins; otherwise the first flag with a non-empty default is used.
- `ParseCaURL` resolves `ca-url` from the cli context only. How a value gets
  into that context is a two-layer story: the `step.Init()` runtime from
  cli-utils prepares the context (including defaults loaded for the current
  context/authority), and `step ca bootstrap` writes the persisted defaults —
  `$STEPPATH/config/defaults.json` containing `ca-url`, `fingerprint`, `root`,
  and optionally `redirect-url`, `provisioner`, and `min-password-length` —
  plus the `ca-url`/`fingerprint`/`root` values into the live CLI context
  (`ctx.Set`). Commands then read `--ca-url`/`--root` through the flags
  package helpers and fall back to `$STEPPATH/certs/root_ca.crt` when `--root`
  is unset (see `utils/cautils/client.go`).

## Key parameter validation

`utils.GetKeyDetailsFromCLI` (in `utils/cli.go`) is the shared validator for
`--kty`/`--curve`/`--size`: RSA defaults to 2048 bits and rejects sizes below
2048 unless `--insecure` is given; EC defaults to P-256 and rejects `--size`;
incompatible flag combinations return `errs.IncompatibleFlagValue` errors.
The constants `DefaultRSASize = 2048` and `DefaultECCurve = "P-256"` live here.

## Password and input sourcing

`utils/read.go` centralizes how sensitive input enters the CLI:

- `ReadPasswordFromFile` reads a password file and trims trailing whitespace;
  both the offline CA loader and provisioner/token flows use it for
  `--password-file` style flags.
- `ReadInput` reads piped stdin when stdin has content or is a named pipe,
  otherwise falls back to `ui.PromptPassword`.
- `ReadFile` treats a lone `-` as stdin and strips UTF BOMs from regular
  files (via the embedded `utils/internal/utfbom` helper) — used by
  commands that accept file-or-stdin input.

Interactive password prompts ultimately flow through the `ui.PromptPassword`
hook installed into `pemutil` and `jose` at app startup (see
[Command Dispatch](/openwiki/architecture/command-dispatch.md)), so
encrypted-PEM and JWE prompts behave identically everywhere.
