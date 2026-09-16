---
type: configuration
title: "Configuration, State Files, and Flags"
description: "The step CLI's on-disk state under STEPPATH (defaults.json, contexts.json, current-context.json, ca.json, root CA, TPM and plugin directories), the global and shared flag system in flags/, and the environment variables the code reads."
tags: [configuration, steppath, flags, contexts, environment, state]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-3c5e1c665e120c8c57eafc01
    resource: repo://command/ca/acme/eab/list.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-4c7d6cc08b7c0449781d3990
    resource: repo://command/context/select.go
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-64e9e0454ec388f0aa291c8f
    resource: repo://internal/sshutil/agent_unix.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

## The STEPPATH model

All persistent state lives under a base path that defaults to `$HOME/.step` and is overridable with the `STEPPATH` environment variable, as documented by `step path` (`command/path/path.go:14-37`). The path has three flavors, all resolved by cli-utils helpers this repository calls:

- **Base path** — `step.BasePath()`, printed by `step path --base` (`command/path/path.go:93-95`).
- **Authority path** — `step.Path()`, the default for `step path`. When a context is selected it returns the per-authority directory `$STEPPATH/authorities/<authority>`; without a context it is the base path itself (`command/path/path.go:39-46,101`).
- **Profile path** — `step.ProfilePath()`, printed by `step path --profile` (e.g., `$HOME/.step/profiles/<profile>`) (`command/path/path.go:61-80,97-99`).

Contexts are the mechanism for switching between authorities:

- `contexts.json` (base path) maps each context name to an `{authority, profile}` object (`command/context/context.go:21-36`, `command/path/path.go:66-77`).
- `current-context.json` (base path) holds `{"context": "<name>"}` and is what makes `step path` return an authority path (`command/path/path.go:39-46`).
- `step context select/list/current/remove` manage these via `step.Contexts()` (cli-utils); `select` calls `SaveCurrent`, `remove` deletes the context and its configuration (`command/context/select.go:34-41`, `command/context/current.go`, `command/context/remove.go`).
- Commands accept `--context <name>`, `--profile <name>`, `--authority <name>` (`flags.Context`, `flags.ContextProfile`, `flags.ContextAuthority`, `flags/flags.go:264-284`), and the hidden `--no-context` BoolT flag (`flags.HiddenNoContext`, `flags/flags.go:258-262`) opts a command out of context-specific environment application.
- `cautils.UseContext` returns true when contexts are enabled or any of those flags is set, and `cautils.WarnContext` prints a hint when a `ca.json` exists at `$(step path --base)/config/ca.json` but contexts are unused (`utils/cautils/bootstrap.go:36-54`).

## State file map

| File (resolved at runtime) | Producer/consumer | Notes |
|---|---|---|
| `step.DefaultsFile()` — shown as `$STEPPATH/config/defaults.json` in command docs (`command/ca/ca.go:36-41`, `flags/flags.go:453-457`) | Written by `step ca bootstrap` (`utils/cautils/bootstrap.go:146,169-193`); read by the cli-utils step environment | JSON: `ca-url`, `fingerprint`, `root`, optional `redirect-url`, `provisioner`, `min-password-length`; written `0o644`. Also the documented place to configure CLI flags like `identity`. |
| `pki.GetRootCAPath()` — shown as `$STEPPATH/certs/root_ca.crt` (`command/ca/ca.go:38-41`) | Written by bootstrap (`utils/cautils/bootstrap.go:145-161`); the default `--root` in nearly every CA command (`utils/cautils/client.go:65-71`, `certificate_flow.go:160-165`) | The trusted root certificate; written `0o600`, parent dirs `0o700`. |
| `step.ProfileDefaultsFile()` | Created by bootstrap as `{}` when contexts are enabled (`utils/cautils/bootstrap.go:197-210`) | Per-profile flag defaults; created `0o600`. |
| `step.Path()/config/ca.json` | Produced by `step ca init`; consumed in offline mode | Default value of `--ca-config` (`flags/flags.go:290-296`); the offline CA loads it via `NewOfflineCA` (`utils/cautils/offline.go:42-81`). |
| `step.Path()/tpm/` | `step ca certificate` | Default `--tpm-storage-directory` for TPM-attested keys (`command/ca/certificate.go:181-184`). |
| `step.BasePath()/plugins/` | operators | First search location for `step-<name>-plugin` executables (`internal/plugin/plugin.go:40-47`). |
| `current-context.json`, `contexts.json` | `step context` commands, bootstrap | See context model above. |

The exact layout constants are owned by cli-utils (`step` and `pki` packages); this repository consistently goes through those helpers rather than hard-coding paths, and the bootstrap command documents the resulting locations in its help text.

## Global flags

- `--config <path>` is registered on the app as "path to the config file to use for CLI flags" (`internal/cmd/root.go:127-131`); nothing in this repository reads the value directly — it is consumed by the cli-utils environment layer.
- `step ca init` deliberately sets `EnvVar: step.IgnoreEnvVar` on its `--root` and `--key` flags so they are not bound to environment variables (`command/ca/init.go:49-58`).

## Shared flag definitions (flags/flags.go)

`flags/flags.go` (730 lines) is the single source for cross-command flags. Highlights:

- **CA connection**: `CaURL` (`--ca-url`), `Root` (`--root`), `Token` (`--token`), `Offline` (`--offline`), `CaConfig` (`--ca-config`, default `step.Path()/config/ca.json`).
- **Key material**: `KTY` (default `EC`), `Curve` (`P-256`/`P-384`/`P-521`/`Ed25519`), `Size`, `KMSUri` (`--kms` with `kmstype:[params]?[credentials]` syntax and per-type parameter docs for yubikey, pkcs11, tpmkms, cloudkms, awskms, azurekms), `AttestationURI`, `PasswordFile`, `NoPassword` (documented as requiring `--insecure`), `Force`, `DryRun`.
- **Validity**: `NotBefore`/`NotAfter` (time or duration), SSH-only `CertNotBefore`/`CertNotAfter`.
- **Provisioning headers**: `X5cCert/X5cKey/X5cChain/X5cInsecure`, `X5tCert/X5tKey`, `SSHPOPCert/SSHPOPKey`, `NebulaCert/NebulaKey`, `AdminCert/AdminKey/AdminSubject/AdminProvisioner`, `K8sSATokenPathFlag` (default `/var/run/secrets/kubernetes.io/serviceaccount/token`).
- **Templates**: `Template`, `TemplateSet` (`--set`), `TemplateSetFile` (`--set-file`), `Identity`.
- **ACME/team**: `EABKeyID`, `EABReference`, `Team`, `TeamURL` (supports `<>` placeholders for the team ID), `TeamAuthority`, `RedirectURL`, `Confirmation`/`ConfirmationFile` (`--cnf`/`--cnf-file`), `ServerName`.
- **Security gates**: `Subtle`/`SubtleHidden` (`--subtle`) and `Insecure`/`InsecureHidden` (`--insecure`) gate delicate operations.

Parsing helpers with behavior worth knowing:

- **`ParseCaURL` / `ParseCaURLIfExists`** (`flags/flags.go:645-706`): `ParseCaURL` requires a non-empty `--ca-url` unless `--offline` is set; `ParseCaURLIfExists` returns an empty value. Both prepend `https://` when no scheme is present and reject any non-https scheme. A bare IPv6 host without brackets (optionally with a port) is normalized to bracketed form before returning.
- **`ParseTimeOrDuration` / `ParseTimeDuration`** (`flags/flags.go:566-596`): accept RFC 3339 times or Go durations relative to now; the latter returns `api.TimeDuration` and raises `errs.InvalidFlagValue` on bad input.
- **`ParseFingerprintFormat`** (`flags/flags.go:526-564`): supports `hex`, `base64`, `base64-url`, `base64-raw`, `base64-url-raw`, and `emoji`.
- **`GetTemplateData` / `ParseTemplateData`** (`flags/flags.go:598-643`): merge `--set-file` JSON with repeated `--set key=value` pairs; values are JSON-decoded when possible, otherwise kept as raw strings; the result is marshaled to `json.RawMessage` for CA template data.
- **`FirstStringOf`** (`flags/flags.go:708-730`): resolves aliased flags (e.g., `provisioner`/`issuer`) returning the first explicitly set, then first non-empty default.
- **Key details** (`utils/cli.go:20-83` `GetKeyDetailsFromCLI`): with `--kty` set, validates combinations — RSA defaults to 2048 bits and enforces the minimum size unless `--insecure`; EC rejects `--size` and accepts only P-256/P-384/P-521; OKP only Ed25519. With no `--kty`, any `--curve`/`--size` is an error and the default is EC/P-256.

## Environment variables read by the code

| Variable | Where | Effect |
|---|---|---|
| `STEPPATH` | documented in `command/path/path.go:32-37` | Overrides the `$HOME/.step` base path. |
| `STEPDEBUG` | `internal/cmd/root.go:67,74,158`, `utils/utils.go:16` | `=1` prints full `%+v` error/panic details (and re-panics). |
| `STEP_LISTEN` | `utils/cautils/token_generator.go:161` | When set, suppresses adding `--listen <provisioner listen address>` to the subprocess `step oauth` invocation used for OIDC tokens. |
| `STEP_OPEN_BROWSER` | `command/oauth/cmd.go:787` | `=0` prints the OAuth URL to stderr instead of opening a browser. |
| `PAGER` | `command/ca/acme/eab/list.go:102-117` | Used by `step ca acme eab list` for paging; values containing shell metacharacters (` \t\n;&|<>`) are rejected; `--no-pager` disables it. |
| `SSH_AUTH_SOCK` | `internal/sshutil/agent_unix.go:16`, `agent_windows.go:18` | Locates the ssh-agent for `step ssh login/logout`. |
| `PATHEXT` | `internal/plugin/plugin.go:25` | Windows plugin executable extensions (default `.com .exe .bat .cmd .ps1`). |
| `TERM` | `internal/sshutil/shell.go:292` | Shell selection heuristics in ssh config templates. |
| `HOMEDRIVE`/`HOMEPATH` | `internal/sshutil/pipe.go:19-22` | Windows home path for the ssh config file location. |
| `GOOGLE_APPLICATION_CREDENTIALS` | documented in `command/ca/init.go:189-195` | Alternative to `--credentials-file` for CloudCAS. |

Beyond these, flag-to-environment binding is a cli-utils/urfave-cli concern not redefined in this repository.

## Written-file permission conventions

Files this repository writes follow a consistent scheme: root certificates and private keys `0o600` (bootstrap `utils/cautils/bootstrap.go:157`, signed certs `utils/cautils/certificate_flow.go:292`, `command/ca/certificate.go:299`), `defaults.json` `0o644` (`utils/cautils/bootstrap.go:191`), profile defaults `0o600` (`utils/cautils/bootstrap.go:205`), and all created parent directories `0o700` (`utils/cautils/bootstrap.go:148-154,200-202`).

## Uncertainties

- The precise resolution order for `step.Path()` (context vs `defaults.json` fallback) lives in cli-utils and is not re-implemented here; this page reflects only the documented behavior and the helper call sites in this repository.
