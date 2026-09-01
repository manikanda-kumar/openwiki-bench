---
type: core-concept
title: "CA Administration, ACME, and OAuth"
description: "The step ca command group (init, health, provisioner/admin CRUD via the management API, ACME issuance and EAB, policy), the hidden step api group, and the step oauth authorization-code/device/JWT-bearer flows."
tags: [ca-commands, acme, eab, oauth, admin-api, step-ca]
---

# CA Administration, ACME, and OAuth

## The `step ca` surface

`command/ca` registers one top-level group whose subcommands span two very
different integration planes (command/ca/ca.go:68-86):

- **End-entity operations** that use provisioning tokens and the ACME protocol:
  `token`, `certificate`, `renew`, `rekey`, `revoke`, `sign`, `bootstrap`,
  `root`/`roots`, `federation`, `health`.
- **Management operations** that require admin credentials against the step-ca
  management API: `provisioner` (add/list/remove/update, with a `webhook`
  subgroup), `admin` (add/list/remove/update), `acme eab`, `policy`.

`step beta ca` re-exposes only the `acme` group while it is still considered
beta (command/ca/ca.go:160-169 and command/beta/beta.go:11-24).

The `--acme` flag (ca.go:171-177) lets an issuance command point at any ACME
directory URL; when absent and an ACME provisioner was selected, the directory
is derived as `<ca-url>/acme/<provisioner-name>/directory`
(utils/cautils/acmeutils.go:656-664), and `--contact` supplies ACME account
contacts.

## `step ca init` — delegating PKI creation

`initCommand` (command/ca/init.go) collects flags (address, ca-url, DNS names,
existing root/intermediate, KMS URIs, provisioners, SSH enablement, context
name) and then delegates the actual material generation to the external
`smallstep/certificates/pki` package, configured through option functions:

- Deployment types are modeled as `pki.DeploymentType` —
  `StandaloneDeployment`, `LinkedDeployment`, `HostedDeployment` — and select
  different option stacks, e.g. linked/hosted get `pki.WithAdmin()` while
  standalone gets `pki.WithProvisioner(...)` and an optional default ACME
  provisioner (init.go:308-309, 438-452, 598-631).
- KMS-backed keys are passed via `pki.WithKMS(kmsName)` plus
  `pki.WithKeyURIs(root, intermediate, sshHost, sshUser)` (init.go:516-517).
- `pki.WithPKIOnly()`, `pki.WithNoDB()`, `pki.WithHelm()`, `pki.WithSSH()`
  cover container/managed deployments (init.go:531, 612-618).
- When contexts are enabled the flow adds and activates a context named by
  `--context` (init.go:557-567).

How `pki` lays down `ca.json`, key directories, and databases is internal to
`smallstep/certificates`; this repository only assembles the options.

## Management plane: provisioners and admins

Provisioner and admin commands build a client through cautils:
`provisioner.go` first creates an *unauthenticated* admin client and calls
`IsEnabled()` as a probe, and only then constructs the authenticated
`cautils.NewAdminClient` (command/ca/provisioner/provisioner.go:106-128), which
performs the admin x5c flow described in
[CA client integration](/openwiki/architecture/ca-client-integration.md).
Admin resources are `linkedca.Admin` protobuf types translated to CLI rows
(command/ca/admin/admin.go:74-96), and `step ca admin add <subject>
<provisioner> --super` binds an admin to a provisioner.

`step ca acme eab` manages ACME External Account Binding keys through the same
admin client: `CreateExternalAccountKey`, `GetExternalAccountKeysPaginate`,
and `RemoveExternalAccountKey` against the management API
(command/ca/acme/eab/add.go:78, list.go:137, remove.go:68); the HMAC key is
rendered base64url (eab/eab.go:28-40). The `--eab-key-id`/
`--eab-key-reference` flags then appear on issuance and policy commands to act
as (or scope to) the bound ACME account.

## ACME issuance flow

When `step ca certificate` detects an ACME provisioner (via
`ACMETokenError`), it calls `cautils.ACMECreateCertFlow`
(command/ca/certificate.go:259-264, utils/cautils/acme_flow.go:14-39).
`newACMEFlow` enforces the ACME-mode invariants (utils/cautils/acmeutils.go:625-665):

- `--offline` and ACME are mutually exclusive.
- Exactly one of `--standalone`/`--webroot` may be given; if neither is set,
  standalone is implicitly enabled.
- SANs default to the subject.

`GetCertificate` runs the RFC 8555 dance via the external `ca.ACMEClient`
(acmeutils.go:710-800): new order → `authorizeOrder` → generate or reuse a key
and CSR → finalize → download. Two challenge types are implemented in this
repository (acmeutils.go:211-228):

- **http-01**: standalone mode serves
  `/.well-known/acme-challenge/<token>` from a temporary HTTP server
  (acmeutils.go:47-113); webroot mode writes the key authorization file under
  `<dir>/.well-known/acme-challenge` and removes it afterwards
  (acmeutils.go:115-157).
- **device-attest-01**: with `--attestation-uri tpmkms:...`, the order requests
  a `permanent-identifier` instead of DNS SANs (acmeutils.go:727-740) and the
  TPM attestation flow in `utils/cautils/tpm.go` answers the challenge; the
  resulting TPM-backed signer is used for the CSR (acmeutils.go:782-796).

Client trust uses `getClientTruststoreOption` (acmeutils.go:668-707): an
explicit `--root`, else the STEPPATH root file if present; when an explicit
`--acme` URL is used the local root is *merged* with the system pool (TLS 1.2
minimum), otherwise the root file alone is trusted, falling back to the system
store. ACME account keys are created and managed inside `ca.NewACMEClient`
(external); this repository does not establish their on-disk location.

## Health, roots, federation

`step ca health` is the simplest client use: resolve `--ca-url` and root
(default `pki.GetRootCAPath()`), then `caClient.HealthWithContext`
(command/ca/health.go:70-83). `root`/`roots`/`federation` download root
certificates (validated by fingerprint) and federated roots; `bootstrap` runs
the fingerprint-validated trust acquisition flow
([CA client integration](/openwiki/architecture/ca-client-integration.md)).

## `step api` and `step oauth`

`step api` is a **hidden** group for authenticating to the Smallstep
(SaaS) API; its `token` subcommand is the only member
(command/api/api.go:11-25).

`step oauth` implements the OAuth 2.0 flows in one command
(command/oauth/cmd.go):

- By default it uses a **preconfigured Google client**; custom clients combine
  `--client-id`, `--client-secret`, and `--provider` pointing at the OIDC
  discovery document (cmd.go:104-120). The provider must be `google`,
  `github`, or an https URL (cmd.go:330-333).
- The standard flow is **authorization code with a local callback listener**
  (`--listen`, `--listen-url`, `--redirect-url`); the token exchange posts the
  code to the token endpoint and receives access **and refresh tokens**
  (cmd.go:838, 1234).
- For input-constrained clients, `--console` enables the **Device
  Authorization Grant (RFC 8628)** by default (with a hardcoded Google device
  client and 5s polling interval) and `--console-flow oob` switches to the
  deprecated **OOB** `urn:ietf:wg:oauth:2.0:oob` callback
  (cmd.go:54-63, 190-205, 309-313, 576).
- **Two-legged (Google service account) mode** is selected by `--account`
  pointing at a JSON file with `"type": "service_account"`; then
  `DoTwoLeggedAuthorization` signs an RS256 assertion (iss + scope, kid =
  private_key_id, one-hour validity) with the account's private key and POSTs
  it to the token endpoint as the `assertion` parameter with grant type
  `urn:ietf:params:oauth:grant-type:jwt-bearer`, while adding `--jwt` instead
  returns the freshly signed JWT itself via `DoJWTAuthorization` (iss/sub =
  client_email) without contacting any endpoint
  (cmd.go:430-460, 496-502, 983-1043, 1046-1095).
- Output shaping: `--bare` prints the raw token, `--oidc` prints the ID token
  instead of the access token, `--header` includes the Authorization header
  (cmd.go:83-102). This is the same entry point that the OIDC provisioner token
  flow shells out to via `exec.Step`.

## Uncertainties

- The management API wire format is defined by `smallstep/certificates` and
  `linkedca`; only the client-side calls are visible here.
- ACME account key persistence lives in the external ACME client and is not
  established by this repository.
