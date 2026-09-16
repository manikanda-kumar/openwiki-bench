---
type: "Reference"
title: "Quickstart"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
sources:
  - id: openwiki-source-c24853a4005579209b2246f3
    resource: repo://autocomplete/README.md
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-57260b234ea7f7b2e5fd2415
    resource: repo://command/completion/completion.go
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-14T13:44:47.469Z" }
---

# Quickstart

Practical start for the Smallstep CLI: building the `step` binary, verifying it, bootstrapping against a CA, issuing your first certificate and SSH certificate, and running the tests.

> **What `step` is:** a CLI toolkit for building, operating, and automating PKI workflows, and a client for the separate `step-ca` online CA server ([smallstep/certificates](https://github.com/smallstep/certificates)). CA server behavior (endpoints, provisioning, ACME) is owned by that server; this repository contains the client side.

## Prerequisites and build

- Go — `go.mod` declares `go 1.25.8`; `docs/local-development.md` says the latest two Go versions are supported.
- `make` available on PATH.

```console
$ make bootstrap   # once: installs golangci-lint, gotestsum, govulncheck, goimports, GoReleaser Pro
$ make build       # CGO_ENABLED=0 go build -> bin/step
$ bin/step version
```

`make build` compiles `github.com/smallstep/cli/cmd/step` into `bin/step` with `CGO_ENABLED=0`; `main.Version` and `main.BuildTime` are injected by ldflags (git tag via `GITHUB_REF` or `git describe` in CI, otherwise `-dev`-suffixed). `step version` prints the injected version in `Smallstep CLI/<version>` form.

## Shell completion

`step completion <shell>` prints completion scripts for `bash`, `zsh`, or `fish` (e.g. `step completion bash >> ~/.bashrc`). The checked-in `autocomplete/` scripts are deprecated in favor of this command.

## First CA bootstrap

Point the client at a CA and pin its root:

```console
$ step ca bootstrap --ca-url https://ca.example.com \
    --fingerprint d9d0978692f1c7cc791f5c343ce98771900721405e834cd27b9502cc719f5097
```

`step ca bootstrap` stores the root certificate in `$STEPPATH/certs/root_ca.crt` and creates `$STEPPATH/configs/defaults.json` with the CA url, root certificate location, and fingerprint. `--ca-url` and `--fingerprint` are required (or use the `--team` variant for smallstep.com team CAs, which is incompatible with `--ca-url`/`--fingerprint`). Add `--install` to also install the root into the system trust store.

## First certificate

Generate a one-time token (OTT) on the CA side (e.g. with `step-ca` admin tooling or `step ca token <subject> --provisioner ...` against a CA that allows it), then request a certificate:

```console
$ step ca certificate user@example.com user.crt user.key \
    --token <ott> --san user@example.com
```

`step ca certificate <subject> <crt-file> <key-file>` generates a new private key and a certificate signed by the CA, with flags for `--token`, `--san`, `--issuer`, key type (`--kty`/`--curve`/`--size`), ACME (`--acme`, `--standalone`, `--webroot`), and CA selection (`--ca-url`, `--root`, `--context`).

**Offline mode:** `step ca certificate --offline --ca-config ca.json <subject> <crt> <key>` embeds a CA from a local configuration file (built with `step ca init --ssh --offline`) and signs locally using the `smallstep/certificates` `OfflineCA` library — no CA server required. `--offline` is incompatible with `--token`.

## SSH login

```console
$ step ssh login          # add an SSH user certificate to the local auth agent
$ step ssh config         # write SSH client config (templates from step-certificates)
$ step ssh config --host  # configure an SSH server instead
```

`step ssh login [<identity>]` requests an SSH certificate from the CA and adds it to the authentication agent; `step ssh config` configures OpenSSH to use certificates (`--roots`/`--federation` print verification keys, `--set key=value` customizes templates).

## Running the tests

```console
$ make build && make test    # gotestsum, -short, all packages
$ make lint                  # shared golangci-lint config + govulncheck
```

The `integration/` package uses `testscript` and runs the CLI in-process (the `step` script command maps to `internal/cmd.Run`), so `make test` does not require the binary on PATH. See the development guide for adding tests.

## Uncertainties

- Which CA URL/root is used when `--ca-url`/`--root` are omitted is resolved by the step context machinery in `cli-utils` (external to this repo); the default context values are not defined here.
- The `--team` smallstep.com team CA flow and its endpoints are external; only the flag wiring in this repo is verifiable.
- `step-ca` server-side behavior (provisioners, ACME flows, token issuance) belongs to `smallstep/certificates` and is documented by that project.
