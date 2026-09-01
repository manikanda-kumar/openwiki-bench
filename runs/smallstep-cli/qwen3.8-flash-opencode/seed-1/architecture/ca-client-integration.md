---
type: architecture
title: "CA Client Integration (Online and Offline)"
description: "How step CLI talks to a step-ca server: the CaClient abstraction in utils/cautils, online vs embedded-offline authority clients, admin x5c clients, bootstrap/defaults persistence, and TPM attestation integration."
tags: [architecture, ca-client, offline-ca, bootstrap, tpm, step-ca]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:10:44.156Z
---

# CA Client Integration (Online and Offline)

`utils/cautils` is the boundary layer between `step` commands and a certificate
authority. Every command that signs, renews, or revokes through a CA constructs
its client here instead of importing `github.com/smallstep/certificates/ca`
directly, so the same command code works against an online `step-ca` server or
an embedded offline authority.

## The CaClient abstraction

`CaClient` (utils/cautils/client.go:29-48) is an interface covering the CA
operations the CLI needs: `Sign`, `Renew`, `RenewWithToken`, `Revoke`, `Rekey`,
the `SSH*` equivalents, `Version`, `GetRootCAs`, and `GetCaURL`. Two
implementations satisfy it:

- the online client from the external `smallstep/certificates/ca` package, and
- `OfflineCA`, which embeds the `certificates/authority` package in-process.

`NewClient` (utils/cautils/client.go:52-74) selects between them based on the
`--offline` boolean flag:

- Offline: `--ca-config` is mandatory (default `$(step path)/config/ca.json`,
  see flags/flags.go:290-296) and `NewOfflineCA` is returned.
- Online: the `ca-url` flag is parsed via `flags.ParseCaURL`, and `--root`
  falls back to `pki.GetRootCAPath()` (the STEPPATH root CA file). If neither
  exists, a `root` required-flag error is returned. The client is then built
  with `ca.NewClient(caURL, ca.WithRootFile(root))`.

`flags.ParseCaURL` (flags/flags.go:645-706) enforces HTTPS-only CA URLs: a
missing scheme is assumed `https`, any other scheme is rejected, and bare IPv6
hosts are repaired into bracketed form (`[::1]:8443`) so `net.SplitHostPort`
parsing succeeds. The same IPv6 care appears on the offline side: `OfflineCA`
builds its URL from the first entry of `config.DNSNames` and wraps bare IPv6
addresses in brackets with `toHostname` (utils/cautils/offline.go:84-86,
601-607).

## The embedded OfflineCA

`OfflineCA` (utils/cautils/offline.go:30-81) wraps an
`authority.Authority` built from the JSON config in `ca.json`:

- It is a **singleton** (`offlineInstance`): the first `NewOfflineCA` result is
  reused. The comment states this avoids double initialization that can fail on
  storage locks (e.g. BadgerDB) — relevant when one command signs several
  certificates (offline.go:36-45).
- The config must parse and contain at least one provisioner
  (offline.go:57-59).
- `--password-file` populates `cfg.Password` so encrypted key material
  referenced by `ca.json` can be loaded (offline.go:61-68).
- Methods like `Sign` (offline.go:196-222) set a provisioner method on the
  context (`provisioner.NewContextWithMethod`), call `authority.Authorize` on
  the one-time token, then sign via the authority and repackage the chain into
  the same `api.SignResponse` shape the online client returns.
- `Revoke` accepts either an OTT or an mTLS round-tripper: with no `req.OTT`
  the leaf certificate is extracted from the TLS client config and the revoke
  is marked `MTLS: true` (offline.go:279-313). Several methods note "it should
  not panic as this is always internal code" when casting the
  `http.RoundTripper` — this coupling to `http.Transport` is an internal
  contract between cautils callers and these wrappers.
- `Audience(tokType)` maps token types to offline audience paths such as
  `https://<host>/sign`, `/renew`, `/ssh/revoke` (offline.go:141-158), mirroring
  the online audience mapping in `utils/cautils/token_flow.go` (see the tokens
  page).
- `GenerateToken` (offline.go:538-599) reads provisioners straight from the
  parsed `ca.json` and dispatches per provisioner type (JWK, X5C, SSHPOP,
  Nebula, K8sSA, OIDC, AWS/GCP/Azure identity, ACME/SCEP rejection), the same
  taxonomy used by the online token flow.

Command flows consume this directly: `step ca revoke` and `step ca renew`
construct `cautils.NewOfflineCA` themselves when `--offline` is set
(command/ca/revoke.go:293-324, command/ca/renew.go:448-455), while
`step ca certificate` goes through `cautils.NewCertificateFlow` and falls back
to an ACME flow when the selected provisioner is ACME
(command/ca/certificate.go:251-264).

## Admin clients and x5c credentials

Management-API commands use `ca.AdminClient` (external package), constructed in
cautils:

- `NewUnauthenticatedAdminClient` (utils/cautils/client.go:77-96) resolves
  `ca-url`/`root` the same way but attaches no credentials.
- `NewAdminClient` (utils/cautils/client.go:99-204) requires `--admin-cert` and
  `--admin-key` together (checked with `errs.RequiredWithFlag`); they are read
  as a PEM bundle + key and attached via `ca.WithAdminX5C(adminCert, adminKey,
  password-file)`, which puts the certificate chain in the JWT `x5c` header.
- If no admin credentials are given, the CLI prompts for an admin subject,
  generates an ephemeral key **in memory**, creates a CSR, runs the standard
  token flow (`NewTokenFlow` with `SignType`), and signs the admin certificate
  through the ordinary CA client before building the x5c admin client
  (client.go:136-197). No admin key is written to disk in this path.

## Bootstrap: acquiring trust material

`bootstrap` (utils/cautils/bootstrap.go:98-222) is the flow behind
`step ca bootstrap` and team bootstrapping:

1. It creates an **insecure** online client (`ca.WithInsecure`) because no
   trusted root exists yet, then calls `client.Root(fingerprint)`, which
   validates the downloaded root against the expected fingerprint.
2. If contexts are in play (`UseContext`: contexts enabled or
   `--context/--authority/--profile` set, bootstrap.go:37-42) a new context is
   added and made current; otherwise `WarnContext` prints an advisory when a
   legacy `$(step path --base)/config/ca.json` exists (bootstrap.go:46-54).
3. The root is serialized to `pki.GetRootCAPath()` (mode 0600) and a
   `defaults.json` (path from the external cli-utils `step.DefaultsFile()`) is
   written containing `ca-url`, `fingerprint`, and `root`; the live CLI context
   is also updated with those values so later flags resolve them
   (bootstrap.go:145-195).
4. With `--install`, the root is added to the system trust store via
   `smallstep/truststore` (bootstrap.go:212-219).

`BootstrapTeamAuthority` (bootstrap.go:226-294) fetches authority metadata
(`url`, `fingerprint`, optional `redirect-url`, `provisioner`,
`min-password-length`) over HTTPS from `api.smallstep.com/v1/teams/<team>/authorities/<authority>`
by default, or from a `--team-url` endpoint in which `<>` placeholders are
replaced with the team ID; API errors ≥400 are decoded into a structured
`apiError`. `BootstrapAuthority` (bootstrap.go:297-317) bootstraps a plain
CA URL + fingerprint, deriving the context name from the URL host.

## TPM device attestation

`utils/cautils/tpm.go` implements the ACME device-attestation challenge used by
`step ca certificate --attestation-uri tpmkms:...`
(acme_flow.go shows `ACMECreateCertFlow` and the attestation-key signer
handoff):

- `parseTPMAttestationURI` requires the `tpmkms:` scheme and a `name`
  parameter (tpm.go:199-216).
- An Attestation Key (AK) is looked up (or created) under the hex fingerprint
  of the preferred EK — RSA preferred, ECDSA fallback (tpm.go:224-289,
  395-408). If the AK lacks a valid certificate chain, `performAttestation`
  enrolls with an Attestation CA over its `/attest` and `/secret` HTTP
  endpoints (credential activation flow), honoring `--attestation-ca-url`,
  `--attestation-ca-root`, and `--attestation-ca-insecure`
  (tpm.go:483-536, 566-679). AK validity requires the EK public-key ID encoded
  as `urn:ek:sha256:<b64>` in a URI SAN (tpm.go:359-393).
- The new key is attested with `QualifyingData` set to the SHA-256 of the ACME
  key authorization, binding key creation to this specific challenge and
  account — the comment notes this means a TPM key cannot be reused across
  ACME orders and cleanup is left to the user (tpm.go:130-151). The attestation
  statement is a CBOR `tpm`-format WebAuthn-style object with the AK chain in
  `x5c` (tpm.go:293-335).

## Boundaries

All HTTP wire protocols, the authority engine, `api` request/response types,
`pki.GetProvisioners`, and root-path helpers live in the external
`smallstep/certificates` module; this repository only orchestrates them. The
repository does not establish how `step-ca` validates tokens server-side or how
`ca.AdminClient` transports x5c headers — treat those as opaque external
contracts.

Related: the token types consumed here are built in
[tokens and authentication](/openwiki/architecture/tokens-and-auth.md);
command-level usage is covered by
[CA administration and ACME](/openwiki/core/ca-admin-and-acme.md).
