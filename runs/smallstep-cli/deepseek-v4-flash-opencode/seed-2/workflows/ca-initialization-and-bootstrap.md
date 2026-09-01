---
type: workflow
title: CA Initialization and Bootstrap
description: How step ca init generates a PKI and CA configuration (deployment types, RA modes, KMS), and how step ca bootstrap downloads and trusts a CA's root and writes the environment defaults.
tags: [workflow, ca, init, bootstrap, pki]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# CA Initialization and Bootstrap

These two commands establish the trust relationship between a user and a
certificate authority: `step ca init` builds a brand-new PKI (and the step-ca
configuration that serves it), while `step ca bootstrap` connects to an existing
CA and stores the root + defaults needed to talk to it.

## step ca init

`initAction` (command/ca/init.go:220-718) is interactive-first but supports
fully non-interactive runs when the required flags are present.

### Precondition and validation

It starts by asserting a cryptographically secure RNG (`assertCryptoRand`), then
runs a battery of flag-compatibility checks (command/ca/init.go:240-279):

- `--root` and `--key` must be provided together (existing root CA material).
- `--ra` must be `StepCAS` or `CloudCAS`; `--kms` must be `azurekms`.
- `--kms` and `--ra` are mutually exclusive.
- `--pki` conflicts with `--no-db` and `--helm`.
- `--remote-management` and `--acme` each require a DB configuration
  (conflict with `--no-db`).
- `--admin-subject` is rejected with `--helm` and requires
  `--remote-management`.

Passwords are read from `--password-file` / `--provisioner-password-file` or
prompted (and optionally generated) later.

### Deployment types

`promptDeploymentType` (command/ca/init.go:754-812) offers **Standalone**,
**Linked**, and **Hosted**. When the run is non-interactive
(`isNonInteractiveInit`) it silently assumes **Standalone** for backward
compatibility. RAs only support standalone and linked. Hosted prints
instructions to run `step ca bootstrap --team <name> --authority <authority>`.

### Registration authority (RA) branches

Depending on `--ra`, the CLI collects different configuration and builds
`casOptions`:

- **CloudCAS** (Google Certificate Authority Service): prompts for a new PKI
  (name, org, resource id, GCP project/location/CA pool/tier, GCS bucket) or an
  existing CA resource name; passes `credentials-file` for a service account.
- **StepCAS**: an RA in front of an upstream step-ca — prompts for the upstream
  CA URL, root fingerprint, and JWK provisioner name, with `IsCAGetter: true`.
- **SoftCAS** (default): prompts for the PKI name and, when `--kms azurekms` is
  set, for root/intermediate/SSH key URIs, building a `kms.KeyManager`
  (command/ca/init.go:464-518).

### Option assembly and generation

`pkiOpts` are built from flags: DNS names, listen address, CA URL,
deployment type, first provisioner (standalone only), first super-admin subject
(standalone), `WithAdmin()` for linked deployments or `--remote-management`,
`WithSSH()`, `WithNoDB()`, `WithHelm()`, and `WithACME()` for a default ACME
provisioner (standalone only). Context creation happens here when contexts are
enabled (see "STEPPATH Environment and Contexts").

The heavy lifting is delegated to the certificates library:
`pki.New(casOptions, pkiOpts...)`, then `GenerateKeyPairs`, (for creators)
`GenerateRootCertificate` + `GenerateIntermediateCertificate` (or copying an
existing root), optional `GenerateSSHSigningKeys`, and finally
`WriteHelmTemplate` (with `--helm`) or `p.Save()` which writes `ca.json` and
the certs/keys. Existing root/key material is copied without re-generating keys.

## step ca bootstrap

`bootstrapAction` (command/ca/bootstrap.go:85-112) dispatches:

- `--team` + `--ca-url` or `--fingerprint` → error (mutually exclusive).
- `--team` + `--team-authority` → `BootstrapTeamAuthority(ctx, team, authority)`.
- `--team` alone → `BootstrapTeamAuthority(ctx, team, "ssh")`.
- `--team-authority` without `--team` → error.
- Otherwise `--ca-url` + `--fingerprint` → `BootstrapAuthority`.

### Trust-on-first-use

`bootstrap` (utils/cautils/bootstrap.go:98-222) establishes trust:

1. Builds a client with `ca.WithInsecure()` and calls `client.Root(fingerprint)`.
   The root download is **validated against the fingerprint**, so
   `WithInsecure` only skips TLS pinning, not the fingerprint check.
2. When contexts are enabled (or `--context`/`--authority`/`--profile` are set)
   it creates and selects the context; otherwise it prints a context warning.
3. Writes the root certificate to `pki.GetRootCAPath()` (`0600`) and
   `defaults.json` to `step.DefaultsFile()` (`0644`) with `ca-url`,
   `fingerprint`, `root`, and optional `redirect-url`/`provisioner`/
   `min-password-length`.
4. With `--install` it installs the root into the system truststore via
   `truststore.InstallFile`.
5. When contexts are enabled it also ensures the profile defaults file exists.

After bootstrap, `--ca-url`, `--root`, and `--fingerprint` are optional because
commands resolve them from defaults.json and the default root path.

### Team bootstrap

`BootstrapTeamAuthority` (utils/cautils/bootstrap.go:226-294) fetches
`https://api.smallstep.com/v1/teams/<team>/authorities/<authority>` (or a
custom `--team-url` with `<>` replaced by the team ID) and parses the
`bootstrapAPIResponse` (`url`, `fingerprint`, `redirect-url`, `provisioner`,
`min-password-length`). It applies the returned provisioner and minimum
password length as bootstrap options, defaults the context name to
`<teamAuthority>.<team>`, and then runs the standard `bootstrap`. A default
redirect URL (`https://smallstep.com/app/teams/sso/success`) is used when the
API does not provide one.
