---
type: architecture-overview
title: Architecture Overview
description: Repository identity, dependency structure, and the ownership boundaries between step-cli's packages and the Smallstep libraries it builds on.
tags: [architecture, overview, dependencies, packages, pki]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-fe5b002eb6bab88c8a9f5a2c
    resource: repo://systemd/cert-renewer%40.service
  - id: openwiki-source-c2a1cbcd354ea6d2d5d35e69
    resource: repo://systemd/README.md
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# Architecture Overview

## What this repository is

This module is `github.com/smallstep/cli`, the `step` CLI: a command-line tool
for building, operating, and automating PKI systems, and the client for the
`step-ca` online Certificate Authority. It covers X.509 certificates, JOSE
(JWT/JWS/JWE/JWK), SSH certificates, OAuth/OIDC single sign-on, and general
crypto plumbing (repo://README.md#L12-L70).

## Build identity and entrypoint

- Module path and Go version come from `go.mod` (`github.com/smallstep/cli`,
  Go 1.25.8) (repo://go.mod).
- The single binary is built from `cmd/step/main.go`, whose `main` only calls
  `cmd.Run()`; version metadata is injected via LDFLAGS (repo://cmd/step/main.go#L10-L29).
- `make build` compiles exactly that package with `CGO_ENABLED=0` by default,
  producing `bin/step`; GoReleaser builds the release artifacts from the same
  `main: ./cmd/step` target (repo://Makefile#L123-L143, repo://.goreleaser.yml).

## Ownership boundaries: this repo vs. Smallstep libraries

The repository deliberately keeps its own code thin and pushes crypto and CA
semantics into versioned libraries (repo://go.mod, repo://README.md#L12-L14):

| Concern | Owner library | Used for |
| --- | --- | --- |
| Authority, signing, provisioners | `github.com/smallstep/certificates` | CA clients (`ca`, `AdminClient`), the embedded offline `authority.Authority`, provisioner types, `pki` helpers |
| Crypto primitives | `go.step.sm/crypto` | `jose`, `pemutil`, `kms`, `keyutil`, `x509util`, `randutil`, `fingerprint` |
| CLI framework utilities | `github.com/smallstep/cli-utils` | `command` registry, `errs`, `ui`, `usage`, `fileutil`, `step` (environment/contexts) |
| Specialized packages | `smallstep/truststore`, `smallstep/certinfo`, `smallstep/zlint`, `smallstep/linkedca`, `slackhq/nebula`, `google/go-tpm` | trust-store install, certificate inspection/linting, linkedca API, Nebula certs, TPM attestation |

What lives in *this* repository:

1. **Command definitions** — the entire `command/` tree (`ca`, `certificate`,
   `crypto` with JOSE/nacl/otp/kdf/hash subgroups, `ssh`, `oauth`, `context`,
   `api`, `beta`, `crl`, `completion`, `fileserver`, `path`, `base64`,
   `version`), registered through `command.Register` on package init
   (repo://command/README.md#L24-L62, repo://internal/cmd/root.go#L25-L44).
2. **CA client flows** — `utils/cautils` implements the CLI-side flows: token
   generation per provisioner type, online/offline client selection, bootstrap,
   ACME flow, certificate flow, and TPM token support (repo://utils/cautils/client.go#L29-L74,
   repo://utils/cautils/token_flow.go#L100-L183).
3. **Token construction** — the `token` package builds and parses the JWTs that
   authenticate requests to step-ca (repo://token/token.go#L11-L45).
4. **Framework glue** — `internal/cmd` (app assembly), `flags` (shared flag
   definitions and validation), `exec` (process re-exec helpers), and
   `internal/plugin` (plugin dispatch) (repo://internal/cmd/root.go#L46-L154,
   repo://internal/plugin/plugin.go#L20-L82).
5. **Internal utilities** — `internal/cryptoutil` (file-vs-KMS key resolution),
   `internal/sshutil` (agent, pipes, shells), `internal/kdf` (argon2/scrypt with
   PHC formatting), `internal/crlutil`, `internal/cast`, `internal/sliceutil`
   (repo://internal/cryptoutil/cryptoutil.go#L26-L87, repo://internal/sshutil/agent.go,
   repo://internal/kdf/kdf.go).
6. **Vendored-via-module extras** — `pkg/bcrypt_pbkdf` is a local package
   implementing the bcrypt_pbkdf KDF used for OpenSSH key compatibility
   (repo://pkg/bcrypt_pbkdf/bcrypt_pbkdf.go).

## How the major systems fit together

- **CLI bootstrap** wires the urfave/cli app, injects prompters/writers into
  library globals, and registers all commands via blank imports
  (repo://internal/cmd/root.go#L25-L154).
- **CA flows** (`utils/cautils`) sit between commands and the
  `smallstep/certificates` clients. `CaClient` is the interface both the online
  `ca.Client` and the offline `OfflineCA` (which embeds the full authority) satisfy,
  so `step ca certificate/renew/revoke/...` work against either backend
  (repo://utils/cautils/client.go#L29-L74, repo://utils/cautils/offline.go#L28-L81).
- **Token layer**: commands obtain single-use JWTs via `NewTokenFlow`, which
  fetches the authority's provisioner list and dispatches on provisioner type;
  the offline variant derives audiences from the local `ca.json` instead
  (repo://utils/cautils/token_flow.go#L100-L183, repo://utils/cautils/offline.go#L538-L599).
- **State** persists under `$STEPPATH`: `defaults.json`, `certs/root_ca.crt`,
  and `contexts.json` for multi-authority contexts, written by the bootstrap and
  context commands (repo://utils/cautils/bootstrap.go#L145-L210,
  repo://command/context/context.go).
- **Integrations**: KMS/HSM operations are delegated to `step-kms-plugin` via
  the plugin convention; OAuth/OIDC provisioners re-enter the CLI as `step oauth`;
  systemd units drive certificate renewal from `step certificate needs-renewal`
  and `step ca renew` (repo://internal/cryptoutil/cryptoutil.go#L89-L120,
  repo://exec/exec.go#L130-L149, repo://systemd/cert-renewer@.service).

## Non-obvious structural facts

- `internal/` packages are CLI-internal but several (`cryptoutil`, `sshutil`,
  `crlutil`) are the real implementation engines behind user-facing commands.
- The offline CA is a process-wide singleton because double-initializing the
  embedded authority can fail on locks (e.g. badgerDB); `NewOfflineCA` returns
  the existing instance when present (repo://utils/cautils/offline.go#L36-L45).
- The CLI blank-imports the CAS interfaces (`cloudcas`, `softcas`, `stepcas`)
  from `smallstep/certificates` so their `init()` side effects register the
  implementations before any command runs (repo://internal/cmd/root.go#L25-L29).
- Distribution artifacts (Docker, Debian, PowerShell installer, shell
  autocomplete, package repos) are generated outside the Go code from the
  `.goreleaser.yml` pipeline and `docker/`, `debian/`, `powershell/`,
  `autocomplete/`, and `scripts/` assets (repo://.goreleaser.yml).

## Uncertainty

The repository does not document any runtime daemon behavior — `step` is a
short-lived CLI process; long-running behavior (renewal loops) is delegated to
external schedulers such as systemd timers (repo://systemd/README.md).
