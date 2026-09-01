---
type: kms-and-plugin-integrations
title: KMS and Plugin Integrations
description: How step delegates key operations to external tools — the step-<name>-plugin convention, step-kms-plugin signers, and TPM attestation in ACME flows.
tags: [kms, plugins, hsm, tpm, attestation, integration]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-5cb498dbff5a2aba7f81df22
    resource: repo://command/ca/rekey.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
  - id: openwiki-source-57d7d8b1ea53edb457db35b8
    resource: repo://utils/cautils/tpm.go
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# KMS and Plugin Integrations

## The plugin convention

Unknown top-level commands are dispatched to executables named
`step-<name>-plugin`, searched first in `$STEPPATH/plugins` and then on
`PATH` (with Windows `PATHEXT` handling). The child process inherits
stdin/stdout/stderr; `.ps1` files are run through PowerShell on Windows. The
only well-known plugin URL hardcoded today is `kms` →
`https://github.com/smallstep/step-kms-plugin` (repo://internal/plugin/plugin.go#L20-L82).

## The file-vs-URI resolution heuristic

`internal/cryptoutil` is the seam between plain files and KMS-backed keys. Its
convention: **if the name exists as a file, it is treated as a file; otherwise
it is treated as a KMS URI**. `IsKMS` returns false when a file exists at the
path even if it matches a KMS URI pattern, and requires `kms.TypeOf` to
recognize the scheme and not be `DefaultKMS` (repo://internal/cryptoutil/cryptoutil.go#L26-L43).

Public API of this seam (repo://internal/cryptoutil/cryptoutil.go#L52-L175):

- `PublicKey` / `CreateSigner` — read via `pemutil` for files, or build a
  `kmsSigner`/`kmsPublicKey` for KMS URIs;
- `LoadCertificate` — `pemutil.ReadCertificateBundle` for files, or
  `step-kms-plugin certificate` output for URIs;
- `LoadJSONWebKey` — `jose.ReadKey` for files, or wraps the KMS signer in a
  `jose.JSONWebKey` with `Use: "sig"`, a default algorithm chosen from the
  public key type (ES256/384/512 by curve, RS256 for RSA, EdDSA for Ed25519),
  and the JOSE thumbprint as `kid`;
- `CreateAttestor` — returns an attestor backed by `step-kms-plugin`.

Callers include token generation (`generateX5CToken` uses
`cryptoutil.CreateSigner` and `LoadCertificate`,
repo://utils/cautils/token_generator.go#L195-L273), certificate creation and
signing commands, and CA renew/rekey (repo://command/certificate/create.go,
repo://command/ca/renew.go, repo://command/ca/rekey.go).

## How step-kms-plugin is invoked

`newKMSSigner` locates the plugin via `plugin.LookPath("kms")`, runs
`step-kms-plugin key [--kms <uri>] <name>` and parses the PEM public key from
stdout (repo://internal/cryptoutil/cryptoutil.go#L229-L260). Signing is a
second process invocation: `step-kms-plugin sign --format base64 [--kms <uri>]
[--alg <hash>] <key>` with the digest piped to stdin and the base64 signature
decoded from stdout. RSA keys get `--alg SHA256/384/512` mapped from the
`crypto.SignerOpts` hash, PSS options become `--pss --salt-length`, and
unsupported hashes fail (repo://internal/cryptoutil/cryptoutil.go#L306-L344).

Type guards complete the seam: `IsKMSSigner` recognizes the internal
`kmsSigner` type, and `IsX509Signer` checks Go `crypto/x509` compatibility —
true for ECDSA/RSA/Ed25519, but for `sshagentkms:` URIs only for Ed25519 keys
(repo://internal/cryptoutil/cryptoutil.go#L177-L205).

Attestation is exposed through the same signer: `kmsSigner.Attest` runs
`step-kms-plugin attest [--kms <uri>] <key>` and returns the raw attestation
certificate bytes (repo://internal/cryptoutil/cryptoutil.go#L346-L362). The
`Attestor` interface combines `crypto.Signer` with this method
(repo://internal/cryptoutil/cryptoutil.go#L45-L50).

## TPM attestation in ACME flows

`utils/cautils/tpm.go` implements TPM 2.0 attestation for ACME challenges: it
opens a TPM, creates/loads an Attestation Key, performs the go-attestation
attestation protocol against an Attestation CA (`newAttestationClient`,
`performAttestation`), verifies identity via Endorsement Keys (EK certificate
chain and preferred EK selection), and submits the attestation statement as
part of the ACME `token` challenge (repo://utils/cautils/tpm.go#L40-L60,
repo://utils/cautils/tpm.go#L453-L568).

The `step ca certificate` command surfaces this through flags: an attestation
URI (`flags.AttestationURI`), `--attestation-ca-url`, trusted roots for the
attestation CA, and `--tpm-storage-directory` defaulting to
`$(step path)/tpm` (repo://command/ca/certificate.go#L165-L199).

## Operational consequences and failure behavior

- Every KMS operation shells out to an external binary; the plugin must be
  installed and on `PATH` or in `$STEPPATH/plugins`, and failures surface as
  `command %q failed with: <stderr>` errors from `exitError`
  (repo://internal/cryptoutil/cryptoutil.go#L219-L227).
- Signing passes only digests (never raw data) to the plugin, matching KMS
  semantics; the digest is written to the child's stdin by a goroutine
  (repo://internal/cryptoutil/cryptoutil.go#L330-L343).
- PSS salt-length support requires step-kms-plugin ≥ v0.12.0, per the inline
  comment (repo://internal/cryptoutil/cryptoutil.go#L312-L315).
- This repository does not itself implement any KMS protocol; all provider
  logic (PKCS#11, YubiKey, cloud KMS, TPM device access) belongs to
  `go.step.sm/crypto/kms` and `step-kms-plugin`.
