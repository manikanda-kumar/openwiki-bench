---
type: workflow
title: ACME Client Flow and Challenge Validation
description: How step acts as an ACME client, creating orders, authorizing identifiers, and validating HTTP-01 and device-attestation challenges.
tags: [acme, rfc8555, http01, attestation, challenge, letsencrypt]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:42:28.757Z
sources:
  - id: openwiki-source-8fa5181432f9015e3fe5ac29
    resource: repo://command/ca/acme/acme.go
  - id: openwiki-source-aecab703e3710c5764638ff5
    resource: repo://utils/cautils/acmeutils.go
generated: { by: "opencode", at: "2026-09-12T20:42:28.757Z" }
---

# ACME Client Flow and Challenge Validation

`step` implements an ACMEv2 (RFC 8555) client flow in `utils/cautils/` for
obtaining certificates from a step-ca (or any RFC 8555-compliant CA such as
Let's Encrypt). The flow creates an order, authorizes each identifier via
challenges, finalizes the order with a CSR, and downloads the issued
certificate.

## Entrypoints

`step ca certificate` and `step ca sign` route to the ACME client when an
`--acme <directory-url>` flag is present or an ACME provisioner is selected. The
directory URL is either given directly or derived as
`<ca-url>/acme/<provisioner>/directory`
(`utils/cautils/acmeutils.go`). Offline mode is mutually exclusive with ACME
(`newACMEFlow`).

`ACMECreateCertFlow` (create) generates attrs/subject SANs and calls
`GetCertificate`; `ACMESignCSRFlow` (sign) uses a provided CSR
(`utils/cautils/acme_flow.go`).

## Order creation

`createNewOrderRequest` builds the identifiers (DNS + IP) from the subject and
SANs after validating them (email/URI SANs are rejected, and wildcards require
DNS validation which is not implemented → rejected). Let's Encrypt is
special-cased:

- `--not-before`/`--not-after` are rejected (LE sets a fixed 3-month lifetime).
- The Common Name must also be a DNS identifier, so it is added if missing.

Otherwise, an `acmeAPI.NewOrderRequest` with NotAfter/NotBefore is produced
(`utils/cautils/acmeutils.go`).

## Authorization and challenge validation

`authorizeOrder` walks each authorization and its challenges, performing the
first supported one:

- `http-01`: served via `standaloneMode` (run an HTTP server on
  `--http-listen`, default `:80`) or `webrootMode` (write the key
  authorization under a web root as
  `{.well-known/acme-challenge/<token>`) and then
  `ac.ValidateChallenge`.
- `device-attest-01`: when `--attestation-uri` is set, `doDeviceAttestation`
  produces a WebAuthn-style attestation object (packed/`step` format) and
  submits it via `ValidateWithPayload`, or delegates to the TPM flow for
  `tpmkms:` URIs.

`getChallengeStatus` retries up to 10 times, polling the challenge until it is
`valid` or `invalid`, extracting detailed error messages (including ACME
subproblems) on failure (`utils/cautils/acmeutils.go`).

## Finalization

`finalizeOrder` waits for the order to become `ready` (polling at 1-second
intervals, printing dots), calls `FinalizeOrder` with the CSR, waits for the
order to become `valid`, and returns the final order
(`utils/cautils/acmeutils.go`). The CSR is generated in-process for the
acmeFlow key material unless attestation or a user CSR is used.

## Attestation

For device attestation, the client's KMS/attestor public key is used to sign
the key authorization; the resulting attestation (format `step`) is a CBOR
object with `alg`, `sig`, and `x5c`, wrapped in a JSON `attObj` payload and
validated via `ValidateWithPayload`. TPM-backed attestation performs a
TPM-specific flow (`utils/cautils/acmeutils.go`, `utils/cautils/tpm.go`).

## Root store handling

The ACME client chooses a trust store: local root only, merged with the system
store (when using an explicit `--acme` directory), or system store only,
depending on `getClientTruststoreOption`
(`utils/cautils/acmeutils.go`).

## ACME administration

`step ca acme` manages ACME settings, notably external account binding (EAB)
credentials via `step ca acme eab` (`command/ca/acme/acme.go`,
`command/ca/acme/eab/`).
