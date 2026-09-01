---
type: "Reference"
title: "Step CLI architecture overview"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
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
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# Step CLI architecture overview

`step` (module `github.com/smallstep/cli`, Go 1.25.8) is a command-line toolkit
for building, operating, and automating Public Key Infrastructure (PKI) and
crypto workflows, and it is also a client for the `step-ca` online Certificate
Authority (the `github.com/smallstep/certificates` server) and any ACMEv2 CA
(README.md:12-14).

## Repository layout and ownership

The codebase separates command definitions from shared internals:

| Area | Package | Responsibility |
|---|---|---|
| Entrypoint | `cmd/step` | Binary target; wires version/name and calls `cmd.Run()`. |
| Command surface | `command/` | One package per top-level command group (`ca`, `certificate`, `crypto`, `ssh`, `oauth`, `context`, `crl`, `api`, `base64`, `completion`, `fileserver`, `path`, `version`, `beta`), each registering itself in `init()`. |
| CLI plumbing | `internal/cmd`, `internal/plugin`, `exec`, `flags` | App construction, plugin dispatch, child-process helpers, shared flag definitions. |
| CA flows | `utils/cautils` | Online/offline CA clients, token flow, certificate flow, ACME flow, bootstrap. |
| Tokens | `token/` (+ `token/provision`) | JWT claim structure, claim options, and token parsing/type detection. |
| Private helpers | `internal/` (`cast`, `command`, `crlutil`, `cryptoutil`, `kdf`, `plugin`, `sliceutil`, `sshutil`) | Helpers not part of the public API surface. |
| Public-ish utilities | `utils/`, `pkg/` | `utils/cli.go` key-parameter parsing, `utils/cautils`, `utils/sysutils`, `pkg/bcrypt_pbkdf`. |

## Entrypoint and command registration

The binary target is `cmd/step/main.go`; the `Makefile` builds
`github.com/smallstep/cli/cmd/step` and injects `Version`/`BuildTime` via
`-ldflags` (Makefile:126-132). `main` calls `cmd.Run()` in
`internal/cmd/root.go`, which constructs the urfave/cli application.

Command packages register their `cli.Command` in package `init()` through
`command.Register` from `github.com/smallstep/cli-utils/command` (e.g.
`command/ca/ca.go:15-89`, `command/certificate/certificate.go:10-101`).
Top-level commands are enabled by blank-importing them in
`internal/cmd/root.go:30-44`, and the app collects the tree with
`command.Retrieve()`. See [CLI runtime, flag system, and error handling](cli-runtime.md).

## Major command groups

- **`step certificate`** — create/sign/inspect/verify/lint/bundle X.509
  certificates and CSRs, install roots into the system truststore, convert PEM
  to DER, and work with PKCS#12 files
  (`command/certificate/certificate.go:84-98`).
- **`step ca`** — initialize a PKI (`init`), bootstrap authority configuration,
  generate one-time tokens, sign/renew/revoke/rekey certificates, fetch roots,
  and manage provisioners, admins, policies, and ACME
  (`command/ca/ca.go:68-85`).
- **`step crypto`** — general-purpose crypto plumbing: JOSE (JWT/JWS/JWE/JWK),
  key derivation functions, hashing, NaCl primitives, TOTP, key management, and
  Windows PE utilities (`command/crypto/crypto.go:160-175`).
- **`step ssh`** — issue and manage SSH certificates, integrate with the SSH
  agent, inspect certificates, and configure clients/hosts
  (`command/ssh/ssh.go:84-100`).
- **`step oauth`** — OAuth 2.0 / OIDC single sign-on flows for CLIs
  (`command/oauth/cmd.go:79-103`).
- **`step context`** — manage named CA contexts
  (`command/context/context.go:50-56`).

## Shared dependencies

The CLI leans on a small set of external modules (go.mod:5-36):

- `github.com/smallstep/certificates` — provides the `ca` client,
  `authority` package (used directly by offline mode), `pki`, and `api` types.
- `github.com/smallstep/cli-utils` — provides the step environment/paths
  (`step`), command registration, errors, UI prompts, and file utilities.
- `go.step.sm/crypto` — JOSE, PEM/key loading, key generation, x509 templates,
  KMS (`kms`), and TPM support.
- `github.com/urfave/cli` — the CLI framework itself.

## Extension seams

- **Plugins**: executables named `step-<name>-plugin` are dispatched from
  `$STEPPATH/plugins` or `$PATH`; `step-kms-plugin` is the notable integration,
  used by `internal/cryptoutil` for KMS-backed keys and attestation
  (README.md:81-100, `internal/plugin/plugin.go`).
- **KMS URIs**: many commands accept `--kms` URIs (YubiKey, PKCS#11, TPM,
  cloud KMS) to create/use keys outside plain PEM files (`flags/flags.go:471-508`).

## Repository docs and OpenWiki

Developer-facing docs live in `docs/` (`CONTRIBUTING.md`,
`local-development.md`). The `openwiki/` directory holds this generated wiki;
it is documentation-only and is not part of the product binaries.
