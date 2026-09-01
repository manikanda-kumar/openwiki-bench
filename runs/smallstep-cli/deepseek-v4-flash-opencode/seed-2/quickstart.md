---
type: quickstart
title: Quickstart
description: Practical onboarding for the step CLI repository — building and testing the binary, initializing a CA, issuing a certificate, and understanding the STEPPATH artifacts the code creates.
tags: [quickstart, build, ca, certificates]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# Quickstart

`step` is the Smallstep CLI: a tool for building and operating PKI systems and
a client for the `step-ca` certificate authority. This page gets you from a
fresh checkout to a working CA and a signed certificate, grounded in the actual
code paths.

## Build and test

The `Makefile` drives development:

```sh
make build       # builds ./bin/step (command/ca via cmd/step main package)
make test        # gotestsum -- -short -coverprofile=coverage.out ./...
make race        # gotestsum -- -race ./...
make lint        # golangci-lint + govulncheck
make install     # copies bin/step to /usr/local/bin (DESTDIR)
```

`make build` runs `go build -o bin/step github.com/smallstep/cli/cmd/step`
(Makefile:126-132) with `-ldflags` that stamp `main.Version` and
`main.BuildTime` from the git tag/describe (Makefile:48-71). Those package
variables feed `step version` and the `STEPDEBUG=1` panic output.

## First run and environment

`step` stores all persistent state under a base path that defaults to
`$HOME/.step` and is overridable with `STEPPATH`:

```sh
$ step path        # the active step path (authority path when a context is set)
$ step path --base # $HOME/.step by default
```

At startup `cmd.Run()` calls `step.Init()` (internal/cmd/root.go:54), which
ensures the environment is ready before any command runs. Getting help:

```sh
$ step            # top-level help (also the plugin dispatch point)
$ step ca -h      # per-command help, generated from cli.Command metadata
$ step --version
```

## Initialize a certificate authority

`step ca init` (command/ca/init.go) generates the PKI and the step-ca
configuration. It is interactive, but every prompt has a flag:

```sh
$ step ca init \
  --name "Example" \
  --dns ca.example.com \
  --address ":443" \
  --provisioner admin@example.com \
  --password-file pass.txt \
  --deployment-type standalone
```

For a fully scripted run, provide `--name`, `--dns`, `--address`,
`--provisioner`, and `--password-file`; `isNonInteractiveInit`
(command/ca/init.go:720-752) then skips prompts and assumes the **Standalone**
deployment type. `step ca init --pki` generates only the PKI without the CA
configuration.

The command writes the step-ca configuration and key material. Key artifacts:

- `$STEPPATH/config/ca.json` — the step-ca server configuration (used later by
  `--offline` mode; `step ca init` writes it via `p.Save()`).
- `$STEPPATH/certs/root_ca.crt` — the root certificate, also stored under
  `pki.GetRootCAPath()`.
- intermediate certs/keys under the same certs directory.

## Issue a certificate from the CA

The CA itself is served by the separate `step-ca` server binary; the CLI talks
to it over HTTPS. With a running CA, bootstrap trust and issue a certificate:

```sh
$ step ca bootstrap --ca-url https://ca.example.com \
  --fingerprint $(step certificate fingerprint $STEPPATH/certs/root_ca.crt)
```

`step ca bootstrap` (command/ca/bootstrap.go, utils/cautils/bootstrap.go)
downloads and validates the root by fingerprint and writes:

- `$STEPPATH/certs/root_ca.crt` (mode 0600)
- `$STEPPATH/config/defaults.json` (mode 0644) containing `ca-url`,
  `fingerprint`, and `root` — so later commands can omit `--ca-url`/`--root`.

Then get a certificate:

```sh
$ TOKEN=$(step ca token internal.example.com)
$ step ca certificate internal.example.com internal.crt internal.key \
  --token "$TOKEN"
```

Or let the command generate the token for you (it prompts to pick a provisioner):

```sh
$ step ca certificate internal.example.com internal.crt internal.key
```

The command generates a key (EC P-256 by default), builds a CSR, signs it
through the CA, writes the certificate chain to `internal.crt` and the private
key to `internal.key` (mode 0600) — see `certificateAction`
(command/ca/certificate.go:220-307).

## Issue a certificate offline

With the artifacts from `step ca init`, no server is required:

```sh
$ step ca certificate --offline internal.example.com internal.crt internal.key
```

`--offline` loads `$STEPPATH/config/ca.json` into an in-process authority
(`cautils.NewOfflineCA`, utils/cautils/offline.go) and runs the whole
signing flow locally. It is incompatible with `--token`.

## Certificate toolkit without a CA

For pure local X.509 work, the `step certificate` group needs no CA at all:

```sh
$ step certificate create "Example Root" root.crt root.key --profile root-ca
$ step certificate create "Example Leaf" leaf.crt leaf.key \
  --ca root.crt --ca-key root.key
$ step certificate verify leaf.crt --roots root.crt
```

## Where to go next

- Architecture: see "Architecture Overview" for how the binary and command tree
  are assembled, and "STEPPATH Environment and Contexts" for the on-disk state.
- Issuance details: "Certificate Issuance" covers `step ca certificate` and
  `step ca sign` end to end.
- CA lifecycle: "CA Initialization and Bootstrap" documents `step ca init` and
  `step ca bootstrap` in depth.
