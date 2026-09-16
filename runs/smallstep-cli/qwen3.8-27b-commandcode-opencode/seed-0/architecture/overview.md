---
type: architecture
title: "Architecture Overview"
description: "Map of the step CLI repository: the cmd/step entrypoint, the internal/cmd app bootstrap, top-level package ownership (command, flags, token, utils, internal, exec, pkg), and the external libraries the CLI is built on."
tags: [architecture, packages, ownership, dependencies, entrypoint]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-1b3b612bc0aec13f4edefe60
    resource: repo://.VERSION
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-89561342b10ee9b0dec2b2c5
    resource: repo://command/ca/provisioner/caConfigClient.go
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-4658661d824001e81c8b5758
    resource: repo://pkg/bcrypt_pbkdf/bcrypt_pbkdf.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

The `step` binary is Smallstep's command-line client for building and operating PKI: it creates offline PKIs, acts as a client for the `step-ca` online certificate authority (X.509 and SSH), implements OAuth 2.0/OIDC flows at the command line, and ships a general-purpose crypto toolkit (`README.md:12-14`). This page maps where each concern lives.

## Entrypoint and bootstrap

- `cmd/step/main.go` is the only `main` package. It holds ldflag-set `Version`/`BuildTime`/`AppName` variables and delegates to `internal/cmd` (`cmd/step/main.go:10-29`).
- `internal/cmd/root.go` builds the urfave/cli application, registers global overrides, and contains the authoritative blank-import list that enables every command group. See the [Command Framework and Lifecycle](/openwiki/architecture/command-lifecycle.md) page for the full call path and registration model.

## Top-level package map

| Path | Ownership |
|---|---|
| `cmd/step/` | Binary entrypoint (version variables, `main`). |
| `command/` | Every user-facing command group: `ca`, `certificate`, `crypto`, `oauth`, `ssh`, `context`, `crl`, `api`, `beta`, `base64`, `completion`, `fileserver`, `path`, `version`. Each group is its own package that registers via `init()`; group-specific subcommands nest in subpackages (e.g., `command/ca/provisioner`, `command/crypto/jwt`). |
| `flags/` | Shared `cli.Flag` definitions (`flags/flags.go`) plus parsing helpers (`ParseCaURL`, `ParseTimeDuration`, `ParseFingerprintFormat`, `GetTemplateData`, `FirstStringOf`). Used by nearly every command. |
| `token/` | One-time provisioning token JWTs: claims/options (`token/options.go`), signing with generated `kid` (`token/token.go`), parsing and payload type detection for JWK/OIDC/GCP/AWS/Azure/K8sSA (`token/parse.go`), and `token/provision` for CA-side one-time tokens. |
| `utils/` | Small shared helpers: `read.go` (file/STDIN reading, `FileExists`), `cli.go` (`GetKeyDetailsFromCLI` for `--kty/--curve/--size`), `utils.go` (`Fail`, `CompleteURL`). |
| `utils/cautils/` | The central CA glue layer: client construction (`client.go`), token flow (`token_flow.go`), certificate flow (`certificate_flow.go`), bootstrap (`bootstrap.go`), the offline CA wrapper (`offline.go`), ACME flow (`acme_flow.go`, `acmeutils.go`), TPM support (`tpm.go`), and token generators (`token_generator.go`). |
| `utils/sysutils/` | Platform primitives: file locking (`Flock`), `Kill`, `Exec` (execve wrapper), with Unix/Windows variants. |
| `internal/` | Unexported infrastructure: `cmd` (app bootstrap), `plugin` (plugin dispatch), `cryptoutil` (KMS-aware key loading/attestation), `sshutil` (SSH signer/cert helpers, agent, shell config), `crlutil` (CRL parse/inspect/JSON), `kdf` (scrypt/bcrypt/argon2 KDF implementations), `cast`, `sliceutil`, `command` (context middleware injection into actions). |
| `exec/` | Process execution wrappers: `Exec` (execve), `Run`/`RunWithPid` (with signal forwarding and exit-code propagation), `OpenInBrowser`, `Step` (re-invoke `step` and capture stdout), `IsWSL`. |
| `pkg/bcrypt_pbkdf/` | Vendored BSD-licensed `bcrypt_pbkdf` implementation (OpenBSD-compatible PBKDF) with its own LICENSE/README; it has no in-repo importers in the current tree. |
| `integration/` | testscript-based end-to-end tests plus `testdata`. |
| `make/`, `scripts/`, `debian/`, `docker/`, `systemd/`, `powershell/`, `autocomplete/` | Build and packaging assets (see [Build, Release, and Packaging](/openwiki/build-and-release.md)). |
| `docs/` | Contributor and local-development docs. |

## Layering and dependency direction

The practical dependency flow is:

```
cmd/step -> internal/cmd -> command/<group> -> utils/cautils, flags, token
                                            -> internal/{cryptoutil,sshutil,crlutil,...}
                                            -> exec
```

- Command packages contain CLI definitions and action logic; shared mechanisms live in `flags`, `utils`, `token`, and `internal/*` so commands stay thin (`command/README.md` documents this layout rule).
- `utils/cautils` is the seam between the CLI and the `smallstep/certificates` library: commands never build HTTP clients or parse CA API types directly — they call `cautils.NewClient`/`NewCertificateFlow`/`NewTokenFlow`/`NewOfflineCA`, which return a `CaClient` interface (`utils/cautils/client.go:29-48`) implemented either by the online `ca.Client` (from `smallstep/certificates/ca`) or the local `OfflineCA` (`utils/cautils/offline.go:30-34`).
- `token` is consumed by both command actions (parsing `--token` values) and `cautils` (generating tokens per provisioner type).

## External libraries the CLI stands on

From `go.mod` (module `github.com/smallstep/cli`, Go 1.25.8):

- **`github.com/smallstep/certificates`** — the step-ca server library, used client-side for the `api` request/response types, `authority` (powers `OfflineCA` and the `ca.json` admin fallback), `provisioner` types, `ca`/`ca.AdminClient` HTTP clients, `pki` path helpers, and the `cas` registration authorities (StepCAS/CloudCAS/softcas) blank-imported in `internal/cmd/root.go`.
- **`go.step.sm/crypto`** — the crypto library: `jose` (JWT/JWK/JWE, signing, prompt hooks), `pemutil` (PEM read/write, `WriteFile` and `PromptPassword` hooks set in `internal/cmd/root.go:96-103`), `keyutil`, `kms` (cloud/HSM key managers, blank-imported e.g. `azurekms` in `command/ca/init.go`), `x509util`, `fingerprint`.
- **`github.com/smallstep/cli-utils`** — CLI framework glue: `command.Register`/`command.Retrieve`, `errs` (error types that become proper exit codes), `step` (STEPPATH, defaults/contexts environment, `step.Init()`), `ui` (prompts/selection), `usage` (help templates), `fileutil`.
- **`github.com/smallstep/linkedca`** — shared Admin API data types (`Provisioner`, `Admin`, `EABKey`, `Policy`) used by the `step ca provisioner|admin|policy|acme eab` commands.
- **`github.com/smallstep/truststore`** — system/browser trust store install used by bootstrap and `step certificate install`.
- **`github.com/urfave/cli` (v1)** — the command-line framework.
- Notable others: `golang.org/x/crypto` (SSH), `github.com/pquerna/otp` (TOTP), `github.com/slackhq/nebula` (nebula header tokens), `github.com/manifoldco/promptui` (interactive prompts in `step ca init`).

## What the repository does not establish

- Deployment topology, hosting, or service-operation behavior of a `step-ca` server beyond what these client-side commands exercise; this repo is the CLI, not the CA.
- The contents of `$(step path)` defaults are owned by cli-utils; this repository references paths like `step.Path()`, `step.BasePath()`, `pki.GetRootCAPath()` without redefining them (see [Configuration, State Files, and Flags](/openwiki/configuration-and-state.md)).

## Versioning

`make/version.sh` and the Makefile derive `VERSION` from `GITHUB_REF`, `git describe`, or the `.VERSION` slug (a `git archive` placeholder `$Format:%d$` in the working tree). The Makefile and GoReleaser inject it into `main.Version`/`main.BuildTime` via ldflags; `step version` and `ca.UserAgent` surface it at runtime.
