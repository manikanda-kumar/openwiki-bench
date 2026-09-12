---
type: certificates
title: Certificate Command Group
description: The step certificate group for creating CSR/certificates, signing, inspecting, verifying against roots/OCSP/CRL, and installing root certificates into trust stores.
tags: [certificates, x509, csr, tls, truststore]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-d273a7589f0c5b5726260073
    resource: repo://command/certificate/inspect.go
  - id: openwiki-source-455e13fae8bb72a40c8b6ba6
    resource: repo://command/certificate/install.go
  - id: openwiki-source-d369a2fc6aab1546fc84613b
    resource: repo://command/certificate/verify.go
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---

# Certificate Command Group

The `step certificate` group (command/certificate/certificate.go) manages
X.509 certificates and CSRs: creating, signing, inspecting, verify, linting,
bundling, formatting, key extraction, install/uninstall, and PKCS#12
conversion. Its subcommands are registered in `certificate.go:84-98`.

## create

`step certificate create` (command/certificate/create.go) generates a
certificate or CSR from a key pair bought/generated on disk or backed by a KMS.

Supported profiles (`create.go:25-39`):

- `leaf` (default) — a TLS leaf certificate.
- `intermediate-ca` — a certificate able to sign leaf/intermediate certs.
- `root-ca` — a self-signed root CA certificate.
- `self-signed` — a self-signed leaf (requires `--subtle`).
- `csr` — with `--csr`, generate a certificate signing request instead.

Default validities are per profile (`create.go:33-39`): leaves 24h, intermediates
and roots 10 years, and template-based certs 24h.

Key material rules:

- Keys are generated via `parseOrCreateKey` (create.go:773-836). When `--key` is
  absent a new key is generated with `keyutil.GenerateKeyPair(kty, curve, size)`
  per the `--kty`/`--curve`/`--size` flags (defaults EC P-256). When present,
  the key is loaded (optionally through a KMS via `--kms`), and `--kty`/`--curve`
  /`--size` become incompatible.
- Private keys are encrypted when written (`savePrivateKey`, create.go:912-934)
  unless `--no-password`+`--insecure` is given.
- Certificates may be generated directly from a supplied public key with
  `--skip-csr-signature` (used for KMS decryption-key scenarios).

Templates: the certificate/CSR body can be customized with a Go
`text/template`-based JSON template via `--template`, feeding variables
`.Subject` and `.SANs` and user data from `--set`/`--set-file`. A template and a
`--profile` are mutually exclusive (create.go:538-540).

`parseSigner` (create.go:841-909) resolves the parent issuer: for `leaf` and
`intermediate-ca` profiles it requires `--ca` and `--ca-key`; for `root-ca`/
`self-signed` any `--ca`/`--ca-key` is rejected; with a template, the signer is
used only when `--ca`/`--ca-key` are passed options. `--bundle` appends the
issuer certificate to the output.

Flag validation is strict and uses `cli-utils/errs` helpers — incompatible flag
combinations (`--csr` with `--profile`, `--not-before` after `--not-after`,
`--no-password` without `--insecure`, `--bundle` with a non-leaf profile)
produce explicit errors before any key generation.

## sign

`step certificate sign` (command/certificate/sign.go:46+ ) signs an existing
CSR with an issuing certificate and key. It supports the `leaf` and
`intermediate-ca` profiles plus templates, and the `--path-len` flag controls
the `maxPathLen` for an intermediate (`customIntermediateTemplate`).
`--bundle` appends the issuing certificate, and `--omit-cn-san` controls
whether the CN is mirrored as a SAN.

## inspect

`step certificate inspect` (command/certificate/inspect.go) prints certificate
or CSR details in text or JSON (`--format`), with `--short` and `--bundle`
options. It uses `certinfo` and `zcrypto/x509`. The docs explicitly warn that
local certificates are never verified by inspect and that users should run
`step certificate verify` first.

## verify

`step certificate verify` (command/certificate/verify.go) executes RFC 5280
certificate path validation with optional custom roots (`--roots`), hostname
checking, and OCSP (`--verify-ocsp`) or CRL (`--verify-crl`) status checks. It
can also validate remote certificates by URL over TLS. It returns 0 on valid,
non-zero otherwise, and uses `internal/crlutil` for CRL parsing.

## install / uninstall

`step certificate install` (command/certificate/install.go) installs a root
certificate into the system trust store via `smallstep/truststore`, with
options for Java (`--java`), Firefox (`--firefox`), the system default
(`--no-system` to skip), and `--all`. `uninstall` removes it.

## Other helpers

- `bundle` — combine an end-entity cert with issuing certs.
- `format` — convert PEM <-> DER.
- `fingerprint` — print a certificate fingerprint.
- `key` — extract a public key from a certificate.
- `needsRenewal` — determine whether a certificate needs renewal.
- `p12` — PKCS#12 import/export.
- `lint` — check certificates for common errors/missing fields.
- `remote` — retrieve/inspect certificates from remote servers.

## Related

- [Certificate and Token Flows](../architecture/token-flows.md) — CA-backed issuance.
- [Configuration, Environment, and the Step Path](../configuration/env-and-step-path.md) — defaults/roots.
- [KDF and Crypto Primitives](../crypto/kdf-and-primitives.md) — crlutil/cryptoutil helpers.
