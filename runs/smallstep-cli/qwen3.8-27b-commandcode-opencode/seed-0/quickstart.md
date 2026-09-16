---
type: guide
title: "Quickstart"
description: "Get developers building, testing, and running the step CLI: environment bootstrap, make targets, integration test entry points, and a first end-to-end certificate flow (offline init and online bootstrap paths)."
tags: [quickstart, development, make, build, testing, offline-ca, bootstrap]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

A minimal path from clone to a signed certificate. All commands below are verified against the `Makefile`, `docs/local-development.md`, and the `command/ca/*` definitions.

## 1. Set up the development environment

Prerequisites (`docs/local-development.md`): Go (the module requires the version in `go.mod`), `make`, and the repository checked out. Then:

```console
$ make bootstrap   # installs golangci-lint, govulncheck, gotestsum, goimports, GoReleaser Pro into $(go env GOPATH)/bin
$ make build       # builds the CLI to bin/step
```

`make bootstrap` is a one-time toolchain install (`Makefile:103-117`); `make build` compiles `github.com/smallstep/cli/cmd/step` with `CGO_ENABLED=0` and embeds `main.Version`/`main.BuildTime` via `-ldflags` (`Makefile:22,41-56,66-69,123-132`). Verify the result: `./bin/step version`.

## 2. Make targets

| Target | What it does |
|---|---|
| `make` / `make all` | Runs `lint test build` in order (`Makefile:30`) |
| `make ci` | Runs `test build` (`Makefile:32`) |
| `make bootstrap` | Installs the lint/test/release toolchain (`Makefile:103-117`) |
| `make build` | Builds `bin/step` (`Makefile:123-132`) |
| `make goreleaser` | Releases via GoReleaser (`Makefile:134`) |
| `make test` | `gotestsum` short-mode run with coverage (`Makefile:151-152`) |
| `make race` | Full run under `-race` (`Makefile:154-155`) |
| `make fmt` | `goimports` with the smallstep local-import grouping (`Makefile:163-164`) |
| `make lint` | `golint` + `govulncheck` (`Makefile:166-173`) |
| `make install` / `make uninstall` | Installs/removes `bin/step` to `$(DESTDIR)` (`Makefile:181-186`) |
| `make clean` | Removes `bin/step` and `dist/` (`Makefile:194-196`) |
| `make binary-<platform>` | Per-platform builds (`linux-amd64`, `linux-arm64`, `linux-armv7`, `linux-mips`, `darwin-amd64`, `darwin-arm64`, `windows-amd64`) (`Makefile:214-232`) |

`BINNAME` (default `step`) and `PREFIX` (default `bin`) are overridable, and `CGO_OVERRIDE` (default `CGO_ENABLED=0`) can be flipped to `CGO_ENABLED=1` for CGO builds (`Makefile:10-22`).

## 3. Run the tests

`make test` is the day-to-day gate (short mode + coverage); `make race` for the race detector; `make lint` for the shared golangci-lint config + vulnerability scan. The user-facing integration suite lives in `integration/`, where `TestMain` registers the real command tree as the `step` testscript command (see the [Testing Strategy](/openwiki/testing-and-quality.md) page). The trivial entry points are `TestVersionCommand` and `TestBogusCommandFails` (`integration/main_test.go:9-19`).

## 4. First certificate, offline (no server needed)

`step ca init` generates a local PKI (root + intermediate + provisioner + `config.json`) in `./ca` (`command/ca/init.go:35-43,99-122`):

```console
$ step ca init \
    --name "example.com CA" \
    --dns internal.example.com \
    --address 127.0.0.1:9000 \
    --provisioner offline
```

Then `step ca certificate --offline` signs directly with those files — it never contacts a CA (`command/ca/certificate.go:76-89`; the flag is defined at `flags/flags.go:282-288`):

```console
$ step ca certificate --offline internal.example.com internal.crt internal.key
```

To skip the console prompts, pass the passwords and provisioner explicitly (`command/ca/certificate.go:82-90`):

```console
$ step ca certificate --offline \
    --password-file ./pass.txt \
    --provisioner foo \
    --provisioner-password-file ./provisioner-pass.txt \
    internal.example.com internal.crt internal.key
```

## 5. First certificate, online (against a running CA)

```console
# 1. Tell step about the CA: downloads the root, writes $STEPPATH/certs/root_ca.crt
#    and $STEPPATH/configs/defaults.json (url + fingerprint)
$ step ca bootstrap \
    --ca-url https://ca.example.com \
    --fingerprint d9d09786...c719f5097
    # add --install to also put the root in the system trust store

# 2. Mint a one-time token (OTT) for the identity
$ TOKEN=$(step ca token internal.example.com)

# 3. Request the certificate using the token
$ step ca certificate --token "$TOKEN" --not-after=1h \
    internal.example.com internal.crt internal.key
```

- `step ca bootstrap` stores the root and fingerprint in the step environment, after which the other `ca` commands no longer need `--ca-url`/`--root`/`--fingerprint` (`command/ca/bootstrap.go:17-63`).
- `step ca token` generates the OTT (`command/ca/token.go:25-27`); the combined `token` → `certificate --token` usage with `--not-after` is the documented happy path (`command/ca/certificate.go:70-73`).
- Constraint checks to know: `--offline` and `--token` are incompatible (`command/ca/certificate.go:239-242`), and `--token` and `--san` are mutually exclusive (`command/ca/certificate.go:282-283`).
- When the certificate is close to expiring, renew it: `step ca renew internal.crt` (with `--daemon` to keep renewing in the background, `--expires-in` to set the threshold, `--out` for the output path) (`command/ca/renew.go:45-47,177-214`).

For deeper flag reference and the offline CA internals, see the [certificate issuance flow](/openwiki/flows/certificate-issuance.md) and [offline CA](/openwiki/flows/offline-ca.md) pages.
