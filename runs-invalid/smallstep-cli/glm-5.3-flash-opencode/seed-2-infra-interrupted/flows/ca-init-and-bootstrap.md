---
type: ca-initialization-and-bootstrap
title: CA initialization and bootstrap
description: How step ca init generates a new PKI on disk (standalone, linked, hosted, RA/KMS variants) and how step ca bootstrap wires a client to an existing CA.
tags: [ca-init, bootstrap, pki-generation, deployment-types, kms]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:55:27.913Z
---

# CA initialization and bootstrap

Two commands establish a working environment. `step ca init` **creates** a PKI
(and optionally a step-ca configuration) on disk; `step ca bootstrap`
**connects to** an existing CA by downloading and verifying its root. Both are
thin orchestrations over the `smallstep/certificates` `pki` package and the CA
client SDK — see [Architecture and ownership
boundaries](/openwiki/architecture/overview.md) for that boundary and
[STEPPATH, defaults.json, and contexts](/openwiki/concepts/steppath-and-contexts.md)
for what ends up on disk.

## step ca init

The command (`command/ca/init.go:33-218`) validates a matrix of mutually
exclusive flags before doing anything (`command/ca/init.go:240-279`): `--root`
requires `--key` (existing PKI import); `--ra` must be `StepCAS` or `CloudCAS`;
`--kms` must be `azurekms` and cannot combine with `--ra`; `--pki` cannot
combine with `--no-db` or `--helm`; `--remote-management` and `--acme` both
require a database (no `--no-db`); and `--admin-subject` requires
`--remote-management`. It also asserts a working `crypto/rand` source before
proceeding (`command/ca/init.go:814-823`).

### Deployment types

`promptDeploymentType` (`command/ca/init.go:754-812`) resolves one of three
`pki.DeploymentType` values, either from `--deployment-type` or interactively:

- **Standalone** — a step-ca instance run by the operator; the default for
  backward compatibility when all non-interactive flags are present
  (`command/ca/init.go:764-768`, `720-752`).
- **Linked** — local keys plus Smallstep cloud services; configured with
  `pki.WithAdmin()` and OIDC as the first provisioner
  (`command/ca/init.go:609-610`, comment at `584-586`).
- **Hosted** — fully managed by Smallstep. The CLI cannot create one: `init`
  prints instructions to run `step ca bootstrap --team <name> --authority
  <authority>` and returns without doing anything
  (`command/ca/init.go:438-447`).

For registration-authority modes (`--ra`), hosted is excluded from the menu
(`command/ca/init.go:776-787`).

### RA and KMS branches

- **CloudCAS** (`command/ca/init.go:311-398`): prompts for either creating a
  new GCP CA pool (project, location, pool, tier, GCS bucket) or using an
  existing CA resource name; produces `apiv1.Options{Type: CloudCAS, ...}`.
- **StepCAS** (`command/ca/init.go:399-432`): prompts for the upstream CA URL,
  root fingerprint, and JWK provisioner; `IsCreator: false, IsCAGetter: true`,
  so the PKI is fetched from the RA rather than generated (`command/ca/init.go:701-704`).
- **KMS** (`command/ca/init.go:462-518`): with `--kms azurekms`, prompts for
  root/intermediate (and SSH host/user with `--ssh`) key URIs, validates the
  names via the KMS's `ValidateName` when supported, and passes
  `pki.WithKMS`/`pki.WithKeyURIs` plus a `KeyManager` into `SoftCAS` options.
  The `azurekms` implementation is enabled by a blank import
  (`command/ca/init.go:25`).

### PKI generation and output

Non-RA SoftCAS mode with `IsCreator: true` generates the hierarchy in-process
through the certificates module (`command/ca/init.go:672-712`): root
(`p.GenerateRootCertificate`, or a copy of an imported `--root` certificate —
the key is deliberately *not* copied into STEPPATH, `command/ca/init.go:683-691`),
intermediate, and optionally SSH user/host signing keys with `--ssh`. Flag
handling around passwords: `--provisioner-password-file` overrides the CA-key
password for provisioner key pairs (`command/ca/init.go:659-670`).

What gets appended to the `pki` options by deployment type
(`command/ca/init.go:597-633`):

| Condition | pki option |
| --- | --- |
| always (non-`--pki`) | address, ca-url, DNS names, deployment type |
| standalone | first JWK provisioner + super admin subject |
| linked (or `--remote-management`) | `WithAdmin()` |
| `--ssh` (non-linked) | `WithSSH()` |
| `--no-db` | `WithNoDB()` |
| `--helm` | `WithHelm()` (renders a Helm values YAML to stdout instead of saving, `command/ca/init.go:714-716`) |
| `--acme` + standalone | `WithACME()` — a default `acme` provisioner |

`--acme` with a linked deployment is explicitly rejected with guidance to add
the provisioner after init (`command/ca/init.go:448-454`). The final state is
persisted with `p.Save()` (`command/ca/init.go:717`).

**Non-interactive detection**: `isNonInteractiveInit` (`command/ca/init.go:720-752`)
requires `name` and `password-file` (or the RA-specific issuer flags) plus
`dns`, `address`, and `provisioner`; when satisfied, no prompts are shown and
the deployment type defaults to standalone.

### Context creation during init

Like bootstrap, `init` creates and activates a context when `UseContext` is
true — defaulting the context name to the first DNS name
(`command/ca/init.go:544-570`).

## step ca bootstrap

The command wrapper (`command/ca/bootstrap.go:85-112`) routes between flows:
`--team` (optionally with `--team-authority`) → `BootstrapTeamAuthority`;
otherwise `--ca-url` + `--fingerprint` are required → `BootstrapAuthority`.
`--team` is incompatible with `--ca-url` and `--fingerprint`.

### Team authority lookup

`BootstrapTeamAuthority` (`utils/cautils/bootstrap.go:226-294`) resolves
connection data from an HTTP API:

- Default endpoint: `https://api.smallstep.com/v1/teams/<team>/authorities/<teamAuthority>`
  (teamAuthority defaults to `ssh` when `--team` is used alone,
  `command/ca/bootstrap.go:100-102`).
- A custom `--team-url` replaces `<>` with the team name and is parsed as a URL
  (`utils/cautils/bootstrap.go:236-246`).
- The response (`bootstrapAPIResponse`) supplies `url`, `fingerprint`,
  `redirect-url`, `provisioner`, and `min-password-length`
  (`utils/cautils/bootstrap.go:28-34`). A `--redirect-url` flag overrides the
  API-provided value, and a default success URL is applied when neither is
  present (`utils/cautils/bootstrap.go:248-282`). Non-200 responses map 404 to
  "authority not found" and decode other errors from a JSON `apiError`
  (`utils/cautils/bootstrap.go:261-271, 333-355`).

### Common bootstrap path

`bootstrap` (`utils/cautils/bootstrap.go:98-222`) then, in order:

1. Creates an *insecure* CA client (`ca.WithInsecure()` — there is no root yet)
   and fetches the root certificate by fingerprint via `client.Root`, which
   validates the certificate chain against that fingerprint
   (`utils/cautils/bootstrap.go:104-113`). Nothing is written until this
   succeeds.
2. Creates/activates a context when `UseContext` is true (default context name
   `<teamAuthority>.<team>` or the CA URL hostname; see [STEPPATH, defaults.json,
   and contexts](/openwiki/concepts/steppath-and-contexts.md)), otherwise prints
   the contexts advisory warning.
3. Writes `$STEPPATH/certs/root_ca.crt` (0600) and defaults.json (0644) with
   the CA URL normalized to https via `utils.CompleteURL`
   (`utils/cautils/bootstrap.go:145-195`, `utils/utils.go:28-61`).
4. With contexts enabled, creates the profile defaults file if missing.
5. With `--install`, installs the root into the system truststore via
   `truststore.InstallFile` (`utils/cautils/bootstrap.go:212-219`).

Because defaults.json and the context point at the CA, subsequent CA commands
resolve `--ca-url`, `--root`, and `--fingerprint` automatically (see
[STEPPATH, defaults.json, and contexts](/openwiki/concepts/steppath-and-contexts.md)).

## Failure behavior

- Init fails fast on the flag-compatibility matrix and crypto/rand availability
  before any prompts or writes (`command/ca/init.go:220-279, 814-823`).
- Bootstrap performs no local writes if the root fetch/verification fails
  (`utils/cautils/bootstrap.go:104-113`).
- Team bootstrap distinguishes "authority not found" (404) from other API
  errors and surfaces the API's JSON error message
  (`utils/cautils/bootstrap.go:261-271`).

## Representative tests

There are no unit tests for `step ca init`'s PKI generation in this repository
(the PKI machinery lives in `smallstep/certificates`); `command/ca/init_test.go`
exists and covers helper logic, and the bootstrap flow's helpers are covered
indirectly by flow tests (`utils/cautils/token_flow_test.go`). State what a
change to these commands affects by reading the referenced code paths directly.

## Uncertainty

- The precise files and templates `pki.New(...).Save()` writes (ca.json,
  certificates, keys, templates) are owned by `smallstep/certificates`; this
  repository establishes only the options it passes.
- Hosted deployments' connection details (beyond the printed bootstrap
  instruction) and the api.smallstep.com API contract beyond the decoded
  `bootstrapAPIResponse` fields are not established in this codebase.
