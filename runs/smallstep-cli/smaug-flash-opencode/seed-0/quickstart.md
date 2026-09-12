---
type: quickstart
title: Quickstart
description: Practical entry point to build, install, and run representative step CLI workflows against offline and online step-ca, including basic environment and configuration.
tags: [quickstart, build, install, offline, bootstrap]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---

# Quickstart

This page gets a new user or engineer from source checkout to running `step`
against both an offline and an online CA, with the most common one-liners.

## Building from source

`step` is a Go module (`github.com/smallstep/cli`, module path in `go.mod`).

```sh
# Build to ./bin/step
make build

# Install to /usr/local/bin
sudo make install

# Quick build parity with CI (GoReleaser Pro)
make goreleaser
```

`make build` compiles `github.com/smallstep/cli/cmd/step` and defaults
`CGO_ENABLED=0` for static binaries (Makefile:126-132). `Version`/`BuildTime`
are injected at link time. Cross-compilation is available through the
`binary-linux-*`/`binary-darwin-*`/`binary-windows-*` targets (Makefile:214-235).

To run the test suite:

```sh
make test        # gotestsum, short, coverprofile=coverage.out
make race        # with -race
make lint        # golangci-lint + govulncheck
```

## Environment and step path

The default working directory is `$HOME/.step`; override with `STEPPATH`:

```sh
export STEPPATH=/tmp/step
step path --base   # prints the base path
step path          # current authority path (base unless a context is active)
```

`STEPPATH` holds `config/defaults.json`, `certs/`, `secrets/`, `plugins/`, and
context state. See [Configuration, Environment, and the Step
Path](configuration/env-and-step-path.md).

## Initialize a CA PKI (offline-ready)

Create the keys and config for a CA on disk without running a server:

```sh
step ca init --name "Example CA" --dns ca.example.com --provisioner admin
```

`step ca init` (command/ca/init.go) writes the root/intermediate keys and a
`ca.json` config. Combined with `--offline` and `--ca-config`, subsequent
operations sign against the in-process authority with no network.

## Offline certificate issuance

Issue an offline leaf certificate signed by the local CA:

```sh
step ca certificate internal.example.com internal.crt internal.key \
  --offline --ca-config config/ca.json --provisioner admin \
  --root certs/root_ca.crt
```

In offline mode, command flows use `NewOfflineCA` and generate an OTT using the
provisioner defined in `ca.json` (see
[Certificate and Token Flows](architecture/token-flows.md)).

## Bootstrap an online CA

Point the CLI at a running `step-ca` and establish trust:

```sh
step ca bootstrap \
  --ca-url https://ca.example.com \
  --fingerprint 0d7d3834cf187726cf331c40a31aa7ef6b29ba4df601416c9788f6ee01058cf3
```

This writes `config/defaults.json` (`ca-url`, `fingerprint`, `root`) under the
step path so most commands can run without repeating `--ca-url`/`--root`.

## Common one-liners

### X.509

```sh
# Self-contained root + issued leaf, no CA server
step certificate create root-ca root.crt root.key --profile root-ca
step certificate create foo foo.crt foo.key \
  --profile leaf --ca root.crt --ca-key root.key
step certificate verify foo.crt --roots root.crt

# Through the online CA (provisioner-based token)
TOKEN=$(step ca token internal.example.com)
step ca certificate internal.example.com internal.crt internal.key \
  --token "$TOKEN" --ca-url https://ca.example.com --root root_ca.crt
```

### JWT/JWK

```sh
export STEPPATH=/tmp/stepkeys
step crypto jwk create priv.pem pub.pem --kty EC --curve P-256
step crypto jwt sign --key priv.pem --sub alice --iss acme --aud api
step crypto jwt verify --key pub.pem --alg ES256 <token>
```

### SSH

```sh
step ssh login bob@work            # requests a user cert and adds to agent
step ssh logout bob@work           # removes from agent
step ssh certificate --host web internal.example.com ssh_host_key
```

## Key algorithm defaults

Commands that generate keys default to EC P-256 (`utils/cli.go`). RSA defaults
to 2048 bits (min 2048 unless `--insecure`); EC curves P-256/P-384/P-521; OKP
Ed25519 prompted by `--kty`.

## Related

- [CLI Runtime and Command Registration](architecture/command-runtime.md) — boot sequence.
- [Configuration, Environment, and the Step Path](configuration/env-and-step-path.md) — STEPPATH and contexts.
- [Online and Offline step-ca Client Integration](integration/ca-client.md) — client/ACME modes.
