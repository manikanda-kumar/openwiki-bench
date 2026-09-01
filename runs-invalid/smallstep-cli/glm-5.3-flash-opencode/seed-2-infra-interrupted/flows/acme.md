---
type: acme-client-flow
title: ACME certificate flow
description: How step obtains certificates over ACMEv2 — order creation, http-01 and device-attest-01 challenges in standalone or webroot mode, finalization, and EAB key management.
tags: [acme, acmev2, http-01, challenges, eab, attestation]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:55:27.913Z
---

# ACME certificate flow

`step` speaks ACMEv2 (RFC8555) both against step-ca's ACME provisioners and
against any other ACME server (e.g. Let's Encrypt) via `--acme`. The flow lives
almost entirely in `utils/cautils/acmeutils.go`, behind two entry points called
from `step ca certificate` (and `step beta ca acme` exposure of the management
group). See [Certificate issuance flow](/openwiki/flows/certificate-issuance.md)
for how ACME is selected as an alternative to the JWT token flow, and
[Provisioner token generation flow](/openwiki/flows/token-generation.md) for why
ACME provisioners reject that flow.

## Entry points

Two functions run the flow (`utils/cautils/acme_flow.go:13-62`):

- **`ACMECreateCertFlow(ctx, provisionerName)`** — used by `step ca certificate
  <subject> <crt> <key>` when ACME applies. It builds an `acmeFlow` from
  `--san` flags, runs it, writes the certificate chain, then serializes the
  newly generated private key to `0600` — unless the flow was an attestation
  flow, in which case there is no exportable private key and the attestation
  URI is printed instead (`utils/cautils/acme_flow.go:33-42`).
- **`ACMESignCSRFlow(ctx, csr, certFile, provisionerName)`** — used by `step ca
  sign` with an existing CSR; no key is generated and only the certificate file
  is written.

## Flow setup and constraints

`newACMEFlow` (`utils/cautils/acmeutils.go:625-666`) enforces the invariants:

- **Offline mode is rejected**: "offline mode and ACME are mutually exclusive" —
  ACME inherently requires an online CA, so `--offline` cannot be combined.
- **Standalone vs webroot**: exactly one challenge-serving mode must apply.
  `--standalone` and `--webroot` are mutually exclusive; if neither is set,
  standalone is forced by setting the flag in the CLI context (standalone is
  the default mode, matching the flag documentation in
  `command/ca/ca.go:126-140`).
- **ACME directory resolution**: `--acme <url>` wins; otherwise the directory is
  derived from the CA URL as `<caURL>/acme/<provisioner>/directory`, requiring
  a provisioner name (`utils/cautils/acmeutils.go:653-663`).
- **SAN restrictions**: `validateSANsForACME` rejects email and URI SANs, and
  rejects wildcard DNS names because dns-01 validation "is currently not
  implemented in this client" (`utils/cautils/acmeutils.go:285-297`). Only
  dns/ip identifiers are supported.

## Trust handling

`getClientTruststoreOption` (`utils/cautils/acmeutils.go:668-708`) decides the
client's trust root:

- With `--root` set (or the default `$STEPPATH` root existing), the local root
  is used via `ca.WithRootFile`.
- When the ACME server is *not* step-ca (`--acme` set), the local root is
  **merged into the system cert pool** so both the private CA and public
  intermediates verify.
- With no local root at all, the system store is used.

## Order lifecycle

`acmeFlow.GetCertificate` (`utils/cautils/acmeutils.go:710-865`) drives the
protocol via `ca.NewACMEClient` from the certificates module:

1. **Build the order request.** For a normal flow, identifiers are dns/ip
   entries plus the subject (added as dns or ip depending on `net.ParseIP`);
   `--not-before`/`--not-after` are included via `NewOrderRequest`. For
   attestation flows (`--attestation-uri`), the only identifier is
   `permanent-identifier` and other SANs are not accepted.
2. **Let's Encrypt special case.** If the directory URL contains
   "letsencrypt", NotBefore/NotAfter are rejected with an explanatory error
   (LE certificates have a fixed ~3-month lifetime), and the subject is
   appended to the DNS identifiers if missing, since LE requires the CN to
   also be a SAN (`utils/cautils/acmeutils.go:319-350`).
3. **NewOrder → authorizeOrder.** Each authorization is validated by exactly
   one challenge: `http-01` normally, or `device-attest-01` when
   `--attestation-uri` is set (`utils/cautils/acmeutils.go:196-232`).
4. **CSR creation.** If no CSR was supplied, a key is generated per
   `--kty/--curve/--size`, or the attestation signer is used.
5. **finalizeOrder.** Polls the order until "ready" (up to ~10s), posts the CSR
   to the finalize URL, then polls until "valid"
   (`utils/cautils/acmeutils.go:234-283`).
6. **Fetch and write.** The leaf plus chain are fetched from the certificate
   URL and written as a full-chain PEM file with `0600`
   (`utils/cautils/acmeutils.go:867-880`). TPM-backed keys additionally get the
   certificate chain stored on the TPM key (`utils/cautils/acmeutils.go:833-862`).

## Challenge serving (http-01)

`serveAndValidateHTTPChallenge` (`utils/cautils/acmeutils.go:159-194`) computes
the key authorization from the challenge token and client key, then serves it
according to the mode:

- **Standalone** (`standaloneMode`): starts a local HTTP server on
  `--http-listen` (default `:80`, which requires privileges) serving
  `/.well-known/acme-challenge/<token>` with the key authorization
  (`utils/cautils/acmeutils.go:47-71, 94-102`).
- **Webroot** (`webrootMode`): writes the key authorization to
  `<webroot>/.well-known/acme-challenge/<token>`; directories are created
  `0755` and files `0644` on purpose, since the web server that serves the file
  typically runs as another user (`utils/cautils/acmeutils.go:124-152`). Cleanup
  removes the challenge file.

After serving begins, the client asks the CA to validate the challenge, sleeps
briefly, then polls `getChallengeStatus` up to 10 times (5s apart for http-01;
2s for device attestation) until the challenge is `valid` — breaking early on
`invalid` — and cleans up the mode
(`utils/cautils/acmeutils.go:514-549`). On failure the challenge's ACME error
detail (including subproblems) is surfaced
(`utils/cautils/acmeutils.go:551-583`).

## Device attestation (device-attest-01)

With `--attestation-uri`, `doDeviceAttestation` proves possession of a
hardware-backed key instead of serving HTTP
(`utils/cautils/acmeutils.go:403-512`):

- A `tpmkms:` URI routes to the TPM flow (`utils/cautils/tpm.go:40`);
  otherwise `cryptoutil.CreateAttestor` builds an attestor (e.g. YubiKey PIV
  via step-kms-plugin) — see [KMS URIs, step-kms-plugin, and the plugin
  system](/openwiki/integrations/kms-and-plugins.md).
- The key authorization is signed by the attestor (ES256/RS256/EdDSA by key
  type), the signature CBOR-encoded, and the attestation certificate chain
  carried in an `x5c` member of a "packed"-style attestation object in the
  step format (authData omitted per the device-attest-01 draft).
- The payload is posted with `ac.ValidateWithPayload`; validation is
  synchronous, so an invalid result surfaces immediately.

The corresponding certificate order carries a single
`permanent-identifier`, and on success the issued chain is attached to the TPM
key when applicable.

## EAB key management

`step ca acme` manages **External Account Binding** keys through the CA's Admin
API (`command/ca/acme/acme.go:10-20`), not through the ACME protocol:

- `eab add <provisioner> [<reference>]` creates a key via
  `client.CreateExternalAccountKey` and prints the key ID, provisioner,
  base64url-encoded HMAC key, and reference (`command/ca/acme/eab/add.go:60-95`).
- `eab list <provisioner>` pages through keys with cursor pagination (100 per
  page by default, `--limit` overridable), optionally piping to `$PAGER`
  (validated against shell metacharacters), masking key material as `*****`
  (`command/ca/acme/eab/list.go:84-177`).
- `eab remove <provisioner> <key-id>` deletes a key.

When the connected CA reports the operation as not implemented (open-source
step-ca vs Certificate Manager), `notImplemented` rewrites the error to point
at Certificate Manager (`command/ca/acme/eab/eab.go:81-89`).

The pager's lifecycle is guarded by a SIGCHLD handler that exits the parent
when the pager is killed (`command/ca/acme/eab/sigchild.go:7-17`).

## Beta exposure

The whole `acme` management group is additionally reachable as
`step beta ca acme`: the `beta` command nests `ca.BetaCommand()`, which itself
exposes `acme.Command()` (`command/beta/beta.go:12-25`,
`command/ca/ca.go:159-170`), marking it as an API under development.

## Why the token flow rejects ACME

`NewTokenFlow` returns `&ACMETokenError{...}` for ACME provisioners with the
message "step ACME provisioners do not support token auth flows"
(`utils/cautils/token_flow.go:78-87, 176-177`). This is structural, not a
limitation: ACME authorization is established by challenges against
identifiers, whereas the JWT flow pre-authorizes identifiers inside a signed
token. `step ca certificate` exploits the typed error: when
`flow.GenerateToken` fails with `ACMETokenError` (because the selected
provisioner is an ACME one), the command transparently switches to
`ACMECreateCertFlow` with that provisioner's name
(`command/ca/certificate.go:255-266`); an explicit `--acme <url>` short-circuits
to ACME before the token flow is even attempted.

## Representative tests

The ACME client flow has no dedicated unit tests in this repository
(`utils/cautils/` tests cover token and offline flows); behavior above is
established by the implementation and command documentation. Integration
testscripts under `integration/testdata/` do not exercise ACME against a live
CA.
