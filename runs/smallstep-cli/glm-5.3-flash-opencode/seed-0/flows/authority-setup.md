---
type: workflow-page
title: Authority Setup - ca init and ca bootstrap
description: End-to-end flows for standing up a new PKI with step ca init and connecting a client to an existing authority with step ca bootstrap.
tags: [ca-init, ca-bootstrap, pki, deployment-types, cas, teams]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

Two commands establish an authority relationship: `step ca init` creates a new PKI
(and its configuration), and `step ca bootstrap` connects a client machine to an
existing authority. Both write into the `$STEPPATH` state model described by the
configuration page.

## step ca init: create a PKI

`initAction` (command/ca/init.go:220-718) is an interactive wizard with
non-interactive escape hatches. Its phases:

### 1. Validation and inputs

- The crypto-random source is asserted before anything else (`assertCryptoRand`,
  init.go:221-223) — init refuses to run on a system without a usable
  `crypto/rand`.
- Cross-flag invariants are checked as guard clauses: `--root` requires `--key`
  and vice versa (init.go:241-244), `--ra` accepts only `StepCAS` or `CloudCAS`
  (init.go:256-257), `--kms` accepts only `azurekms` (init.go:258-259), `--kms`
  and `--ra` are mutually exclusive (init.go:260-261), and `--pki` cannot combine
  with `--no-db`/`--helm` (init.go:262-265). `--remote-management` and `--acme`
  both require a database configuration, so they are incompatible with `--no-db`
  (init.go:266-271); `--admin-subject` requires `--remote-management`
  (init.go:272-278).
- Passwords come from `--password-file` (CA keys) and
  `--provisioner-password-file` (provisioner key), read via the utils password
  readers (init.go:281-297). When the provisioner password file is absent, the CA
  key password is reused for provisioner keys.
- Context mode is detected via `cautils.UseContext` and warned otherwise
  (init.go:299-302).

### 2. Selecting the CAS backend

A `switch` over the lowercase `--ra` value assembles `apiv1.Options`
(init.go:306-528):

- **CloudCAS** (init.go:311-398): prompts deployment type, then either collects a
  full new-PKI spec (org, resource, GCP project/location/CA pool/tier/GCS bucket,
  each with regex-validated prompts) or an existing certificate authority resource
  name; `IsCreator` distinguishes the two.
- **StepCAS** (init.go:399-432): prompts for the upstream CA URL (must be https),
  the root fingerprint (64 hex chars), and the JWK provisioner name; this mode is
  `IsCAGetter: true` — init will fetch the root from the upstream CA rather than
  create keys.
- **Default SoftCAS** (init.go:433-527): prompts deployment type; the hosted type
  short-circuits with instructions to use `step ca bootstrap --team` instead of
  initializing (init.go:438-447); `--acme` is rejected for non-standalone
  deployments with a pointer to `step ca provisioner add acme --type ACME`
  (init.go:448-454). With `--kms azurekms`, per-key URIs (root, intermediate, SSH
  host, SSH user) are prompted and validated by the KMS implementation's
  `ValidateName`, becoming `pki.WithKMS`/`pki.WithKeyURIs` options
  (init.go:462-518). The result is `apiv1.Options{Type: SoftCAS, IsCreator: true}`
  (init.go:523-527).

The deployment type (`standalone`/`linked`/`hosted`, documented in the flag usage
at init.go:75-97) is prompted by `promptDeploymentType` with per-RA behavior
(forced prompt under RAs, skipped detection otherwise).

### 3. Configuration options

Unless `--pki` (generate PKI material only, `pki.WithPKIOnly` at init.go:530-531),
init collects the CA's DNS names (init.go:532-543) and listen address, registers
the new context (name defaults to the first DNS name) and saves it as current when
context mode applies (init.go:544-570), and assembles `pki` options: address, CA
URL (`--with-ca-url` is what gets written into defaults.json per the flag doc at
init.go:123-126), DNS names, deployment type, provisioner name + super-admin
subject (standalone only, init.go:603-608), admin API for linked or
`--remote-management` (init.go:609-627), SSH signing keys (`--ssh`), no-database,
Helm output, and a default ACME provisioner for standalone+`--acme`
(init.go:629-633).

### 4. Key generation and persistence

- `pki.New(casOptions, pkiOpts...)` constructs the PKI object (init.go:649-652);
  the password is prompted (`ui.PromptPasswordGenerate`, allowing empty to
  auto-generate) at init.go:654-657.
- For standalone non-PKI-only deployments, provisioner key pairs are generated
  with the provisioner password (init.go:659-670).
- With `IsCreator` (SoftCAS/CloudCAS-create): the root is either generated
  (`p.GenerateRootCertificate`) or copied from `--root` (the key is not copied
  into STEPPATH, init.go:683-691), and the intermediate is always generated
  (init.go:693-700). For RA modes that fetch (`IsCAGetter`), the root comes from
  `p.GetCertificateAuthority()` (init.go:701-704).
- `--ssh` generates the user and host SSH signing keys (init.go:706-712);
  `--helm` writes the Helm values template to stdout instead of saving locally
  (init.go:714-716); otherwise `p.Save()` persists the full directory layout
  (init.go:717).

**Ownership boundary:** the physical file layout (certs, secrets, templates, DB
configuration) is written by `pki.Save()` in the external
`github.com/smallstep/certificates/pki` package — not by this repository. What this
repository establishes is the option assembly, the `--with-ca-url` → defaults.json
link, and the context registration.

`isNonInteractiveInit` (init.go:720-752) defines which flag combinations suppress
the interactive prompts, varying the required flags per RA type; the deployment
type prompt itself lives at init.go:754+.

## step ca bootstrap: connect to an existing authority

`bootstrapAction` (command/ca/bootstrap.go:85-112) selects one of two flows by
flag combination: `--team` (optionally with `--team-authority`) routes to
`cautils.BootstrapTeamAuthority`, otherwise `--ca-url` + `--fingerprint` are
required and route to `cautils.BootstrapAuthority` (bootstrap.go:94-111). `--team`
is incompatible with `--ca-url` and `--fingerprint` (bootstrap.go:95-98).

### Team flow

`BootstrapTeamAuthority` (utils/cautils/bootstrap.go:226-294) resolves authority
metadata from an HTTP endpoint: by default
`https://api.smallstep.com/v1/teams/<team>/authorities/<authority>`, or a custom
`--team-url` where `<>` is replaced by the team name (bootstrap.go:227-246). The
response (`bootstrapAPIResponse`, bootstrap.go:28-34) carries `url`,
`fingerprint`, `redirect-url`, `provisioner`, and `min-password-length`; a
`--redirect-url` flag overrides the returned redirect URL, which itself defaults
to the Smallstep SSO success page when empty (bootstrap.go:248-281). The context
name defaults to `<authority>.<team>` (bootstrap.go:283-286).

### Common bootstrap core

Both flows converge on `bootstrap()` (utils/cautils/bootstrap.go:98-222), which:

1. Fetches and validates the root by fingerprint (`client.Root(fingerprint)` under
   an insecure transport — the fingerprint check is the trust anchor,
   bootstrap.go:104-113).
2. In context mode, registers the context (`--context`/`--authority`/`--profile`
   with defaults from the flow) and saves/sets it as current
   (bootstrap.go:115-144); without contexts it warns that contexts exist.
3. Writes the root to `pki.GetRootCAPath()` (`$STEPPATH/certs/root_ca.crt`, mode
   0600, directories 0700) and the `bootstrapConfig` to `step.DefaultsFile()`
   (mode 0644) with the https-normalized CA URL (bootstrap.go:145-195; struct and
   JSON keys at bootstrap.go:89-96).
4. Puts `ca-url`/`fingerprint`/`root` into the CLI context so the invoking command
   can proceed without re-reading (bootstrap.go:187-189).
5. Creates the profile-scoped defaults file `{}` for context-enabled setups when
   absent (bootstrap.go:197-210).
6. Installs the root into the system trust store when `--install` is set
   (bootstrap.go:212-219).

`BootstrapAuthority` (utils/cautils/bootstrap.go:297-317) derives the context name
from the CA URL host (or `--authority`) and applies any `--redirect-url`.

The net effect, per the command help: after bootstrap, `step ca` commands need
neither `--ca-url`, `--root`, nor `--fingerprint` for that environment
(command/ca/bootstrap.go:32-33).

## Failure behavior

- Init fails fast on invalid flag combinations and on a missing crypto/rand source;
  interactive inputs are validated per-field (regex validators shown above), so a
  bad answer re-prompts rather than producing a broken PKI.
- Bootstrap's root download is the trust moment: it fails (wrapped as "error
  downloading root certificate") if the CA's root does not match the given
  fingerprint, so a wrong fingerprint fails closed (bootstrap.go:110-113). Team
  flow HTTP failures distinguish 404 ("authority not found") from other errors and
  decode the API's error JSON (bootstrap.go:266-271, 333-355).

## Representative tests

These flows are UI-heavy and are not covered by the unit test suite in this
repository; their persistence effects are best verified through the configuration
page's `step path`/`step context` introspection commands. The repository states no
automated test for init/bootstrap paths beyond flag validation; treat
end-to-end behavior claims here as source-derived rather than test-verified.
