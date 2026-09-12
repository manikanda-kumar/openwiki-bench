---
type: quickstart
title: Quickstart
description: Build, run, and try the step CLI, and find the wiki pages that explain the subsystems you need.
tags: [quickstart, build, cli, step-cli, task-routing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:42:28.757Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-09-12T20:42:28.757Z" }
---

# Quickstart

`step` is a CLI for building, operating, and automating PKI systems, and a
client for the `step-ca` Certificate Authority. This page shows how an engineer
gets the binary built and running)Skip and routes you to the wiki pages for the
subsystem you need.

## Build

Prerequisites: Go 1.25.8+, make, curl, git (some target dependencies).
From the repository root:

```sh
make build        # builds bin/step
./bin/step version
```

`make install` copies the binary to `$DESTDIR` (default `/usr/local/bin`).
`make goreleaser` uses GoReleaser for release-style cross-compiled builds; the
`build` target compiles `github.com/smallstep/cli/cmd/step` with version and
build-time ldflags (`Makefile`, `cmd/step/main.go`).

For development tooling, `make bootstrap` installs golangci-lint, govulncheck,
gotestsum, goimports, and GoReleaser Pro (`Makefile`).

## Run and try

Verify the environment (this calls `step.Init()` and prints to stdout):

```sh
step path          # prints $STEPPATH (default $HOME/.step)
step context       # manage CA contexts (see architecture/configuration.md)
step version
```

To exercise the crypto toolset without a CA:

```sh
step crypto keypair key.pub key.priv
step crypto jwt sign --key key.priv --iss joe --aud bob --sub hello --exp $(date -v+1M +"%s")
step crypto jwt verify --key ... 
step crypto jose format   # swap JOSE serialization (reads stdin)
```

See `concepts/crypto.md` for JOSE/KDF/OTP/nacl and the `--insecure`/`--subtle`
gates.

To create a local CA artifact without a running server:

```sh
step certificate create root-ca root-ca.crt root-ca.key --profile root-ca
step certificate create foo foo.crt foo.key --profile leaf --ca root-ca.crt --ca-key root-ca.key
step certificate inspect foo.crt
```

See `concepts/certificates.md` for profiles and templates. For a real or local
step-ca, `step ca init` boots the config and `step ca bootstrap` pins the root
(`workflows/ca-workflows.md`, `architecture/configuration.md`). ACME issuance
is described in `workflows/acme.md`, SSH in `concepts/ssl-ca-wide.md`, and
tokens/provisioners in `concepts/token-flow.md`.

## How commands are routed

`cmd/step.main` sets identity and calls `cmd.Run()`. `internal/cmd/root.go`
blank-imports every top-level command package (which self-register via
`command.Register`) and builds the urfave/cli app. A first argument that is
not a built-in command is dispatched as a plugin (`step-<name>-plugin`); see
`architecture/entrypoint.md` and `extensions/plugins.md`. Set `STEPDEBUG=1`
for full error stacks.

## Task routing

| I want to … | Go to |
|---|---|
| Understand the binary/entrypoint/routing | `architecture/entrypoint.md` |
| Learn STEPPATH/contexts/defaults/trust | `architecture/configuration.md` |
| Create or sign X.509 certificates | `concepts/certificates.md` |
| Use crypto/JOSE/KDF/OTP/nacl | `concepts/crypto.md` |
| Generate CA tokens / provisioners | `concepts/token-flow.md` |
| Manage SSH certificates | `concepts/ssl-ca-wide.md` |
| Run CA init/bootstrap/sign/renew/revoke | `workflows/ca-workflows.md` |
| Use ACME / challenge validation | `workflows/acme.md` |
| Write a plugin or use the KMS plugin | `extensions/plugins.md` |
| Build/test/package and operate | `testing-guide.md` |

## Further reading

- `README.md` documents features, plugins, and the command groups.
- `command/README.md` describes how to add a new command.
- `Makefile` documents build/test/lint/install and cross-compilation.
