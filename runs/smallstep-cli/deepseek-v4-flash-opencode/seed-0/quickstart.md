---
type: "Reference"
title: "Quickstart"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-73f7b910a9f89c04fc8a55ce
    resource: repo://command/ssh/certificate.go
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---


# Quickstart

`step` is a CLI for building, operating, and automating PKI systems. It works
standalone (offline certificate creation) and as a client for the `step-ca`
online Certificate Authority.

## Prerequisites and build

- Go (the two latest versions per `docs/local-development.md`; see `go.mod` for
  the minimum), `make`, and the repository checked out in your `$GOPATH`.
- Build the binary: `make build` (outputs `bin/step`). `make bootstrap` once
  installs the lint/test tooling. `make` runs lint + tests + build.
- The binary entrypoint is `cmd/step/main.go`; the application is assembled in
  `internal/cmd/root.go`.

## Common workflows

### Create an offline CA and issue certificates

`step ca init` creates a root/intermediate PKI plus the `ca.json`
configuration under `$STEPPATH` (default `$HOME/.step`):

```
$ step ca init --name "My CA" --dns localhost --address :443
```

Then issue a certificate without contacting a server:

```
$ step ca certificate --offline internal.example.com internal.crt internal.key
```

Offline mode uses the `OfflineCA` (see
[CA Client and Certificate Flows](ca/ca-client-and-flows.md)); `--offline` and
`--token` are mutually exclusive.

### Create standalone certificates (no CA server)

`step certificate create` generates keys, CSRs, and certificates directly:

```
$ step certificate create foo foo.crt foo.key --profile leaf --ca root-ca.crt --ca-key root-ca.key
$ step certificate create --csr foo foo.csr foo.key
$ step certificate inspect foo.crt
$ step certificate verify foo.crt --roots root-ca.crt
```

See [The step certificate Command Group](commands/certificate-group.md).

### Bootstrap against an online CA

`step ca bootstrap --ca-url https://ca.example.com --fingerprint <fp>` downloads
the root certificate, writes it and `config/defaults.json` under `$STEPPATH`,
and records a context. After that, CA commands pick up `--ca-url`/`--root` from
the environment automatically. Add `--install` to trust the root system-wide.

### Request a certificate from an online CA

```
$ TOKEN=$(step ca token internal.example.com)
$ step ca certificate --token "$TOKEN" internal.example.com internal.crt internal.key
```

Tokens are minted per provisioner (JWK, OIDC, X5C, K8sSA, GCP/AWS/Azure, ACME,
etc.); see [Provisioning Tokens](ca/provisioning-tokens.md) and
[The step ca Command Group](commands/ca-group.md). Renew with
`step ca renew internal.crt internal.key` (mTLS by default) and revoke with
`step ca revoke <serial>`.

### SSH certificates

```
$ step ssh login alice            # user certificate added to the SSH agent
$ step ssh certificate --host internal.example.com ssh_host_ecdsa_key   # host cert
$ step ssh config                 # apply SSH templates from the CA
```

See [The step ssh Command Group](commands/ssh-group.md).

## Where to look next

- [Architecture Overview](architecture/overview.md) — package layout and
  ownership.
- [CA Client and Certificate Flows](ca/ca-client-and-flows.md) — online vs
  offline client behavior.
- [Build, Test, and Release](operations/build-test-release.md) — Makefile
  targets, GoReleaser, versioning.
- [Change Guides](operations/change-guides.md) — how to add commands/flags and
  change claims or error handling.
