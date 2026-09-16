---
type: "Reference"
title: "Repository Architecture and Ownership"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
sources:
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-09-14T13:44:47.469Z" }
---

# Repository Architecture and Ownership

This repository is the **Smallstep CLI**: the `step` binary, described in `README.md` as
"an easy-to-use CLI tool for building, operating, and automating Public Key Infrastructure
(PKI) systems and workflows" that is "also a client for the `step-ca` online Certificate
Authority (CA) server". The Go module is `github.com/smallstep/cli` (Go `1.25.8` per
`go.mod`).

## Module layout and ownership

| Path | Responsibility |
| --- | --- |
| `cmd/step/` | The `main` package; sets build-time version vars and calls the app entry point. |
| `internal/cmd/` | App wiring: `run()`, `newApp`, panic handling, blank imports that enable command groups and CAS backends. |
| `command/` | All `urfave/cli` command groups; one package per hierarchy level (e.g. `command/ca/provisioner/`, `command/crypto/jwk/`). |
| `internal/` | Private helpers not part of the public API: `cast` (type casting), `cmd`, `command` (context injection), `crlutil` (CRL parsing/printing), `cryptoutil` (key/KMS URI handling), `kdf` (Scrypt/Bcrypt/Argon2), `plugin` (`step-*-plugin` lookup/execution), `sliceutil`, `sshutil` (SSH keys, agents, signers). |
| `utils/` | Shared client library used by many commands: `cautils` (CA clients and request flows), plus `cli.go`, `read.go` (stdin/file input), `sysutils`, `utils.go`. |
| `flags/` | Flag definitions shared across commands (CA connection, provisioner/admin auth, key material, time bounds). |
| `token/` | One-time JWT token building/parsing (`token.go`, `parse.go`, `options.go`) and `token/provision/` (cloud identity provision tokens). |
| `pkg/bcrypt_pbkdf/` | Public Go package for bcrypt_pbkdf. |
| `integration/` | End-to-end tests that build the binary and drive it (`main_test.go`, `certificate_test.go`, `crypto_test.go`, `help_test.go`). |
| `systemd/`, `docker/`, `debian/`, `powershell/`, `scripts/`, `autocomplete/` | Distribution and operational artifacts (see [Distribution, Renewal, and Operational Integration](/openwiki/operations/distribution-and-renewal.md)). |
| `docs/`, `Makefile`, `CHANGELOG.md` | Contribution docs, build system, and changelog. |

`command/README.md` codifies the ownership boundary: each level of the command hierarchy
lives in its own package under `command/`, and any package used by a command but without
command-specific business logic belongs at the repository top level (examples given:
`flags/` and the external `cli-utils/errs`).

## Key external dependencies

Direct requirements from `go.mod` (select versions):

- `github.com/urfave/cli v1.22.17` — the CLI framework (v1 API).
- `github.com/smallstep/certificates v0.30.2` — the `step-ca` codebase; provides the API
  types, the ACME client, and the embedded `authority.Authority` for offline mode.
- `github.com/smallstep/cli-utils v0.12.2` — shared CLI environment: `step.Init`,
  contexts, `command.Register`/`Retrieve`, `ui`, `errs`, `usage`.
- `github.com/smallstep/linkedca v0.26.0` — the admin client for `step ca admin`.
- `go.step.sm/crypto v0.89.0` — core crypto library (JWK/JWS/JWE, pemutil, x509util, KMS).
- Notable others: `smallstep/truststore v0.13.0` (OS trust stores),
  `smallstep/go-attestation` + `google/go-tpm` (TPM device attestation),
  `slackhq/nebula` (Nebula provisioner tokens), `pquerna/otp` (OTP), `go.step.sm/zlint`
  and `zcrypto` (certificate linting), `software.sslmate.com/src/go-pkcs12` (P12).

## Two operating modes

The CLI operates either against a remote CA or with an embedded offline CA; selection is
centralized in `utils/cautils/client.go` `NewClient`, which reads the `offline` and
`ca-config` flags (plus `ca-url` and `root`):

- **Online**: a `CaClient` over the `step-ca` HTTPS API (sign, renew, rekey, revoke, SSH
  variants, version, roots). Commands obtain one via `NewClient`/`NewCaClient`.
- **Offline**: `utils/cautils/offline.go` `NewOfflineCA` loads a CA configuration file
  (`--ca-config`) and constructs `authority.New(&cfg)` from `smallstep/certificates`,
  returning an `OfflineCA` that implements the same client interface in-process (its
  `Sign` calls `authority.Authorize` + `authority.SignWithContext`; `Renew` calls
  `authority.Renew`). The required CAS backends for this mode are enabled by blank imports
  in `internal/cmd/root.go`.

Commands that work in both modes (e.g. `step certificate create --offline`,
`step ca certificate --offline`) branch on these flags; the flow logic itself lives in
`utils/cautils` (see [CA Clients and Certificate Request Flows](/openwiki/ca-integration/ca-client-and-flows.md)).

## Where behavior lives

- **Command surface** (`command/*`): argument/flag validation, UX (prompts, output), and
  orchestration. Business logic is deliberately kept out of command packages.
- **Client library** (`utils/cautils`): CA client interface and construction, certificate
  request flows, token flows, ACME/TPM flows, bootstrap, offline CA.
- **Crypto and format work**: delegated to `go.step.sm/crypto` and friends; local helpers
  in `internal/cryptoutil`, `internal/kdf`, `internal/crlutil`.
- **Environment and contexts**: `cli-utils` (`step.Init`, `step.Contexts`) backed by files
  under `$STEPPATH` (see [Configuration, Contexts, and Environment](/openwiki/configuration/environment.md)).
- **App lifecycle and registration**: `internal/cmd/root.go` (see
  [Command Framework and Application Lifecycle](/openwiki/architecture/command-framework.md)).

## Related

- [Command Framework and Application Lifecycle](/openwiki/architecture/command-framework.md)
- [Configuration, Contexts, and Environment](/openwiki/configuration/environment.md)
- [Build, Test, and Change Guides](/openwiki/development/build-test-and-change-guides.md)
