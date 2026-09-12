---
type: "Reference"
title: "Certificate command group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-d273a7589f0c5b5726260073
    resource: repo://command/certificate/inspect.go
  - id: openwiki-source-2f8947cb371741300d028072
    resource: repo://command/certificate/lint.go
  - id: openwiki-source-8df833e7257eb456286e631b
    resource: repo://command/certificate/needsRenewal.go
  - id: openwiki-source-82fd4fa4e59959a7d48ef2b1
    resource: repo://command/certificate/p12.go
  - id: openwiki-source-d369a2fc6aab1546fc84613b
    resource: repo://command/certificate/verify.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-02cba02a31978f84a900def3
    resource: repo://internal/crlutil/crlutil.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---


## Responsibility

The `step certificate` command group ([`command/certificate/certificate.go`](../../command/certificate/certificate.go))
provides standalone facilities for working with X.509 certificates without
necessarily contacting a CA: creating CSRs and certificates, signing and
verifying, inspecting, linting, bundling, fingerprinting, key extraction,
install/uninstall into a system trust store, PKCS#12 packaging, and renewal
checking. It relies on `internal/cryptoutil` for KMS-aware key handling and on
`internal/crlutil` for parsing and formatting certificate revocation lists.

## Command group overview

Subcommands registered in `certificate.go`:

- `create`: create a certificate or certificate signing request.
- `bundle`: bundle an end-entity certificate with its issuers.
- `format`: convert between PEM/DER and binary formats.
- `inspect`: display certificate contents.
- `fingerprint`: compute certificate fingerprints (hex/base64/emoji).
- `lint`: run zlint-based checks for common errors.
- `needsRenewal`: check whether a certificate should be renewed.
- `sign`: sign a certificate request with a CA certificate/key.
- `verify`: verify a signature against a roots bundle.
- `key`: extract the public key from a certificate.
- `install` / `uninstall`: add/remove a root certificate to/from the system
  trust store.
- `p12`: create PKCS#12 (PFX) bundles.

## Create and its profiles

[`command/certificate/create.go`](../../command/certificate/create.go) defines
four generation profiles plus a CSR-only pseudo profile:

- `profileLeaf = "leaf"` — a leaf (end-entity) certificate.
- `profileSelfSigned = "self-signed"` — a self-signed certificate (usable as a
  root).
- `profileIntermediateCA = "intermediate-ca"` — a subordinate CA.
- `profileRootCA = "root-ca"` — a root CA.
- `profileCSR = "csr"` — used on `sign` to indicate a CSR is being produced/consumed.

Default validity durations:
`defaultLeafValidity = 24h`, `defaultSelfSignedValidity = 24h`,
`defaultIntermediateValidity = 10 years`, `defaultRootValidity = 10 years`,
`defaultTemplatevalidity = 24h`.

The command accepts `--kty`/`--curve`/`--size` for the key type (defaults EC
P-256), `--csr` to emit a CSR, `--template` for a JSON certificate template,
`--set`/`--set-file` for template data, `--not-before`/`--not-after`,
`--san`, `--ca`/`--ca-key`/`--ca-password-file`/`--ca-kms` for issuing under a
CA or KMS, `--kms`, `--bundle`, `--skip-csr-signature`, and the security gates
`--no-password`, `--subtle`, `--insecure`.

Templates are a central customization mechanism: the JSON representation of the
certificate to create. `command/certificate/sign.go` includes built-in custom
intermediate/leaf templates (e.g. `customIntermediateTemplate` sets `certSign`/
`crlSign` key usage and `isCA: true`, and `customLeafTemplate` derives parsed
CSR subject/SANs). Template data variables are supplied via `--set`/`--set-file`
and are parsed by `flags.GetTemplateData`.

## Internal cryptoutil

[`internal/cryptoutil/cryptoutil.go`](../../internal/cryptoutil/cryptoutil.go)
supports KMS-backed keys and certificate operations:

- `IsKMS(rawuri)` returns true when the given URI is a KMS URI, unless a file of
  that exact name exists. It uses `kms.TypeOf` and returns false for the default
  KMS type.
- `Attestor` is the interface implemented by the step-kms-plugin (`key`, `sign`,
  and `attest` commands): it embeds `crypto.Signer` and adds `Attest() ([]byte,
  error)`.
- Helpers such as `PublicKey`, signer/CSR creation, certificate signing, and key
  management route through the plugin when a KMS URI is used.

## CRL helpers

[`internal/crlutil/crlutil.go`](../../internal/crlutil/crlutil.go) provides
structured CRL handling:

- `CRL` is the JSON representation of a certificate revocation list with fields
  for version, signature algorithm, issuer, `this_update`/`next_update`,
  revoked certificates, extensions, and signature.
- `ParseCRL(b)`: if the input starts with the PEM CRL prefix, decodes the PEM
  block; otherwise assumes raw DER; then calls `x509.ParseRevocationList`.
- `pemCRLPrefix = "-----BEGIN X509 CRL"` and `pemType = "X509 CRL"` identify PEM
  encoding.

<!-- openwiki: broken internal link [../../command/crl] file "../../command/crl" does not exist. Fix the href or restore the target, then delete this comment. -->
The `cmd/crl` package ([`command/crl`](../../command/crl)) exposes CRL parsing by
`step crl`, and signature-algorithm handling lives in
`internal/crlutil/signature_algorithms.go` with extensions helpers in
`internal/crlutil/crl_extensions.go`.

## Packaging (PKCS#12)

`command/certificate/p12.go` produces PKCS#12 (PFX) bundles from a
certificate/key/chain, using the `software.sslmate.com/src/go-pkcs12` library
(declared in `go.mod`), with password and encryption options. This is the 
"packaging" operation named in the brief.

## Verification, linting, and inspection

- `verify` (`command/certificate/verify.go`) checks a certificate signature
  against `--roots` (and `--intermediates`) using `x509.Verify`.
- `lint` (`command/certificate/lint.go`) runs `zlint`-based checks on PEM
  certificates to surface common errors and missing fields.
- `inspect` (`command/certificate/inspect.go`) renders the parsed certificate
  (human-readable, JSON, or template output).
- `needsRenewal` (`command/certificate/needsRenewal.go`) reports whether a
  certificate is within its renewal window, used by automation.

## Relationships

The certificate group is a general-purpose PKI toolkit largely independent of
`step-ca`; it overlaps conceptually with the general [crypto group](crypto-command-group.md)
(also key-issueing) and is built on the shared flags and dispatcher described in
[architecture](architecture.md). The online CA-backed equivalent flows are in
[ca-integration](ca-integration.md).
