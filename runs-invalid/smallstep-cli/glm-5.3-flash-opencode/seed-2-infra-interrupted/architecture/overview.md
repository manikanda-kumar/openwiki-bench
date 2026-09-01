---
type: architecture-overview
title: Architecture and ownership boundaries
description: How the step CLI is layered from the entrypoint through command groups and shared flow packages down to the external smallstep modules it builds on.
tags: [architecture, layering, ownership, dependencies, step-ca, cli-utils]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:55:27.913Z
---

# Architecture and ownership boundaries

`github.com/smallstep/cli` builds the `step` binary — an operator-facing CLI for
X.509/SSH PKI work, both standalone (local key/certificate tooling) and as a
client of the [`step-ca` online CA](https://github.com/smallstep/certificates)
(README.md:12-14). It is a pure-Go module (`CGO_ENABLED=0` in the Makefile and
release builds), targeting Go 1.25.8 per `go.mod`, with roughly three dozen
direct dependencies. This page explains how the code is layered, which repo owns
which behavior, and where the real systems live. Runtime mechanics (dispatch,
errors, plugins) are detailed in [Command registration, dispatch, and runtime
behavior](/openwiki/architecture/command-runtime.md).

## The four layers

### Layer 1 — binary entrypoint

`cmd/step/main.go` is deliberately trivial: three ldflags-injected variables
(`Version`, `BuildTime`, `AppName`), an `init()` that publishes them to
cli-utils and sets the CA client user agent, and `main()` that calls
`cmd.Run()`. Everything else lives below.

### Layer 2 — runtime shell

`internal/cmd/root.go` owns the urfave/cli app lifecycle: `step.Init()`
environment setup, app construction with overridden help/flag formatting,
dispatch to registered commands or plugins, error/panic presentation, and exit
codes. `internal/command/inject.go` bridges urfave/cli actions to
`context.Context`-based actions via middleware. This layer knows about
*commands* only as opaque registered values — it contains no PKI logic.

### Layer 3 — command groups (the user-facing surface)

`command/` contains one package per command group, registered via
`command.Register` in each package's `init()`:

| Group | Responsibility |
| --- | --- |
| `command/ca` | Online CA client operations: init, bootstrap, token, sign/certificate/renew/rekey/revoke, root/federation, ACME, policy, provisioner/admin management (command/ca/ca.go:68-86) |
| `command/certificate` | Local X.509 toolkit: create, sign, inspect, lint, bundle, p12, format, verify, install, fingerprint, needs-renewal |
| `command/crypto` | General crypto toolkit: JWT/JWS/JWE/JWK, OTP, KDF, NaCl, hash, key operations |
| `command/ssh` | SSH certificates: login/logout, sign, renew, rekey, revoke, inspect, config, checkHost, proxycommand |
| `command/oauth` | OAuth 2.0 / OIDC flows |
| `command/context` | Switch between CA "contexts" (command/context/context.go:10-59) |
| `command/api` | Admin API token creation (command/api/token/create.go) |
| `command/crl` | CRL inspect/create |
| Small utilities | `base64`, `completion`, `fileserver` (hidden), `path`, `version`, `beta` |

These packages are intentionally thin: they parse flags, prompt, print, and
delegate to the flow packages below. The contributing guide states the intent —
hierarchy levels live in their own packages, and cross-command functionality
goes into top-level packages like `flags` (command/README.md: "Package Layout",
"Adding a Command").

### Layer 4 — shared engines and flows

The reusable logic that command groups orchestrate:

- **`utils/cautils`** — the CA client flows: `NewTokenFlow`
  (provisioner-dispatched JWT generation), `CertificateFlow` (issuance),
  `OfflineCA` (in-process CA client over a ca.json), bootstrap, and ACME
  challenge flows. This is the heart of the online-CA functionality.
- **`token/`** — the JWT model: claim construction and validation windows
  (`token/token.go:11-52`), claim/header options (`token/options.go`), parsing
  (`token/parse.go`), and the one-time provisioning token wrapper
  (`token/provision/provision.go`).
- **`flags/`** — shared urfave/cli flag definitions (key type/curve/size,
  ca-url, root, kms, notafter, ...) reused across commands
  (`flags/flags.go:23-60`).
- **`internal/`** — internal-only helpers: `cryptoutil` (file-vs-KMS key
  routing), `sshutil` (agent interaction), `kdf`, `crlutil`, `plugin`,
  `command` (context injection), `sliceutil`, `cast`.
- **`utils/`** — small IO/URL helpers (e.g. `CompleteURL`, `Fail` with
  STEPDEBUG awareness, `utils/utils.go:14-61`).
- **`exec/`** — process primitives (exec/replacing child processes, signal
  forwarding, self re-execution).
- **`pkg/bcrypt_pbkdf`** — vendored-in bcrypt PBKDF implementation (SSH key
  support).

Dependency direction is one-way: command groups → flows/utils → external
modules. Flows never import command packages.

## External module boundaries

Three smallstep modules carry most of the domain weight, and the boundary
matters when changing behavior:

- **`github.com/smallstep/cli-utils` (v0.12.2)** — the CLI framework: command
  registration (`command.Register/Retrieve/ActionFunc`), the `step` environment
  (`step.Init`, `step.BasePath`, `step.Contexts`, `step.DefaultsFile`), and the
  UX primitives (`ui`, `errs`, `usage`, `fileutil`). The step CLI repo does not
  vendor it; its internals (e.g. what exactly `step.Init` does) are not
  established in this repository.
- **`github.com/smallstep/certificates` (v0.30.2)** — the step-ca server code
  reused as a library: the HTTP client SDK (`ca.NewClient`, `ca.AdminClient`)
  used by every online command; the `authority/provisioner` types that drive
  token-flow dispatch (`provisioner.JWK`, `OIDC`, `X5C`, `Nebula`, `SSHPOP`,
  `K8sSA`, `GCP`, `AWS`, `Azure`, `ACME`, `SCEP` —
  `utils/cautils/token_flow.go:154-180`); the `pki` package that `step ca init`
  uses to generate a full PKI on disk; and `authority` + `config`, which
  `utils/cautils/offline.go` embeds to sign certificates in-process in offline
  mode (`utils/cautils/offline.go:30-81`). Claim semantics and what the CA
  accepts are owned by that module.
- **`go.step.sm/crypto` (v0.89.0)** — the crypto substrate, the most imported
  smallstep package (pemutil 48 import sites, jose 36, keyutil 19, x509util 14,
  kms 6, plus tpm, minica, fingerprint). Note the two-way contract: the CLI
  injects its own prompter/writer into `pemutil`/`jose` globals at startup
  (`internal/cmd/root.go:96-103`), so crypto-library behavior is partially
  configured by this repo's runtime.

Non-smallstep libraries worth knowing: `urfave/cli` v1.22.17 (the CLI
framework), `smallstep/truststore` (system/browser truststore installation in
`step certificate install` and `bootstrap --install`), `smallstep/certinfo` +
`zlint`/`zcrypto` (rich certificate inspection and linting), `slackhq/nebula`
(nebula certificate support in tokens), `pquerna/otp` (TOTP), and
`rogpeppe/go-internal/testscript` (integration tests).

## State and persistence ownership

- `$STEPPATH` on-disk state (defaults.json, contexts.json, certs, templates) is
  written and read by this repo's commands — see [STEPPATH, defaults.json, and
  contexts](/openwiki/concepts/steppath-and-contexts.md).
- The CA's own database/config belong to the step-ca server, not the CLI. The
  only exception is offline mode, where `OfflineCA` loads a `ca.json` plus
  provisioner keys directly and signs without a network hop
  (`utils/cautils/offline.go:42-81`) — and even then, the CLI is reusing the
  certificates module's authority code rather than owning it.
- Secrets (provisioner keys, passwords) flow through the injected
  pemutil/jose prompting and password-file flags; this repo never persists them
  beyond what a command explicitly writes.

## Cross-cutting runtime concerns

- **Diagnostics**: `STEPDEBUG=1` switches error and panic output to full
  detail; exit codes are 0/1/2 (success/error/panic) — see [Command
  registration, dispatch, and runtime behavior](/openwiki/architecture/command-runtime.md).
- **Interactivity**: commands prompt via cli-utils `ui`; password entry is
  centralized through the startup injection.
- **URLs**: `utils.CompleteURL` normalizes partial CA URLs like
  `ca.smallstep.com:443` into https URLs (`utils/utils.go:28-61`).

## Extension seams

1. **New commands** — register via `command.Register` in a package `init()`,
   blank-import in `internal/cmd/root.go` (see [Change guide: adding a new
   command](/openwiki/guides/add-a-new-command.md)).
2. **New provisioner token flows** — extend the switch in
   `utils/cautils/token_flow.go` and add a generator in
   `token_generator.go` (see [Change guide: adding a provisioner token
   flow](/openwiki/guides/add-a-provisioner-flow.md)).
3. **KMS backends and plugins** — external `step-<name>-plugin` executables
   dispatched by name, plus KMS URIs routed through
   `internal/cryptoutil` (see [KMS URIs, step-kms-plugin, and the plugin
   system](/openwiki/integrations/kms-and-plugins.md)).
4. **CAS interfaces** — enabled by blank-importing the relevant
   `smallstep/certificates/cas/*` package (only cloudcas/softcas/stepcas
   today, `internal/cmd/root.go:25-29`).

## Adjacent non-Go assets

Packaging and operations live at the repo root: `Makefile` and
`.goreleaser.yml` (build/release), `docker/` images, `debian/` metadata,
`systemd/` renewer units (a documented consumer of `step ca renew` daemon
behavior), `powershell/` Windows install scripts, `autocomplete/` shell
completion files, and `scripts/` package hooks. These are covered in
[Build, release, and packaging](/openwiki/operations/build-release-packaging.md).

## Uncertainty

- This page describes the dependency graph as pinned in `go.mod` at this
  commit; behavior of pinned external modules (notably `cli-utils`'s
  environment initialization) is not restated here as fact.
- `make/version.sh` and CI-owned release automation are referenced only at the
  level this repository establishes; secret handling in release workflows is
  not part of the codebase.
