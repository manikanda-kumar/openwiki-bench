---
type: "Reference"
title: "Step CLI quickstart"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# Step CLI quickstart

`step` is a CLI for building, operating, and automating PKI and crypto
workflows, and a client for step-ca (README.md:12-14). This page gets you from
a checkout to running commands; see the linked pages for depth.

## Build

```
make build
bin/step version
```

`make build` produces `bin/step` with the version/commit injected via
`-ldflags` (Makefile:126-132). For a release-parity build use
`make goreleaser`. Cross-compile targets like `binary-linux-amd64` and
`binary-windows-amd64` are available (Makefile:204-235).

## Configuration: STEPPATH

Commands read configuration from the step path (default `$HOME/.step`,
overridable with the `STEPPATH` environment variable):

- `step path` prints the current (context-aware) step path; `step path --base`
  prints the base directory; `step path --profile` prints the active profile
  path (`command/path/path.go:17-103`).
- The CA configuration lives at `$STEPPATH/config/ca.json`, defaults at
  `$STEPPATH/config/defaults.json`, and the root certificate at
  `$STEPPATH/certs/root_ca.crt` (see
  [CA client and enrollment flows](architecture/ca-client-flows.md)).
- Contexts select between authorities: `step context select <name>`,
  `step context list` (`command/context/context.go:15-56`).

## Local crypto and certificates (no CA needed)

Create a self-signed root, then inspect it:

```
step certificate create root-ca root-ca.crt root-ca.key --profile root-ca
step certificate inspect root-ca.crt
step certificate fingerprint root-ca.crt
```

Create a leaf signed by that root, and verify:

```
step certificate create foo foo.crt foo.key --ca root-ca.crt --ca-key root-ca.key
step certificate verify foo.crt --roots root-ca.crt
```

Crypto plumbing:

```
step crypto jwt sign --key priv.jwk --iss joe@example.com --aud https://example.com --sub auth --exp $(date -v+1M +%s)
step crypto kdf hash            # scrypt by default; --alg bcrypt|argon2i|argon2id
```

See [step certificate command group](commands/certificate.md) and
[step crypto command group](commands/crypto.md). Help (`step crypto -h`) also
documents the security considerations and safe defaults.

## Working with a step-ca

**Initialize a new standalone CA** (interactive; prompts for name, DNS,
address, provisioner, and passwords):

```
step ca init
```

This writes `ca.json`, the root/intermediate certificates, and provisioner
keys under `$STEPPATH` (`command/ca/init.go:46-47`, `220-718`).

**Connect to an existing CA** using a root fingerprint:

```
step ca bootstrap --ca-url https://ca.example.com \
  --fingerprint <root-fingerprint>
```

This writes the root certificate and `defaults.json`
(`utils/cautils/bootstrap.go:98-222`).

**Get a certificate from the CA**:

```
TOKEN=$(step ca token internal.example.com)
step ca certificate internal.example.com internal.crt internal.key --token "$TOKEN"
```

With `--offline` (using the `ca.json` created by `step ca init`) no network is
needed:

```
step ca certificate --offline internal.example.com internal.crt internal.key
```

**Renew and revoke**:

```
step ca renew internal.crt internal.key
step ca revoke --reason "laptop compromised" <serial-number>
```

**Using an ACME CA** (e.g. Let's Encrypt):

```
step ca certificate foo.example.com foo.crt foo.key \
  --acme https://acme-v02.api.letsencrypt.org/directory
```

See [step ca command group](commands/ca.md) for the full command tree
(provisioner/admin/policy management) and
[CA client and enrollment flows](architecture/ca-client-flows.md) for how the
flows work internally.

## SSH certificates

With a CA that has SSH enabled:

```
step ssh login alice            # signs a user cert and adds it to the agent
step ssh certificate --host internal.example.com ssh_host_ecdsa_key
step ssh list                   # list agent identities
step ssh inspect <cert>.pub     # inspect an SSH certificate
```

`step ssh login` requires a running SSH agent
(`command/ssh/login.go:154-159`). See
[step ssh command group and SSH utilities](commands/ssh.md).

## Where to go next

- [Architecture overview](architecture/overview.md) — repository map and command groups.
- [CLI runtime, flag system, and error handling](architecture/cli-runtime.md) — plugins, STEPDEBUG, flags.
- [Provisioning tokens](architecture/tokens-and-provisioners.md) — the token model used by CA flows.
- [Testing strategy](development/testing.md) and [adding a command](guides/adding-a-command.md) — for contributors.
- [Build, packaging, and release](operations/build-and-release.md) — release pipeline and systemd renewal units.
