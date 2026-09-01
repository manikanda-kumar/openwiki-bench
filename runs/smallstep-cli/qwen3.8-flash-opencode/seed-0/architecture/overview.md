---
type: "Reference"
title: "Architecture Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---


# Architecture Overview

`github.com/smallstep/cli` builds the `step` binary: a PKI/X.509/SSH/JWT
toolkit and client for the `step-ca` server. The repository is deliberately
thin — most crypto primitives and the CA protocol live in external modules,
while this repo owns the CLI surface, flows, and local state contracts.

## Layers and entrypoint

- **`cmd/step/main.go`** — the only `main` package. Sets version/build
  metadata into the environment, overrides the CA client UserAgent, and calls
  `cmd.Run()`.
- **`internal/cmd/root.go`** — assembles the `urfave/cli` app: error/panic
  handling, help customization, global `--config` flag, plugin fallback. See
  [CLI Runtime and Plugin Dispatch](/openwiki/architecture/cli-runtime.md).
- **`command/…`** — one package per command group (`ca`, `certificate`,
  `crypto`, `ssh`, `oauth`, `context`, `path`, `crl`, `api`, `base64`, `beta`,
  `completion`, `fileserver`, `version`). Each group registers its tree at
  package `init()` time.
- **`flags/`, `token/`, `utils/` (including `utils/cautils`), `exec/`, `pkg/`** —
  importable library code shared across commands: flag definitions and
  parsing, JWT parsing/claims, CA flows, process execution, and a vendored
  `bcrypt_pbkdf`.
- **`internal/…`** — non-importable helpers: `plugin`, `sshutil`, `crlutil`,
  `kdf`, `cryptoutil`, `cast`, `sliceutil`, `command` (context middleware).

## Command registration pattern

Every command package calls `command.Register(cmd)` (from
`github.com/smallstep/cli-utils/command`) inside `init()` with a
`cli.Command` tree. Enabled groups are pulled into the binary purely by side
effect: `internal/cmd/root.go` blank-imports each top-level group package
(`command/api`, `command/ca`, `command/certificate`, …) and builds the app with
`app.Commands = command.Retrieve()`
(internal/cmd/root.go:30-43, internal/cmd/root.go:122). Disabling a command
group means removing its blank import.

> Note: `command/README.md` still documents adding imports to
> `cmd/step/main.go` (command/README.md:50-62); in the current code the
> registrations live in the blank-import block of `internal/cmd/root.go`, so
> the README is stale on that detail.

Sub-groups (`ca/provisioner`, `ca/policy`, `ca/admin`, `ca/acme/eab`, …) are
registered by their own packages and referenced from the parent group's
`Subcommands` list, which is why e.g. `command/ca/ca.go` imports them normally
rather than via `command.Retrieve()` for nesting.

`internal/command/inject.go` provides `InjectContext`, the middleware seam
that converts a `cli.ActionFunc` into a context-aware function with the
`*cli.Context` retrievable from the Go context.

## Ownership boundaries (external modules)

`go.mod` pins the load-bearing dependencies (go.mod:7-36):

| Module | What it owns | Where used here |
| --- | --- | --- |
| `github.com/smallstep/certificates` (v0.30.2) | CA protocol: `ca.Client`/`ca.AdminClient`, offline `authority.Authority`, `authority/config` (ca.json), `provisioner` types, `pki` helpers, ACME API types, `cas` certificate authorities (cloudCAS/softcas/stepcas registered by blank import in internal/cmd/root.go:26-28) | `utils/cautils`, `command/ca`, `command/ssh` |
| `github.com/smallstep/cli-utils` (v0.12.2) | `step` environment (STEPPATH, contexts, defaults), `command` registry, `ui` prompts, `errs`, `usage` templates, `fileutil` | app runtime, all commands |
| `go.step.sm/crypto` (v0.89.0) | JOSE (`jose`), PEM I/O (`pemutil`), key generation (`keyutil`), X.509 utilities, TPM tooling | `token`, `flags`, `cautils`, crypto commands |
| `github.com/urfave/cli` (v1.22.17) | v1 CLI framework (app, commands, flags, context) | wrapped by `internal/cmd` |
| `github.com/smallstep/truststore`, `certinfo`, `zlint`, `linkedca`, `slackhq/nebula`, `go-attestation` | OS trust store installs, certificate rendering, linting, Smallstep cloud API, Nebula certs | `command/certificate`, `command/api`, provisioner flows |

The practical consequence: token *verification rules* and provisioner *behaviors*
are defined in `smallstep/certificates`; this repo defines how the CLI selects
provisioners, builds tokens, contacts the CA endpoint, and stores results under
`$STEPPATH`.

## Core data/control flow

The representative path for a CA-backed operation (e.g. `step ca certificate`):

```
command/ca/certificate.go
  → utils/cautils.CertificateFlow (offline vs online decision from --offline/--ca-config)
    → utils/cautils.TokenFlow: pki.GetProvisioners(caURL, root) → provisioner
       selection → per-type token generator (token_generator.go)
    → online: certificates/ca.Client.Sign / offline: cautils.OfflineCA
       (in-process certificates/authority loaded from ca.json)
  → cli-utils fileutil.WriteFile to the requested cert/key paths
```

Configuration inputs are layered: CLI flags > context/defaults.json values
(external `step` package) > `flags` package defaults such as
`--ca-config=$(step path)/config/ca.json` (flags/flags.go:291-296).

## Repository-local package map

- `utils/cautils` — the CA integration layer (client, flows, offline, ACME,
  bootstrap, TPM); the largest business-logic package (utils/cautils/*.go).
- `token` — step/CA provisioning JWT model: parse, type detection, claim
  options; see [Provisioning Tokens](/openwiki/core/token-package.md).
- `flags` — shared flag values plus validators/parsers; reused by nearly all
  command groups.
- `exec` — child-process handling with signal forwarding and browser launch,
  used by `oauth`, `ssh proxycommand`, and plugin-adjacent flows.
- `internal/sshutil`, `internal/crlutil`, `internal/kdf`,
  `internal/cryptoutil` — focused helpers for SSH agent/cert inspection, CRL
  JSON rendering, password-hash formats (PHC/argon2/scrypt), and key type
  coercion.

## Where to go next

- Runtime details: [CLI Runtime and Plugin Dispatch](/openwiki/architecture/cli-runtime.md)
- Persistent local state: [STEPPATH, Contexts, and Local State](/openwiki/architecture/steppath-and-contexts.md)
- CA flows: [CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)
- Adding commands: [Change Guide: Adding or Modifying Commands](/openwiki/changes/adding-and-modifying-commands.md)
