---
type: operations
title: KMS and Plugin Integration
description: How the step CLI accesses hardware and cloud-backed keys — KMS URIs, the step-kms-plugin subprocess protocol, sign/attest delegation, and the ACME-DA TPM attestation flow.
tags: [operations, kms, plugins, tpm, hardware-keys]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-57d7d8b1ea53edb457db35b8
    resource: repo://utils/cautils/tpm.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# KMS and Plugin Integration

The step CLI can use keys that never leave a hardware or cloud key manager —
YubiKeys, PKCS#11/HSM tokens, TPM 2.0 chips, and Google/AWS/Azure cloud KMS.
Access is layered: `internal/cryptoutil` provides the signer abstraction, and
the actual crypto is performed by the **`step-kms-plugin`** external executable
(an out-of-process plugin).

## KMS URIs

Keys are addressed by KMS URIs of the form
`kmstype:[key=value;...]?[key=value&...]`, where the `;`-separated parameters
identify the KMS and `&`-separated parameters carry credentials/configuration.
Supported types are documented on the `--kms` flag (flags/flags.go:471-508):

- `yubikey:` — serial, pin-value, pin-source, management-key, management-key-source
- `pkcs11:` — module-path, token, id, object, pin-value, pin-source
- `tpmkms:` — name, device, attestation-ca-url
- `cloudkms:` — credentials-file
- `awskms:` — region, profile, credentials-file
- `azurekms:` — tenant-id, client-id, client-secret, client-certificate-file

`cryptoutil.IsKMS` decides whether a name is a KMS URI: it is **not** a KMS if a
file exists with the same name or if the URI type resolves to the default KMS
(internal/cryptoutil/cryptoutil.go:28-38).

## The step-kms-plugin protocol

When a name is not a file, `internal/cryptoutil` locates and runs
`step-kms-plugin` (found via `plugin.LookPath("kms")`, i.e.
`step-kms-plugin` in `$(step path)/plugins` or `PATH`):

- **`key`** — `newKMSSigner`/`newKMSPublicKey` run
  `step-kms-plugin key [--kms <uri>] <name>` and parse the PEM-returned public
  key. `CreateSigner` returns this as a `crypto.Signer`; `PublicKey` returns the
  raw public key.
- **`sign`** — `kmsSigner.Sign` runs
  `step-kms-plugin sign --format base64 [--kms <uri>] [--pss --salt-length N] [--alg SHA256|SHA384|SHA512] <name>`,
  streams the digest to the plugin's stdin, and base64-decodes the signature
  from stdout. RSA keys use `--pss`/`--salt-length` (requires plugin v0.12.0)
  and a hash algorithm flag.
- **`certificate`** — `LoadCertificate` runs
  `step-kms-plugin certificate [--kms <uri>] <name>` to fetch a certificate
  chain from the device.
- **`attest`** — `CreateAttestor`/`kmsSigner.Attest` run
  `step-kms-plugin attest [--kms <uri>] <name>`, returning the attestation
  certificate bytes. `Attestor` combines `crypto.Signer` with `Attest()`.

`LoadJSONWebKey` builds a `jose.JSONWebKey` for the KMS signer as an opaque
signer, selecting the signing algorithm from the key type (ES256/ES384/ES512
for ECDSA, RS256 for RSA, EdDSA for Ed25519) and setting `kid` to the key's
thumbprint (internal/cryptoutil/cryptoutil.go:126-169).

`IsX509Signer` gates whether a key can sign X.509 certificates: ECDSA, RSA, and
Ed25519 are allowed, except keys from `sshagentkms:` which only allow Ed25519
(internal/cryptoutil/cryptoutil.go:191-205).

## TPM attestation (ACME-DA)

`doTPMAttestation` (utils/cautils/tpm.go:40-196) is the ACME Device Attestation
(ACME-DA) flow for TPM-backed keys, triggered by `--attestation-uri` on
`step ca certificate`:

1. Parses a `tpmkms:` attestation URI (requiring a `name`), plus
   `--attestation-ca-url`, `--attestation-ca-root`, and
   `--tpm-storage-directory` (default `$STEPPATH/tpm`).
2. Initializes the TPM with a directory store, prints TPM info, and creates an
   Attestation CA client (with optional insecure TLS).
3. Gets or creates an **AK** (attestation key) named by the EK hex fingerprint;
   if the AK has no valid certificate (a cert whose URI SANs include the EK
   public key ID URN), it enrolls with the Attestation CA (`/attest` +
   `/secret` endpoints) and stores the returned chain.
4. Computes the ACME key authorization digest for the challenge, and calls
   `t.AttestKey` using that digest as **qualifying data** — binding the attested
   key to the specific challenge/account key, so a single TPM-backed key cannot
   be reused across ACME orders.
5. Builds a WebAuthn-style `tpm` attestation statement (CBOR) with the key's
   certification parameters and AK chain, POSTs it via
   `ac.ValidateWithPayload`, and polls the challenge status.
6. Installs the attested key's signer into the ACME flow (`af.tpmSigner`) so the
   subsequent certificate request is signed by the TPM-backed key.

## KMS in CA initialization

`step ca init --kms azurekms` is the one place the CLI itself (not the plugin)
manages keys: it constructs a `kms.KeyManager` and prompts for root,
intermediate, and optional SSH host/user key URIs, which are passed to the PKI
generation via `pki.WithKMS`/`pki.WithKeyURIs` (command/ca/init.go:464-518).
`--kms` and `--ra` are mutually exclusive.

## Failure behavior

Plugin failures surface as wrapped errors quoting the failed command and its
stderr (`exitError`). If `step-kms-plugin` is not installed, `plugin.LookPath`
errors propagate from the `key`/`sign`/`certificate`/`attest` invocations. Keys
that cannot sign X.509 (e.g. sshagentkms RSA) are rejected at key-load time
rather than at signing time.
