---
type: architecture
title: Architecture Overview
description: The step CLI's binary surface, module layout, and package ownership boundaries — where commands, shared flags, token logic, CA flows, and cross-cutting helpers live.
tags: [architecture, packages, cli, go]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-c24853a4005579209b2246f3
    resource: repo://autocomplete/README.md
  - id: openwiki-source-531f7a4638bb6c96bc20c64d
    resource: repo://command/beta/beta.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-7f1ca00753e95588bc8efa39
    resource: repo://docker/Dockerfile
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-362b503187f3ead50d917bf1
    resource: repo://internal/cmd/root_test.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-43f82bca17775bc861344237
    resource: repo://internal/kdf/kdf.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-876dd76a7d08abaa279d8607
    resource: repo://internal/sshutil/sshutil.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-4658661d824001e81c8b5758
    resource: repo://pkg/bcrypt_pbkdf/bcrypt_pbkdf.go
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-c2a1cbcd354ea6d2d5d35e69
    resource: repo://systemd/README.md
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# Architecture Overview

## What this repository is

This module is `github.com/smallstep/cli` (Go, minimum version 1.25.8). It
produces the `step` binary: a command-line toolkit for building, operating, and
automating PKI workflows, and the primary client for the `step-ca` online
Certificate Authority (`github.com/smallstep/certificates`, imported as a
library). The README positions `step` both as a standalone X.509/JOSE/SSH
crypto toolkit and as the client for `step-ca` and ACMEv2 servers.

## The binary surface

The top-level command set is pinned by `internal/cmd/root_test.go`: `help`,
`api`, `base64`, `fileserver`, `path`, `certificate`, `completion`, `context`,
`crl`, `crypto`, `oauth`, `version`, `ca`, `beta`, `ssh`. Two of them are
hidden (`api`, `fileserver`), and `beta` is a stable-name wrapper that simply
re-exports `ca.BetaCommand()` for in-development APIs.

Conceptually the surface divides into:

- **PKI client commands** (`step ca ...`): bootstrap, init, certificate, sign,
  renew, rekey, revoke, token, health, root, federation, plus admin, policy,
  provisioner, and ACME administration subgroups.
- **Local certificate tooling** (`step certificate ...`, `step crl ...`):
  create, sign, bundle, inspect, lint, verify, fingerprint, format, install,
  p12, needs-renewal, and CRL inspection.
- **Generic crypto toolkit** (`step crypto ...`): JOSE (jwt/jws/jwe/jwk), otp,
  kdf, nacl, hash, rand, key, and change-pass.
- **SSH certificate lifecycle** (`step ssh ...`): certificate, login/logout,
  config, check-host, hosts, proxycommand, and renewal operations.
- **Identity** (`step oauth`): OAuth2/OIDC single sign-on flows.
- **Plumbing**: `path`, `context`, `completion`, `version`, `base64`,
  `fileserver`, `beta`, and the hidden `api` group for Smallstep API tokens.

## Module layout and ownership boundaries

| Path | Ownership |
| --- | --- |
| `cmd/step` | Binary entry point; sets version/user-agent and calls `cmd.Run()`. No business logic. |
| `internal/cmd` | Assembles the `urfave/cli` app: framework overrides, command set, fallback dispatch, exit codes. |
| `command/` | One package per command group (`ca`, `certificate`, `crypto`, `ssh`, `oauth`, ...). Each package defines its `cli.Command` tree and registers it via `command.Register` in `init()`. This is where command behavior lives. |
| `flags/` | Shared, reusable `cli.Flag` definitions (key type/curve/size, CA URL/root, password-file, offline, KMS URI, force, etc.) so flags stay consistent across commands. |
| `token/` | Creation and parsing of step CA JWT tokens: default claims, validity bounds, token options, and the `provision` helper. |
| `utils/` | Cross-command helpers: `cautils` (the end-to-end CA flows — bootstrap, token flow, certificate flow, offline CA, ACME, TPM), `sysutils` (PID/signal handling), reading utilities (`read.go`), CLI key-parameter validation (`cli.go`), and `CompleteURL`/`Fail`. |
| `internal/` | Unexported cross-cutting helpers: `cmd` (app assembly), `command` (context injection middleware), `cryptoutil` (file/KMS signer and public-key abstraction), `plugin` (plugin discovery/exec), `sshutil` (SSH agent, piping, inspection), `kdf` (argon2/scrypt PHC formatting), `crlutil`, `sliceutil`, `cast`. |
| `pkg/` | Exported leaf package: `bcrypt_pbkdf`, the bcrypt-based KDF used for SSH private key encryption. |
| `exec/` | Process execution helpers used by commands (e.g. opening browsers, WSL detection). |
| `integration/` | End-to-end tests driven by `rogpeppe/go-internal/testscript` `.txtar` scripts. |

Support directories are non-Go: `docker/` (Dockerfiles), `debian/` (packaging
metadata), `systemd/` (cert-renewer units), `powershell/`, `autocomplete/`
(shell completion scripts), `scripts/` and `make/` (release helpers),
`.github/workflows` (CI/release automation), and `docs/` (contributor
documentation).

## External pillars

Three library families carry most of the heavy lifting, all declared in
`go.mod`:

- **`github.com/smallstep/certificates`** — the step-ca client library
  (`ca.NewClient`, `ca.AdminClient`), the authority/provisioner model, sign/
  renew/revoke/SSH API request types, and the `pki` package used for root
  paths and provisioner discovery. The CLI never implements the CA protocol
  itself; `utils/cautils` orchestrates these clients.
- **`github.com/smallstep/cli-utils`** — shared CLI infrastructure: the `step`
  runtime (STEPPATH, contexts), `ui` (prompts), `errs` (error formatting with
  `Message()`), `usage` (help templates), and the `command` registry.
- **`go.step.sm/crypto`** — cryptographic primitives: `jose` (JOSE signing and
  encryption), `pemutil` (PEM/key serialization), `kms` (KMS URI abstraction),
  `x509util`, `sshutil`, `keyutil`, and `fingerprint`.

Additional integrations include `smallstep/truststore` (system/browser trust
store installation), `smallstep/zcrypto`/`zlint`/`certinfo` (certificate
linting and inspection), `go-pkcs12` (PKCS#12 bundles), and
`pquerna/otp` (TOTP).

## How control flows

A typical CA-touching invocation follows the same path:

1. `cmd/step/main.go` → `internal/cmd.Run()` → `app.Run(os.Args)` dispatches to
   the registered command action (or the plugin fallback).
2. The action parses flags, leaning on `flags/` definitions and, for CA
   commands, on `defaults.json`/context resolution for `ca-url`/`root`.
3. Certificate/token-heavy actions delegate to `utils/cautils` flows, which
   build tokens via `token/` and call the step-ca client from
   `smallstep/certificates`.
4. Results are written to disk (`fileutil.WriteFile`, respecting `--out`,
   `--force` prompts) or printed through `ui`.

Offline mode (`--offline --ca-config`) is the notable alternative path: the
same commands execute against an in-process `authority.Authority` constructed
from a CA configuration file instead of the network client.

## Versioning and build

`Version`/`BuildTime` are injected via `-ldflags -X` by both the Makefile
(`make build`, defaulting to `git describe` output) and GoReleaser (release
builds). CI runs unit tests plus the testscript integration suite and linting
through the shared Smallstep workflow; releases produce cross-platform
binaries and `.deb`/`.rpm` packages via GoReleaser Pro.
