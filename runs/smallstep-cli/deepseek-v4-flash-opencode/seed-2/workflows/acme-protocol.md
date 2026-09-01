---
type: workflow
title: ACME Protocol Flows
description: How the step CLI obtains certificates through the ACME protocol — routing from token flows, standalone/webroot HTTP challenge modes, device attestation, and external ACME CAs.
tags: [workflow, acme, certificates, challenges]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-9335ab9a0351c4e07a0bf3d1
    resource: repo://command/ca/acme/eab/add.go
  - id: openwiki-source-1469a9c4d225f283439896da
    resource: repo://command/ca/acme/eab/eab.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-9ca10d5f3a3bf6abbc2f7390
    resource: repo://command/ca/policy/actions/cn.go
  - id: openwiki-source-aecab703e3710c5764638ff5
    resource: repo://utils/cautils/acmeutils.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# ACME Protocol Flows

The step CLI can obtain certificates through the ACME protocol (RFC 8555)
either from a step-ca **ACME provisioner** or from any external ACME directory
(e.g. Let's Encrypt). The ACME machinery lives in `utils/cautils/acmeutils.go`
and `utils/cautils/acme_flow.go`.

## Entry points and routing

A certificate command enters the ACME path in three ways
(command/ca/certificate.go:256-268):

1. `--acme <url>` is set explicitly — the flow runs against that ACME
   directory (`cautils.ACMECreateCertFlow(ctx, "")`).
2. The token flow returns an `ACMETokenError` — this happens when the selected
   provisioner is an ACME provisioner, because ACME provisioners do not support
   token auth. The error carries the provisioner name, and the command switches
   to `cautils.ACMECreateCertFlow(ctx, acmeTokenErr.Name)`.
3. `--provisioner <name>` selects an ACME provisioner directly
   (the `--provisioner` flag routes to the same token error → ACME path).

`step ca sign` follows the same pattern via `ACMESignCSRFlow` for an existing
CSR (command/ca/sign.go:185-199). `ACMECreateCertFlow` and `ACMESignCSRFlow`
(utils/cautils/acme_flow.go) build an `acmeFlow`, call `GetCertificate`, write
the certificate chain, and (in the create case) serialize the private key —
unless the certificate is attestation-based, in which case the key lives in the
device and the attestation URI is reported instead.

## acmeFlow setup

`newACMEFlow` (utils/cautils/acmeutils.go:625-666):

- Rejects `--offline` ("offline mode and ACME are mutually exclusive").
- Requires one of `--standalone` or `--webroot`; if neither is given it
  defaults to standalone.
- Resolves the ACME directory: the `--acme` flag when set, otherwise
  `<ca-url>/acme/<provisioner>/directory`.

`getClientTruststoreOption` (utils/cautils/acmeutils.go:668-708) picks the TLS
trust for the ACME server: the local root merged with the system store (used
when `--acme` is set), the local root only, or the system store.

## Order lifecycle

`acmeFlow.GetCertificate` (utils/cautils/acmeutils.go:710-865):

1. Builds a new-order request from the subject/SANs. With
   `--attestation-uri`, the order uses a `permanent-identifier` identifier and
   does **not** accept additional SANs.
2. Creates an ACME client (`ca.NewACMEClient(directory, contacts, trust)`),
   submits the order, and authorizes each authorization URL.
3. Generates a fresh key (kty/curve/size) and CSR for normal orders; uses the
   TPM signer or the attestation-URI signer for attestation orders.
4. Finalizes the order (waiting for `ready` then `valid` status), downloads the
   leaf + chain, writes the full chain, and for TPM keys stores the chain back
   with the key.

## HTTP challenge validation

`authorizeOrder` (utils/cautils/acmeutils.go:196-232) validates each
authorization by running its `http-01` challenge (or `device-attest-01` for
attestation flows). `serveAndValidateHTTPChallenge`
(utils/cautils/acmeutils.go:159-194) dispatches to the selected mode:

- **Standalone** (`standaloneMode`): starts a local HTTP server on
  `--http-listen` (default `:80`) that serves
  `/.well-known/acme-challenge/<token>` with the computed key authorization
  (from `acme.KeyAuthorization(token, key)`), then calls
  `ac.ValidateChallenge` and polls the challenge status.
- **Webroot** (`webrootMode`): writes the key authorization file into the
  `--webroot` directory for an existing web server to serve, then validates and
  polls, and removes the challenge file on cleanup.

## Device attestation

For attestation-based ACME orders, `doDeviceAttestation` and `doTPMAttestation`
(see "KMS and Plugin Integration") satisfy `device-attest-01` challenges by
presenting a WebAuthn-style attestation statement. TPM-backed flows bind the
attested key to the challenge digest as qualifying data, so a key cannot be
reused across ACME orders.

## External account binding (EAB)

ACME EAB keys are managed with `step ca acme eab add|list|remove`
(command/ca/acme/eab/), which operate over `linkedca.EABKey` objects through
the Admin API (`cautils.NewAdminClient`). EAB keys are identified by ID and an
optional reference. ACME issuance policies can be scoped to a specific EAB key
via the `--eab-key-id` / `--eab-key-reference` flags on `step ca policy`
commands (e.g. policy/actions/cn.go).

## Caveats

Only the `http-01` (and device-attest-01) challenge types are implemented — the
code comment in `authorizeOrder` notes other challenge types are not supported.
External CAs such as Let's Encrypt require the common name to be validated as a
DNS identifier in the order, unlike step-ca.
