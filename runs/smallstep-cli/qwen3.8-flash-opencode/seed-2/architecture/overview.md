---
type: architecture
title: "System Architecture Overview"
description: "Ownership boundaries and dependency map of the step CLI: thin binary entrypoint, internal/cmd app wiring, command groups, shared flow libraries, and the external smallstep modules and OS/cloud integration surfaces it relies on."
tags: [architecture, modules, dependencies, integration]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-567b7cca98d1eb42c96305c8
    resource: repo://command/ca/admin/admin.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-e0cfffd9e5ebd278d6cab5c2
    resource: repo://command/ca/provisioner/provisioner.go
  - id: openwiki-source-455e13fae8bb72a40c8b6ba6
    resource: repo://command/certificate/install.go
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-82841cd549e6864605e98b9b
    resource: repo://pkg/bcrypt_pbkdf/README
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
  - id: openwiki-source-57d7d8b1ea53edb457db35b8
    resource: repo://utils/cautils/tpm.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# System Architecture Overview

`step` (module `github.com/smallstep/cli`) is a PKI plumbing CLI: it performs X.509/JOSE/SSH crypto operations standalone and acts as the client (and admin console) for the `step-ca` online Certificate Authority, including ACME enrollment. The README's feature map defines the user-facing subsystems: `certificate`, `ca`, `crypto`, `oauth`, and `ssh`, plus plugin extension (`README.md:24-101`).

## Layers in this repository

The tree has a strict downward dependency order:

1. **Binary** — `cmd/step/main.go` is ~30 lines: it declares linker-injected `Version`/`BuildTime`/`AppName` vars, registers them with cli-utils (`step.Set`), sets the CA client `UserAgent` string, and calls `cmd.Run()` (`cmd/step/main.go:10-29`). The `-X "main.Version=..."` ldflags are supplied by the Makefile build rule (see [Build, Packaging, and Release Pipeline](/openwiki/operations/build-and-packaging.md)).
2. **App wiring** — `internal/cmd/root.go` builds the urfave/cli app, enables command packages via blank imports, and centralizes error/exit handling (detailed in [Command Framework and Registration](/openwiki/architecture/command-framework.md)).
3. **Command groups** — `command/<group>/` packages, each self-registering; nested groups (`ca/provisioner`, `ca/acme`, `ca/admin`, `ca/policy`, `crypto/jwt`, …) expose `Command()` accessors (`command/ca/ca.go:68-85`).
4. **Shared behavior libraries** — `flags/` (flag definitions + parsers), `utils/cautils/` (CA client factories, token/certificate/ACME flows, offline CA), `token/` (step's JWT claim vocabulary and provisioner tokens), `exec/` (subprocess execution, signal forwarding, browser opening), and `utils/` (key-size policy from CLI flags, safe file reads) (`utils/cli.go:14-55`, `exec/exec.go:41-127`).
5. **Focused internals** — `internal/` holds private helpers: `internal/cast` (checked integer conversions), `internal/command` (`InjectContext` middleware bridging urfave/cli to Go contexts, `internal/command/inject.go:10-23`), `internal/cryptoutil` (KMS-URI-aware key loading: `PublicKey`, `CreateSigner`, `LoadJSONWebKey`, `CreateAttestor` route between files and KMS/TPM URIs, `internal/cryptoutil/cryptoutil.go:28-177`), `internal/kdf` (scrypt/argon2 PHC handling), `internal/crlutil` (CRL parsing/signature-algorithm naming), `internal/sshutil` (ssh-agent client and certificate inspection), and `internal/plugin` (external plugin resolution).
6. **Vendored upstream code** — `pkg/bcrypt_pbkdf` is a standalone BSD-licensed implementation of OpenBSD's `bcrypt_pbkdf(3)` (`pkg/bcrypt_pbkdf/README:1-3`); no in-tree importer was found by search, so treat it as retained for external consumers.

## What lives outside this repository

Three external modules carry load-bearing logic; the CLI would not build a correct mental model without knowing who owns what:

| Concern | Owner module | Used here via |
|---|---|---|
| Command registry, STEPPATH/contexts, UI prompts, usage templates, error helpers | `github.com/smallstep/cli-utils` | `command.Register/Retrieve`, `step.*`, `ui.*`, `usage.*`, `errs.*` (`internal/cmd/root.go:15-19`) |
| CA HTTP client, ACME client, authority (in-process CA), provisioner types, `pki` bootstrap/config, admin (linkedca) API types | `github.com/smallstep/certificates` | `ca.NewClient`, `ca.AdminClient`, `authority.New`, `provisioner.List`, `pki.GetRootCAPath` (`utils/cautils/client.go:29-48`, `utils/cautils/offline.go:16-19`) |
| Keys, JOSE (jose), PEM I/O (pemutil), key/x509 generation helpers (keyutil/x509util), KMS + TPM URI packages | `go.step.sm/crypto` | throughout; the CLI installs write/prompt hooks into it (`internal/cmd/root.go:22-23`) |

Module internals (e.g. how `step.Init()` applies context env vars or how `ca.Client` speaks HTTP) are **not** in this tree; claims about them elsewhere in this wiki cite this repo's call sites, not assumed behavior.

## Integration surfaces

- **step-ca REST + admin APIs.** All `step ca`/`step ssh` online flows go through the `certificates/ca` client with a pinned root file; `step ca provisioner/admin/policy` commands use `ca.AdminClient` and `linkedca` protobuf types for CA management operations, including hosted deployments (`command/ca/admin/admin.go:12`, `command/ca/provisioner/provisioner.go`).
- **ACME.** `step ca acme` (also exposed under `step beta ca`) and ACME-backed cert enrollment live in `command/ca/acme` and `utils/cautils/acmeutils.go`; `--eab-key-id/--eab-key-reference` flags support external account binding (`flags/flags.go:455-470`, `command/ca/acme/eab/eab.go`). ACME device-attestation challenges are answered with TPMs using `google/go-tpm` and `smallstep/go-attestation` plus CBOR encoding (`utils/cautils/tpm.go:25-41`).
- **Offline signing.** With `--offline`, `cautils.NewOfflineCA` instantiates the full `certificates/authority` from a `ca.json` config in-process — the CLI embeds a CA rather than talking HTTP — guarded by a package-level singleton because double initialization can deadlock on backends like BadgerDB (`utils/cautils/offline.go:27-80`, `utils/cautils/client.go:52-59`).
- **OS trust stores.** `step certificate install` and `step ca bootstrap --install` write into the platform trust store via `smallstep/truststore` (`command/certificate/install.go`, `utils/cautils/bootstrap.go:212-219`).
- **SSH agent.** `internal/sshutil` talks to the local agent over `SSH_AUTH_SOCK` (unix/named-pipe variants) to add, list, and use certificates during `step ssh login`/`proxycommand` (`internal/sshutil/agent.go`, `internal/sshutil/pipe.go`).
- **OAuth/OIDC providers.** `step oauth` implements authorization-code, device, OOB, and JWT-bearer grants; its tokens feed OIDC provisioners in the CA token flow (`command/oauth/cmd.go:60-104`, `utils/cautils/token_generator.go:144-181`).
- **KMS/HSM/TPM keys.** Key material arguments accept KMS URIs resolved through `internal/cryptoutil` and `go.step.sm/crypto/kms`, and the deeper KMS surface is provided out-of-process by the `step-kms-plugin` binary discovered by `internal/plugin` (`flags/flags.go:466-475`, `internal/plugin/plugin.go:74-82`).

## Failure-handling shape

Two distinct failure planes exist. Within a command, errors bubble to `run()` and follow the `STEPDEBUG`/exit-code contract described in [Command Framework and Registration](/openwiki/architecture/command-framework.md). When the CLI spawns children — plugins, browsers, `ssh`, renew `--exec` hooks — `exec.Run`/`exec.Exec` forward all signals to the child, then mirror its exit status, so child failure becomes step's failure (`exec/exec.go:56-69`, `exec/exec.go:199-218`).

## See also

- [Command Framework and Registration](/openwiki/architecture/command-framework.md) — the dispatch mechanism in depth
- [Configuration, STEPPATH, and Contexts](/openwiki/architecture/configuration-and-steppath.md) — persistent state
- [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md) — the central online flow
