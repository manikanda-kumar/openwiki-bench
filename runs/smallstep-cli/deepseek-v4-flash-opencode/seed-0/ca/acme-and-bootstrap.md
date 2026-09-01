---
type: workflow
title: ACME and Bootstrap Flows
description: The ACME client flows (http-01 standalone and webroot challenge modes, device attestation, CSR flow, order lifecycle) and the CA bootstrap flows that download and persist root certificates and defaults.json.
tags: [acme, bootstrap, http-01, device-attestation, step-ca]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-976947cfd6258da1cc5693a8
    resource: repo://utils/cautils/acme_flow.go
  - id: openwiki-source-aecab703e3710c5764638ff5
    resource: repo://utils/cautils/acmeutils.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---

# ACME and Bootstrap Flows

This page documents two families of client-side flows in `utils/cautils`: the
**ACME** flows (RFC 8555) used to obtain certificates from a step-ca ACME
provisioner or any ACME server, and the **bootstrap** flows used to configure a
machine to trust and reach a CA.

## ACME flows

`step ca certificate` and `step ca sign` route ACME requests through
`utils/cautils/acme_flow.go` and `acmeutils.go`.

### Entry points

- `ACMECreateCertFlow` builds an `acmeFlow` from the subject and `--san` values,
  calls `GetCertificate()`, writes the certificate file, and — when the flow
  generated a private key — writes the key file with `0600` permissions. When
  an `--attestation-uri` is used, no private key file is produced.
- `ACMESignCSRFlow` performs the same transaction using an existing CSR
  (`withCSR`), writing only the certificate file.

### Flow construction invariants

`newACMEFlow` enforces two rules:

- Offline mode and ACME are **mutually exclusive** (`--offline` is rejected).
- One of `--standalone` or `--webroot` must be chosen; if neither is passed,
  `--standalone` is set implicitly. Passing both is an error.

The ACME directory URL is taken from the `--acme` flag when provided;
otherwise it is derived as `<ca-url>/acme/<provisioner-name>/directory`, which
requires a provisioner name and a reachable `--ca-url`.

### Order lifecycle

`GetCertificate` performs the ACME order dance:

1. Build the new-order request. Email and URI SANs are rejected, as are
   wildcard DNS names (they require `dns-01`, which this client does not
   implement). For directories whose URL contains `letsencrypt`, the
   `--not-before`/`--not-after` flags are rejected and the subject is forced
   into the identifier list (Let's Encrypt requires the CN to also be a SAN).
   For other servers, `NotBefore`/`NotAfter` parsed from the flags are sent in
   the order.
2. Create the ACME client (`ca.NewACMEClient`) and submit the order. The
   client's trust store depends on the server: with `--acme` (a third-party
   server) the local root CA is merged into the system cert pool; otherwise
   the local root (`--root` or `$STEPPATH/certs/root_ca.crt`) is used alone,
   or the system store when no local root exists.
3. `authorizeOrder` walks every authorization URL. For each identifier it
   finds a usable challenge: `http-01` normally, or `device-attest-01` when
   `--attestation-uri` is set. If no challenge can be validated for an
   identifier, the flow fails.
4. `finalizeOrder` polls the order until its status is `ready`, finalizes it
   with the CSR, polls until `valid`, and finally downloads the leaf and
   chain with `ac.GetCertificate`.

### http-01 challenge modes

- **Standalone mode** starts an HTTP server on `--http-listen` (default `:80`)
  that serves the ACME key authorization at
  `/.well-known/acme-challenge/<token>`. Validation is triggered with
  `ac.ValidateChallenge`, and the server is shut down afterwards.
- **Webroot mode** writes the key authorization to
  `<webroot>/.well-known/acme-challenge/<token>` (directory `0755`, file
  `0644`) so an existing file server can serve it, and removes the file in
  `Cleanup`.

`getChallengeStatus` polls the challenge status up to 10 times, breaking early
on `valid`/`invalid`; on failure it surfaces the server's error details
(including ACME subproblems) through `extractDetailedErrorMessageFromChallenge`.

### Device attestation (`device-attest-01`)

When `--attestation-uri` is set, `authorizeOrder` validates the
`device-attest-01` challenge instead. For `tpmkms:` URIs this is delegated to
`doTPMAttestation`; otherwise a KMS-backed attestor signs the key
authorization and the client submits a CBOR-encoded `step`-format attestation
object (`fmt: "step"`, with `alg`, `sig`, `x5c` fields) via
`ac.ValidateWithPayload`. Attestation certificates are limited to a single
`permanent-identifier` identifier; if a TPM signer was used, the retrieved
certificate chain is stored back with the TPM key.

### Output

`writeCert` serializes the full chain (leaf followed by intermediates) as PEM
and writes the certificate file with `0600` permissions.

## Bootstrap flows

Bootstrap configures a fresh machine to trust a CA:

- `BootstrapAuthority(ctx, caURL, fingerprint)` bootstraps directly from a CA
  URL and root fingerprint; the default context name is the CA hostname (or
  `--authority`).
- `BootstrapTeamAuthority(ctx, team, teamAuthority)` first calls
  `api.smallstep.com` (or a custom `--team-url`, where `<>` placeholders are
  replaced with the team ID) at
  `/v1/teams/<team>/authorities/<teamAuthority>`, reads back a response with
  `url`, `fingerprint`, `redirect-url`, `provisioner`, and
  `min-password-length`, and defaults the redirect URL to
  `https://smallstep.com/app/teams/sso/success` when none is supplied.

Both converge on the shared `bootstrap()` helper, which downloads and
fingerprint-validates the root, writes the root certificate and
`config/defaults.json`, records a context when contexts are in use, and
optionally installs the root into the system trust store with `--install`.
The on-disk effect is described in
[STEPPATH, Configuration, and Contexts](../architecture/step-path-and-contexts.md).

## ACME management

`step ca acme eab` (under `command/ca/acme/eab`) manages external account
binding keys for ACME provisioners. The `acme` command group is also exposed
under `step beta ca acme`.
