---
type: concept
title: Shared Flags and Parsing Contracts
description: The flags package catalogs reusable urfave/cli flag definitions and the validation contracts (https-only ca-url, time|duration values, JSON template data, key type/curve/size rules) that all step commands share.
tags: [flags, configuration, validation, cli-conventions]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
  - id: openwiki-source-90c79f73277cd4b004ddf996
    resource: repo://utils/utils.go
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---

# Shared Flags and Parsing Contracts

`flags/flags.go` is the single source of truth for flag names, aliases, and
usage text across the CLI, plus the parsers that turn flag strings into typed
values with consistent error behavior. `utils/` adds the key-detail validation
and general URL helper. Command packages should reuse these rather than
re-declaring flags or re-implementing validation (see
[Change Guide: Adding or Modifying Commands](/openwiki/changes/adding-and-modifying-commands.md)).

## Flag catalog

The defined flags cluster by concern (flags/flags.go:23-524):

- **Key material:** `KTY` (EC default; EC/OKP/RSA), `Size`, `Curve`.
- **Safety valves:** `Subtle`/`SubtleHidden` ("allow delicate operations"),
  `Insecure`/`InsecureHidden`, `Force` (`-f,force` file overwrite), `DryRun`.
- **CA targeting:** `CaURL`, `Root`, `Offline`, `CaConfig`, `Token`,
  `Provisioner` (`provisioner,issuer`), `Kid` is handled ad hoc.
- **Admin auth:** `AdminProvisioner`, `AdminSubject`, `AdminPasswordFile`,
  `AdminCert`, `AdminKey`.
- **JWT credential types:** `X5cCert/X5cKey/X5cChain/X5cInsecure`,
  `X5tCert/X5tKey`, `SSHPOPCert/SSHPOPKey`, `NebulaCert/NebulaKey`, `Team`,
  `TeamURL`, `TeamAuthority`.
- **Validity:** `NotBefore`/`NotAfter` (RFC 3339 time or Go duration relative
  to now), `CertNotBefore`/`CertNotAfter` (SSH only).
- **Templates:** `Template`, `TemplateSet` (`--set key=value`, repeatable),
  `TemplateSetFile`.
- **Contexts:** `Context`, `ContextProfile`, `ContextAuthority`, and the
  hidden `HiddenNoContext`.
- **KMS/attestation:** `KMSUri` documents the URI grammar
  (`kmstype:[key=value;…]?[key=value&…]`) for yubikey, pkcs11, tpmkms,
  cloudkms, awskms, azurekms; `AttestationURI`.
- **Misc UX:** `Limit`, `NoPager`, `Console`, `Comment`, `Identity` (exists so
  the positional argument can be set from `$STEPPATH/config/defaults.json`),
  `ServerName`, `RedirectURL`, `K8sSATokenPathFlag` (default
  `/var/run/secrets/kubernetes.io/serviceaccount/token`).

Note that flag *defaults referencing paths* are evaluated at process start:
`CaConfig` defaults to `filepath.Join(step.Path(), "config", "ca.json")`
(flags/flags.go:291-296), making the offline config context-dependent (see
[STEPPATH, Contexts, and Local State](/openwiki/architecture/steppath-and-contexts.md)).

## ca-url contract

`ParseCaURL` requires a non-empty `--ca-url` (unless `--offline`), while
`ParseCaURLIfExists` permits empty (flags/flags.go:649-669). Both funnel into
`parseCaURL` (flags/flags.go:671-706):

1. Missing scheme ⇒ `https://` is prepended.
2. Parse failure ⇒ `errs.InvalidFlagValueMsg(..., "invalid URL")`.
3. Scheme other than `https` ⇒ error `"must have https scheme"` — plain HTTP
   CA URLs are never accepted.
4. IPv6 repair: a "too many colons" host is re-bracketed when it parses as an
   IPv6 literal, with or without a trailing port.
5. Only `scheme://host` is returned — any path is stripped.

Separately, `utils.CompleteURL` (utils/utils.go:28-61) is a more forgiving
recursive normalizer used when *storing* bootstrap configuration; it handles
opaque `host:port` strings and path-first inputs like
`ca.smallstep.com/1.0/sign`.

## Time and template data

- `ParseTimeDuration` converts `--not-before`/`--not-after` to
  `api.TimeDuration` via certificates' parser, mapping failures to
  `errs.InvalidFlagValue` (flags/flags.go:585-596). `ParseTimeOrDuration`
  (flags/flags.go:568-582) resolves RFC 3339 times, or durations as offsets
  from `time.Now()`.
- `GetTemplateData` merges `--set-file` (a JSON object) with repeated
  `--set key=value` pairs; values that parse as JSON keep their type,
  otherwise they become strings. A `--set` entry without `=` is an
  `InvalidFlagValue` error (flags/flags.go:613-643). `ParseTemplateData`
  marshals the map for the CA request.

## Alias and lookup helpers

`FirstStringOf(ctx, "provisioner", "issuer")` returns the value of the first
*explicitly set* flag, else the first non-empty default, along with its flag
name — used wherever `--issuer` is a legacy alias for `--provisioner` so error
messages cite the flag the user actually typed (flags/flags.go:708-729).
`ParseFingerprintFormat` maps `--format` to `fingerprint.Encoding` (hex,
base64 variants, emoji) (flags/flags.go:546-564).

## Key detail validation

`utils.GetKeyDetailsFromCLI` (utils/cli.go:20-84) is the shared validator for
`--kty/--curve/--size` combinations:

- Nothing set ⇒ defaults `EC/P-256`.
- RSA: default 2048 bits; sizes below `keyutil.MinRSAKeyBytes*8` require the
  `insecure` argument to be true, otherwise `errs.MinSizeInsecureFlag`.
- EC: `size` is incompatible; curve must be P-256/P-384/P-521.
- OKP: `size` incompatible; curve must be (or default to) Ed25519.
- Setting `--curve`/`--size` without `--kty` errors with
  `errs.RequiredWithFlag`.

Flag names are parameterized (`ktyKey, curveKey, sizeKey`) because some
commands spell them differently.

## Context selection flags

`--context <name>`, `--profile <name>`, `--authority <name>` steer which
context applies to a command; `flags/flags.go:256-280` defines them, and
`UseContext` in cautils treats any of them being set as opting into context
handling (utils/cautils/bootstrap.go:36-41). `HiddenNoContext` is a
`cli.BoolTFlag` (default-true semantics in urfave/cli v1) whose meaning — "do
not apply the context environment for this command" — is interpreted by the
external cli-utils step package, not by code in this repository; commands that
operate globally (context management, version, completion, `ca init`) declare
it to escape context scoping.

## Error-surface helpers

`utils.Fail` (utils/utils.go:14-23) is the older ad-hoc terminator: prints
`%+v` under `STEPDEBUG=1`, otherwise the message, then exits 1. New code
returns errors to the runtime's messenger-error path instead (see
[CLI Runtime and Plugin Dispatch](/openwiki/architecture/cli-runtime.md)).

## See also

- [CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)
- [Change Guide: Adding or Modifying Commands](/openwiki/changes/adding-and-modifying-commands.md)
