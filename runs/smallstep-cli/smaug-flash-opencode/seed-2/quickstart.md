---
type: quickstart
title: Quickstart
description: Build, install, and run the step CLI, summarize its major command groups, and link to the architecture, CA, SSH, and crypto pages.
tags: [quickstart, onboarding, build, install, step-cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---

## What is step?

`step` is an easy-to-use CLI tool for building, operating, and automating Public
Key Infrastructure (PKI) systems and workflows, and a client for the `step-ca`
online Certificate Authority server. See the project [`README.md`](../../README.md)
for the high-level feature list.

## Build and install

The simplest path uses the [`Makefile`](../../Makefile):

```
make build          # builds bin/step
make install        # installs into $(DESTDIR), default /usr/local/bin
```

`make build` runs `go build` of `github.com/smallstep/cli/cmd/step`
(`cmd/step/main.go` is the entrypoint). Equivalent direct invocations:

```
go build -o bin/step github.com/smallstep/cli/cmd/step
go install github.com/smallstep/cli/cmd/step
```

The binary name defaults to `step` (`BINNAME?=step`). For a release build in
parity with CI, use `goreleaser build` via `make goreleaser` (snapshot, single
target; skip onboarding/upload hooks yourself when needed). See
[testing-and-integration.md](testing-and-integration.md) for the full pipeline.

`Version`/`BuildTime`/`AppName` are injected via LDFLAGS at build time
([`cmd/step/main.go`](../../cmd/step/main.go)); without them they default to
`"N/A"`.

## First run

When you run a bare `step` (or `step help`), `internal/cmd/root.go` builds the
`urfave/cli` app and prints the app help listing every registered top-level
command. Commands are discovered via static registration: each command package's
`init()` calls `command.Register` (from cli-utils), and `cmd/step/main.go`'s
blank imports of the command packages (via `internal/cmd/root.go`) make those
`init()` functions run. `step <unknown> <args>` dispatches to a plugin if one
named `step-<unknown>-plugin` exists in `$STEPPATH/plugins` or `$PATH`. See
[architecture.md](architecture.md) for details.

## Major command groups

- `step certificate` — standalone X.509 operations: create, sign, inspect, lint,
  bundle, verify, format, finger*, install, p12.
- `step ca` — initialize/manage a CA and interact with `step-ca`: bootstrap,
  token, certificate, sign, renew, revoke, root, provisioner, policy, admin, acme.
- `step crypto` — general-purpose crypto toolkit: JWK/JWT/JWS/JWE, hash, kdf,
  key, nacl, otp, rand, winpe, keypair.
- `step ssh` — create and manage SSH user/host certificates and interact with
  the SSH agent: certificate, login, logout, config, hosts, inspect, list,
  proxycommand, renew, rekey, revoke.
- `step oauth` — OAuth 2.0 / OIDC authorization flow for getting access and
  identity tokens at the CLI.

## Example

```
$ step ca bootstrap --ca-url https://ca.example.com \
    --fingerprint d9d097...77 step ca certificate ...
```

The `step ca` command group's help (`command/ca/ca.go`) documents examples for
bootstrap, root download, health, certificate generation, and renewal.

## Where to go next

- [architecture.md](architecture.md) — the command dispatcher, flag catalog, and
  process helpers.
- [ca-integration.md](ca-integration.md) — how step talks to `step-ca` (clients,
  token flows, bootstrap, ACME, offline, admin).
- [ssh-integration.md](ssh-integration.md) — SSH certificate and agent flows.
- [crypto-command-group.md](crypto-command-group.md) — the general crypto toolkit.
- [change-guide-add-command.md](change-guide-add-command.md) — add a new command.
- [testing-and-integration.md](testing-and-integration.md) — unit + integration tests.
