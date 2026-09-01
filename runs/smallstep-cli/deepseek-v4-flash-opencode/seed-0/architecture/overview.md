---
type: "Reference"
title: "Architecture Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-a148da75eb7742358a4e5571
    resource: repo://command/fileserver/fileserver.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-02cba02a31978f84a900def3
    resource: repo://internal/crlutil/crlutil.go
  - id: openwiki-source-43f82bca17775bc861344237
    resource: repo://internal/kdf/kdf.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
  - id: openwiki-source-df2d16b29c2bbf9191277bfd
    resource: repo://utils/read.go
  - id: openwiki-source-90c79f73277cd4b004ddf996
    resource: repo://utils/utils.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---


# Architecture Overview

The `step` CLI (module `github.com/smallstep/cli`) is a Go command-line tool
for building, operating, and automating PKI systems. It is both a general
X.509/crypto toolkit and a client for the `step-ca` online Certificate
Authority. See the [Quickstart](../quickstart.md) for how to build it and for
common workflows; this page covers the layout, ownership boundaries, and the
core control flow.

## Ownership boundaries

The codebase is split into these responsibility areas:

- **`cmd/step/`** — the binary entrypoint. `main.go` records build-time
  version metadata and calls into `internal/cmd`.
- **`internal/cmd/`** — the `urfave/cli` application assembly, the command
  registry wiring, the root `run()` error handling, and the panic handler. It
  is the only place the full command tree is pulled together.
- **`command/`** — one package per top-level command group (`ca`,
  `certificate`, `ssh`, `crypto`, `oauth`, `context`, `crl`, `api`, plus
  smaller single commands). Each package owns its subcommands and registers
  itself; no other package depends on these groups.
- **`flags/`** — shared `urfave/cli` flag definitions and flag parsing helpers
  reused across command groups.
- **`utils/`** — generic helpers (key details, URL completion, file/stdin
  reading, platform syscall wrappers).
- **`utils/cautils/`** — the CA-facing layer: the `CaClient` abstraction, the
  online/offline client constructors, the certificate/token/ACME flows, the
  offline CA, bootstrap, and TPM support. This is the seam between command
  actions and step-ca.
- **`token/`** — provisioning-token (JWT) claims, signing, parsing, and
  token-type detection.
- **`internal/`** — cross-cutting internal helpers: the CLI root
  (`internal/cmd`), plugin discovery (`internal/plugin`), SSH agent helpers
  (`internal/sshutil`), CRL construction (`internal/crlutil`), KDFs
  (`internal/kdf`), and small cast/slice utilities.
- **`exec/`** — process execution helpers (execve wrapper, signal-forwarding
  subprocess runner, browser opening).
- **Packaging assets** — `autocomplete/`, `powershell/`, `systemd/`,
  `debian/`, `docker/`, `scripts/` and `make/` support building, releasing,
  and installing `step` on various platforms.

## Entrypoint and command tree

The process entrypoint is `cmd/step/main.go`, which calls `cmd.Run()` from
`internal/cmd/root.go`. `root.go` builds the `urfave/cli` application by
pulling every registered command with `command.Retrieve()` from the external
`github.com/smallstep/cli-utils/command` registry.

The exposed top-level command groups are: `api`, `base64`, `beta`, `ca`,
`certificate`, `completion`, `context`, `crl`, `crypto`, `fileserver`
(hidden), `oauth`, `path`, `ssh`, and `version`.

- **`step ca`** — initialize and manage a CA: init, bootstrap, token,
  certificate, renew, revoke, rekey, root, roots, federation, health, sign,
  provisioner, admin, policy, acme. See [The step ca Command Group](../commands/ca-group.md).
- **`step certificate`** — X.509 tools: create, sign, inspect, verify, lint,
  bundle, fingerprint, needsRenewal, format, key, install/uninstall, p12. See
  [The step certificate Command Group](../commands/certificate-group.md).
- **`step ssh`** — SSH certificate workflows. See
  [The step ssh Command Group](../commands/ssh-group.md).
- **`step crypto`** and **`step oauth`** — crypto plumbing and OAuth/OIDC.
  See [The step crypto Command Group and step oauth](../commands/crypto-and-oauth.md).
- **`step context`**, **`step path`** — manage `$STEPPATH`, contexts,
  profiles. See [STEPPATH, Configuration, and Contexts](step-path-and-contexts.md).
- **`step crl`** — generate and inspect certificate revocation lists.
- **`step api token`** — mint tokens against the step-ca HTTP API.
- **`step completion`**, **`step base64`**, **`step version`**, **`step beta`**,
  **`step fileserver`** (hidden) — small utility commands.

## Core control flow

Most non-trivial commands follow the same pattern:

1. `cmd/step/main.go` → `internal/cmd/root.go#run` → `newApp` →
   `app.Run(os.Args)`; `urfave/cli` dispatches to the matched command action.
2. The action parses arguments and flags (using `flags/` helpers), then routes
   through `utils/cautils`. `NewClient` or `NewCertificateFlow` decide between
   an **online** step-ca (`ca.NewClient` against the CA URL) and the
   **offline** mode (an `OfflineCA` embedded authority configured from a local
   `ca.json`).
3. For issuance, a one-time provisioning token is produced — either by the
   online token flow (selecting a provisioner such as JWK, OIDC, X5C, SSHPOP,
   Nebula, K8sSA, GCP, AWS, Azure and minting the appropriate JWT) or locally
   by the offline CA.
4. The certificate/SSH request is signed by the CA (over HTTPS for an online
   CA, or by the embedded authority offline) and the resulting certificates
   and keys are written to disk, typically with restrictive permissions.
5. ACME- and bootstrap-based commands follow their own flows; see
   [ACME and Bootstrap Flows](../ca/acme-and-bootstrap.md).

## External integrations

- **`github.com/smallstep/certificates` (step-ca)** — provides the online CA
  client (`ca.NewClient`, `ca.NewAdminClient`), the `pki`, `api`,
  `provisioner`, and `authority` packages used by `utils/cautils`, and the
  offline authority embedded by `OfflineCA`. The CAS backends (`cloudcas`,
  `softcas`, `stepcas`) are enabled via blank imports in `root.go`.
- **`github.com/smallstep/cli-utils`** — command registry (`command`), step
  environment/path (`step`), UI prompts (`ui`), error constructors (`errs`),
  and file helpers (`fileutil`, `usage`).
- **`go.step.sm/crypto`** — JOSE/JWT, key generation, PEM utilities, X.509
  helpers, KMS and TPM backends, fingerprints, and random utilities.
- **KMS backends** — YubiKey PIV (`yubikey:`), PKCS#11 (`pkcs11:`), TPM
  (`tpmkms:`), Google Cloud KMS (`cloudkms:`), AWS KMS (`awskms:`), and Azure
  Key Vault (`azurekms:`) are configured through the `--kms` URI flag.
- **Cloud identity providers** — GCP, AWS, and Azure instance identity and
  Kubernetes service-account tokens authenticate directly to step-ca.
- **OAuth/OIDC providers** — `step oauth` speaks OAuth 2.0 / OIDC with
  Google, GitHub, or any provider exposing an OIDC discovery document.
- **ACME** — `step` acts as an ACME client (RFC 8555) using `http-01`
  challenge validation in standalone or webroot modes.
- **SSH agent** — `step ssh` reads and writes keys/certificates through the
  SSH agent protocol (`internal/sshutil`).

## Configuration and persistence

`step` persists configuration and certificates under `$STEPPATH` (default
`$HOME/.step`): root certificates, `config/ca.json` and `config/defaults.json`,
contexts, profiles, and provisioner keys. The layout is described in
[STEPPATH, Configuration, and Contexts](step-path-and-contexts.md).

## Failure handling

Errors are surfaced through `internal/cmd/root.go#run`: messenger errors print
their message, `STEPDEBUG=1` prints full error stacks, and panics are caught
by a handler that exits with code 2. See
[Command Framework, Plugins, and Error Handling](command-and-error-handling.md).
