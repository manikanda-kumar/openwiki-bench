---
type: "Reference"
title: "ACME and TPM Attestation"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
---

# ACME and TPM Attestation

`step ca certificate` can obtain certificates through the ACME protocol instead of the
plain sign flow. This page documents the client-side ACME transaction in
`utils/cautils` (order creation, challenge serving, finalization), the TPM device
attestation path, and the `step ca acme eab` management commands.

## Entry points

- `utils/cautils/acme_flow.go` exposes two flows:
  - `ACMECreateCertFlow(ctx, provisionerName)`: takes `<subject> <certFile> <keyFile>`
    args plus `--san` values, builds the flow with `withSubjectSANs` and
    `withProvisionerName`, calls `GetCertificate()`, writes the chain (PEM, `0600`) with
    `writeCert`, and serializes the private key unless the key lives in a TPM
    (attestation case).
  - `ACMESignCSRFlow(ctx, csr, certFile, provisionerName)`: the same transaction but using
    a caller-provided CSR (`withCSR`); only the certificate file is written.
- The command hook is in `command/ca/certificate.go`: when `--acme` is set and no
  `--token` is given, it calls `cautils.ACMECreateCertFlow(ctx, "")`. If `--acme` is not
  set, `flow.GenerateToken` may return an `ACMETokenError` (defined in
  `utils/cautils/token_flow.go`; also returned by `OfflineCA` for ACME provisioners),
  which carries the ACME provisioner name and triggers `ACMECreateCertFlow` with it.

## Flow construction (`newACMEFlow`)

`utils/cautils/acmeutils.go` `newACMEFlow` validates options:

- `--offline` and ACME are mutually exclusive (offline mode is not supported for ACME).
- `--standalone` and `--webroot` are mutually exclusive; when neither is set, `standalone`
  is forced on by default.
- The ACME directory comes from `--acme`; if absent, it is derived as
  `<ca-url>/acme/<provisioner>/directory` (a provisioner name is then required).
- Functional options: `withProvisionerName`, `withCSR`, `withSubjectSANs`.

## Trust and client construction

`getClientTruststoreOption(mergeRootCAs)`:

- Uses `--root` if set, otherwise the default root at `pki.GetRootCAPath()` if present.
- Merging is requested when `--acme` is explicitly set: the local root is appended to the
  system cert pool (TLS 1.2 minimum). Otherwise the local root file is used alone
  (`ca.WithRootFile`), or the system default transport when no root is available.
- The client is `ca.NewACMEClient(acmeDir, contacts, opts)` from `smallstep/certificates`.

## Transaction (`acmeFlow.GetCertificate`)

1. Build the order request via `createNewOrderRequest`:
   - `validateSANsForACME` splits SANs; email and URI SANs are rejected, and wildcard DNS
     names are rejected because DNS validation is not implemented in this client.
   - For LetsEncrypt directories, `not-before`/`not-after` are rejected (fixed 3-month
     lifetime) and the subject CN is always added as a DNS identifier.
   - Otherwise a `NewOrderRequest` with identifiers plus `NotBefore`/`NotAfter` (parsed by
     `flags.ParseTimeDuration`) is built, adding the subject as a DNS or IP identifier if
     absent.
   - With `--attestation-uri`, the order instead uses a single
     `permanent-identifier` and no other SANs.
2. `ac.NewOrder(payload)` creates the order, then `authorizeOrder` walks each
   `AuthorizationURL`:
   - `http-01` challenges go to `serveAndValidateHTTPChallenge` (below);
   - `device-attest-01` challenges (when `--attestation-uri` is set) go to
     `doDeviceAttestation`.
   - If no challenge for an identifier can be validated, the order fails.
3. If no CSR was provided, one is generated:
   - normal flow: key generated from `kty`/`curve`/`size` flags
     (`utils.GetKeyDetailsFromCLI` + `keyutil.GenerateSigner`), CSR with CN=subject and
     the validated DNS/IP SANs;
   - TPM flow: the TPM signer is used, CSR with only the subject CN;
   - other attestation URIs: signer from `cryptoutil.CreateSigner`, CN-only CSR.
4. `finalizeOrder` polls the order (10 x 1s) until `ready`, calls
   `ac.FinalizeOrder(finalizeURL, csr)`, then polls until `valid`.
5. `ac.GetCertificate(certificateURL)` returns leaf + chain; for the TPM signer the
   resulting chain is stored in the TPM with `key.SetCertificateChain` (key looked up by
   name from the attestation URI, device and dirstore from URI/flags).

## HTTP-01 challenge serving

- `serveAndValidateHTTPChallenge` picks the mode from flags:
  - **standalone** (`--standalone`, default): `standaloneMode` runs
    `startHTTPServer(http-listen, token, keyAuth)` — a plain HTTP server (default
    `:80`, see `acmeHTTPListenFlag`; needs root privileges) serving
    `/.well-known/acme-challenge/<token>` with the key authorization. Cleanup shuts the
    server down.
  - **webroot** (`--webroot <dir>`): `webrootMode` writes the key authorization to
    `<dir>/.well-known/acme-challenge/<token>` (dir `0755`, file `0644`, so an existing
    webserver of another user can serve it) and removes the file on cleanup.
- After serving, it calls `ac.ValidateChallenge(ch.URL)`, sleeps 1s, then
  `getChallengeStatus` polls every 5s until validated/failed, extracting detailed error
  messages from the challenge object.

## Device attestation

- `doDeviceAttestation` (`utils/cautils/acmeutils.go`):
  - `tpmkms:` URIs dispatch to `doTPMAttestation` in `utils/cautils/tpm.go`.
  - Other URIs use `cryptoutil.CreateAttestor`: the attestor's PEM bundle becomes `x5c`,
    the key authorization is signed (ES256 for P-256 EC, RS256 for RSA, EdDSA for
    Ed25519; other keys rejected) and CBOR-encoded, and the payload is posted to the
    challenge.
- `doTPMAttestation` (`utils/cautils/tpm.go`):
  - `parseTPMAttestationURI` requires a `tpmkms:` scheme with a `name` query parameter
    (plus optional `device` and `attestation-ca-url`).
  - Initializes a `go.step.sm/crypto/tpm` instance with a dirstore at
    `--tpm-storage-directory`; prints TPM info; maps `kty`/`curve`/`size` to
    ECDSA 256/384/521 or RSA.
  - `getAK` retrieves/creates an attestation key named after the hex fingerprint of the
    preferred EK (`getPreferredEK`); if the AK lacks a valid certificate identity
    (`hasValidIdentity` checks the EK key-id URI in SANs), it enrolls with the
    Attestation CA via `attestationClient.performAttestation` and stores the chain.
  - `newAttestationClient` supports `--attestation-ca-root` (roots file) and
    `--attestation-ca-insecure`; `attestationStatement` builds the CBOR attestation
    object, and `attest` posts it and verifies the decrypted secret.

## EAB management

`step ca acme eab` (`command/ca/acme/eab/`) manages External Account Binding Keys on the
CA through the admin client (linkedca / certificates admin API):

- `step ca acme eab list <provisioner>` — list EAB keys (id, provisioner, reference, key,
  created/bound times, account).
- `step ca acme eab add <provisioner> <reference>` — add a key.
- `step ca acme eab remove <provisioner> <key-id>` — remove a key.
- `notImplemented` unwraps admin "not implemented" errors into a message that the
  functionality is currently only available in Certificate Manager.
- `sigchild.go` adds a signal-pipe handler (Windows-specific process group cleanup).

The `step ca acme` group itself (`command/ca/acme/acme.go`) currently exposes only the
`eab` subcommand; ACME issuance itself is driven from `step ca certificate` with
`--acme` (or via an ACME provisioner on the CA).

## Related flags

- `--acme <dir>`: explicit ACME directory URL (any ACME server, not just Step CA).
- `--contact <email>` (repeatable): ACME contact addresses.
- `--standalone` / `--webroot <dir>`: challenge serving mode (standalone default).
- `--http-listen <addr>`: standalone listener address (default `:80`).
- `--attestation-uri`, `--attestation-ca-url`, `--attestation-ca-root`,
  `--attestation-ca-insecure`, `--tpm-storage-directory`: device attestation
  (`attestation-uri` is defined in `flags/flags.go` with `tpmkms:` URI documentation;
  the CA-specific flags in `command/ca/certificate.go`).

## Change guide: extending ACME

- New flow option: add an `acmeFlowOp` in `utils/cautils/acmeutils.go` and apply it in
  `newACMEFlow`; pass it from the entry points in `utils/cautils/acme_flow.go`.
- New challenge mode: implement the `issueMode` interface (`Run`/`Cleanup`) alongside
  `standaloneMode`/`webrootMode`, select it in `serveAndValidateHTTPChallenge`, add a
  flag in `command/ca/ca.go`, and wire it into `command/ca/certificate.go` flags.
- New challenge type in `authorizeOrder`: add a branch keyed on `ch.Type` next to
  `http-01`/`device-attest-01`.
- Validate with `make test` and, where possible, a `--webroot` local run against a
  test ACME server; note wildcard DNS and non-HTTP challenges are explicitly not
  supported by this client.

## Related

- [CA Clients and Certificate Request Flows](/openwiki/ca-integration/ca-client-and-flows.md)
- [CA Command Group](/openwiki/commands/ca.md)
