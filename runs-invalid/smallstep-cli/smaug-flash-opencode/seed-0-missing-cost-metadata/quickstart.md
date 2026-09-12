---
type: "Reference"
title: "Quickstart: Building, Installing, and Trying the step CLI"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-73f7b910a9f89c04fc8a55ce
    resource: repo://command/ssh/certificate.go
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---


# Quickstart: Building, Installing, and Trying the step CLI

`step` is a Go binary (`module github.com/smallstep/cli`, Go 1.25). This page gets
a new engineer from a fresh checkout to a working binary with a few representative
workflows.

## Build and install

Build a local binary with the Makefile:

```
make build        # produces bin/step
```

`make build` compiles `github.com/smallstep/cli/cmd/step` into `bin/step`, using
`CGO_ENABLED=0` by default and injecting `main.Version`/`main.BuildTime` via
`-ldflags` (`Makefile#L123-L132`). `make install` copies the binary to
`/usr/local/bin` (`DESTDIR`), and `make install` requires `make build` first.

You can also build with plain Go:

```
go build -o bin/step ./cmd/step
```

The entrypoint is `cmd/step/main.go`; `main()` calls `cmd.Run()` which builds the
urfave/cli app (see [CLI runtime](architecture/cli-runtime-and-command-registration.md)).

## First commands

```
./bin/step version          # prints e.g. "Smallstep CLI/<version>/<date>"
./bin/step help             # shows the app help
```

`step version` prints `step.Version()` and the release date, coming from the
`Version`/`BuildTime` globals set at build time (`command/version/version.go`).
`step help` shows the registered command groups (`ca`, `certificate`,
`crypto`, `oauth`, `ssh`, `context`, `base64`, `crl`, `fileserver`, `path`, ...).

## Where state lives

The CLI's persistent state is under a "step path" that defaults to `$HOME/.step`
and is overridable with the `STEPPATH` environment variable. `step path` prints
the current path; `step path --base` prints the base; `step path --profile`
prints the current profile path (when contexts are in use) —
see `command/path/path.go` and
[environments and contexts](architecture/environment-and-contexts.md). During CA
setup this path holds `certs/root_ca.crt` and `config/ca.json`.

## Workflow 1: bootstrap to an existing CA

To connect to a CA you already know, download its root and save defaults with
`step ca bootstrap`:

```
./bin/step ca bootstrap --ca-url https://ca.example.com \
    --fingerprint <root-fingerprint>
```

This writes the root to `$STEPPATH/certs/root_ca.crt` and a
`$STEPPATH/config/defaults.json` containing the CA URL, fingerprint, and root
path, so later commands don't need `--ca-url`/`--root`
(`command/ca/bootstrap.go`, `utils/cautils/bootstrap.go`).

## Workflow 2: create a local CA and a certificate

For a self-contained test (no server), start a fresh standalone CA. A fully
non-interactive run needs the required init flags:

```
./bin/step ca init --name "test" --dns localhost --address :9000 \
    --provisioner admin --password-file pass.txt
```

Or run it interactively with no flags and answer the deployment-type prompts.

The offline/CA flow (`--pki`, `--no-db`, RA modes, KMS flags) is covered in
[deployment types](operations/step-ca-deployment-types.md). After `step ca init`
you can issue a certificate using the offline authority:

```
./bin/step ca certificate --offline --provisioner admin \
    --password-file pass.txt \
    localhost localhost.crt localhost.key
```

(Offline mode uses the `ca.json` produced by `step ca init`; see
[CA flows](architecture/ca-online-offline-flows.md).)

To create a plain standalone X.509 cert/CSR without any CA machinery:

```
./bin/step certificate create foo foo.crt foo.key            # root-ca / leaf default
./bin/step certificate create foo foo.csr foo.key --csr      # a CSR
./bin/step certificate inspect foo.crt                       # inspect it
./bin/step certificate verify foo.crt --roots ./foo.crt      # verify
```

These use the standalone toolkit in [certificate toolkit](architecture/certificate-toolkit.md).

## Workflow 3: request an SSH certificate

With a CA that supports SSH:

```
./bin/step ssh certificate mariano@work id_ecdsa
```

Generates `id_ecdsa`, `id_ecdsa.pub`, and `id_ecdsa-cert.pub`, signing through the
CA (with a token generated per the provisioner). `step ssh login bob` signs a
user certificate and adds it to your SSH agent (requires `SSH_AUTH_SOCK`). See
[SSH certificates](architecture/ssh-certificates.md).

## Running tests

```
go test ./...          # unit + integration (integration runs in-process step)
make lint              # golangci-lint + govulncheck
make race              # go test -race ./...
```

The integration suite is described on the
[testing strategy](testing/integration-and-testing.md) page.
