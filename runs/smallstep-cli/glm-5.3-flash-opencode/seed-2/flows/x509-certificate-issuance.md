---
type: flow
title: X.509 Certificate Issuance
description: The step ca certificate and step ca sign flow from token generation through CSR creation to the signed certificate — online via the step-ca Sign API, or offline against a local authority.
tags: [issuance, x509, csr, sign, offline]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-ff8a7fe9f3a4815e9b6b5c30
    resource: repo://command/ca/sign.go
  - id: openwiki-source-976947cfd6258da1cc5693a8
    resource: repo://utils/cautils/acme_flow.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# X.509 Certificate Issuance

## Two commands, one flow API

- **`step ca certificate <subject> <crt-file> <key-file>`** generates the key
  and CSR itself. It takes 2 positional arguments only with
  `--attestation-uri` (the ACME device-attestation flow).
- **`step ca sign <csr-file> <crt-file>`** signs an existing CSR.

Both build on `cautils.CertificateFlow` (`utils/cautils/certificate_flow.go`),
which unifies online and offline execution behind one API
(`GenerateToken`, `CreateSignRequest`, `Sign`), plus the ACME flow
(`cautils/acme_flow.go`) when an ACME provisioner is selected.

## `step ca certificate` end to end

1. **Flag gating.** `--offline` with `--token` is rejected (the token would
   be generated before the offline CA starts); `--attestation-uri` with
   `--kms` is rejected.
2. **Token acquisition.** With no `--token`, an explicit `--acme` provider
   jumps straight to the ACME flow; otherwise `flow.GenerateToken` runs the
   [token generation flow](/openwiki/flows/token-generation.md). If the
   selected provisioner turns out to be ACME (`ACMETokenError`), the command
   transparently switches to the ACME flow for that provisioner.
3. **Sign request creation.** `CreateSignRequest` parses the token
   (insecurely, client-side), generates the key from
   `--kty/--curve/--size`, and builds the CSR template from the token type:
   - JWK: subject is the token subject; `--san` flags are rejected when a
     `--token` was supplied, and the argument must match the CSR CN.
   - AWS/GCP/Azure: default SANs come from the instance identity document
     (private IP/hostname, instance name DNS forms, resource name) unless
     the provisioner disabled custom SANs.
   - OIDC: with no SANs, CN becomes the token subject and the email plus
     `iss#sub` URI become SANs when the argument matches the token email.
   - K8sSA: subject comes from the command line (multi-use token).
   The SAN lists are unified through `splitSANs` and the CSR signature is
   verified before use.
4. **Signing.** `flow.Sign` parses `--not-before/--not-after` and
   `--set/--set-file` template data, posts the `api.SignRequest` (CSR, OTT
   token, validity, template data) to the CA, and writes the returned chain
   as PEM with `fileutil.WriteFile` (mode `0600`). The private key is
   serialized to `<key-file>` with mode `0600`.

## `step ca sign`

The sign command reads the CSR file, requires `--token` (incompatible with
`--offline`), and — for OIDC, AWS, GCP, Azure, and K8sSA tokens — checks the
token subject against the CSR's CommonName before calling `flow.Sign`.
JWK-type token subject checks are performed server-side.

## Client construction from the token

`CertificateFlow.GetClient` decides how to trust the CA:

- If the token carries a `sha` (root fingerprint) claim and an `http(s)`
  audience, the CA URL defaults to the token audience and trust is
  established with `ca.WithRootSHA256(sha)` — this is how
  `step ca token`-produced tokens bootstrap a client without `--root`.
- Otherwise `--ca-url` is required and trust comes from `--root` or the
  default `$STEPPATH/certs/root_ca.crt`.
- In offline mode the offline CA is returned directly (its `GetCaURL` is
  `https://<first DNS name>` from the CA configuration).

## Offline mode

`--offline --ca-config <ca.json>` replaces the network entirely:
`NewOfflineCA` parses the `step ca init`-produced CA configuration, injects
`--password-file` into the config, and builds an in-process
`authority.Authority`. It is a process-wide singleton because re-initializing
an authority can deadlock on database locks (badger). Token generation uses
the same provisioner objects from the configuration file, and audiences are
derived from the config's first `DNSNames` entry (`https://<host>/sign`,
`/ssh/sign`, etc.). Signing calls the authority's sign method and returns the
chain without any network I/O. `OfflineCA` also provides `VerifyClientCert`
for validating a client certificate/key pair against its own root and
intermediate pools.

## ACME

When an ACME provisioner is chosen (or `--acme` names a directory URL),
`cautils.ACMECreateCertFlow` runs the ACMEv2 client flow with the `http-01`
challenge instead of token-based signing; the ACME-specific flags
(`--contact`, `--http-listen`, `--standalone`, EAB key id/reference) live in
`command/ca/ca.go`.
