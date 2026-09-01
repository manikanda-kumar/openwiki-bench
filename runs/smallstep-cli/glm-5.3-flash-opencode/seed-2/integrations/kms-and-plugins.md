---
type: integration
title: KMS and Plugin Integrations
description: How step integrates external key stores — the exec-based step-<name>-plugin dispatch, the built-in step-kms-plugin signer bridge in internal/cryptoutil, KMS URI detection, and the in-process TPM attestation flow.
tags: [kms, plugins, hsm, tpm, attestation]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-57d7d8b1ea53edb457db35b8
    resource: repo://utils/cautils/tpm.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# KMS and Plugin Integrations

`step` integrates external cryptographic hardware and services through two
distinct mechanisms: a generic **exec-based plugin fallback** for whole
commands, and a **signer bridge** that shells out to `step-kms-plugin` for
individual key operations. A third, narrower path talks to TPMs in-process
for ACME device attestation.

## 1. Exec-based plugin dispatch

When a command name is not registered, the app's fallback action (see
[Command Dispatch](/openwiki/architecture/command-dispatch.md)) looks for
`step-<name>-plugin` — first in `$STEPPATH/plugins`, then on `PATH` — and
executes it with the remaining arguments and inherited stdio. If the name is
known but the binary is missing (`plugin.GetURL`, currently only `kms`), the
CLI prints the project download URL instead. This is how `step kms ...`
works without any KMS code in this repository: the
[step-kms-plugin](https://github.com/smallstep/step-kms-plugin) is a separate
project.

## 2. The `step-kms-plugin` signer bridge (`internal/cryptoutil`)

Commands accept `--kms <uri>` and KMS-style key references (e.g.
`pkcs11:id=4001`, `yubikey:slot-id=9a`). `internal/cryptoutil` decides per
value whether it is a file or a KMS reference:

- `IsKMS(rawuri)` returns false if a file exists at that name (even when it
  looks like a KMS URI); otherwise it asks `go.step.sm/crypto/kms`
  (`kms.TypeOf`) to classify the URI, rejecting the default (file) type.
- `CreateSigner(kmsURI, name)`: for files it uses `pemutil.Read`; for KMS
  references it builds a `kmsSigner` that shells out to the plugin:
  - **Public key**: `step-kms-plugin key [--kms <uri>] <key>` (stdout parsed
    as PEM).
  - **Sign**: `step-kms-plugin sign --format base64 [--kms <uri>] <key>`,
    piping the digest to stdin and base64-decoding the result. RSA passes
    `--alg SHA256/384/512` per the requested hash and `--pss --salt-length`
    for PSS options; non-RSA keys rely on the plugin's defaults.
  - **Attest**: `step-kms-plugin attest <key>` returns the attestation
    certificate, exposed through the `Attestor` interface
    (`crypto.Signer` + `Attest`) via `CreateAttestor`.
- `LoadCertificate` similarly execs `step-kms-plugin certificate` for
  KMS-held certificates.
- `LoadJSONWebKey` wraps the KMS signer as a JOSE opaque signer, deriving
  the JWK algorithm from the public key (ES256/384/512 by curve, RS256 for
  RSA, EdDSA for Ed25519) and the `kid` from the JWK thumbprint.

This bridge is used by, among others, `step ca renew` (KMS-resident
certificate keys), the X5C token generator (`--kms` with `--x5c-key`), and
`step ca create`-style key generation. `IsX509Signer` reports whether a
signer can sign X.509 (ECDSA/RSA/Ed25519; for `sshagentkms:` URIs only
Ed25519).

## 3. In-process TPM attestation (ACME device-attach)

`utils/cautils/tpm.go` implements the ACME device-attestation challenge
using the `go.step.sm/crypto/tpm`, `google/go-tpm`, and
`smallstep/go-attestation` libraries **in-process** (no plugin). Driven by
`step ca certificate --attestation-uri tpmkms:...`, it parses the attestation
URI (parameters `name`, `device`, `attestation-ca-url`), configures TPM
storage (`--tpm-storage-directory`) and the attestation CA
(`--attestation-ca-url`, `--attestation-ca-root`, `--attestation-ca-insecure`),
generates the attested key according to `--kty/--curve/--size`, and
completes the ACME challenge against the CA.

## URI documentation surface

The `--kms` flag help (`flags.KMSUri`) documents the supported URI schemes
and parameters (`yubikey:`, `pkcs11:`, `tpmkms:`, `cloudkms:`, `awskms:`,
`azurekms:`), which are interpreted partly by this repository's helpers and
partly by the `go.step.sm/crypto/kms` URI library and the step-kms-plugin.
