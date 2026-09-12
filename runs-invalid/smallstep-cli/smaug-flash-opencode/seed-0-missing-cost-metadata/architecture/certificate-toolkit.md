---
type: concept
title: Standalone Certificate, CSR, and Crypto Toolkit
description: The offline step certificate command group for creating, signing, verifying, inspecting, bundling, and installing X.509 certificates and CSRs without an online CA, plus the step crypto group of general-purpose cryptographic primitives.
tags: [x509, csr, certificate-toolkit, crypto, jose]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-d273a7589f0c5b5726260073
    resource: repo://command/certificate/inspect.go
  - id: openwiki-source-4efb704564fc803c8fbd8399
    resource: repo://command/certificate/sign.go
  - id: openwiki-source-d369a2fc6aab1546fc84613b
    resource: repo://command/certificate/verify.go
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-cbdbf656575c3c23d8f33ae7
    resource: repo://command/crypto/keypair.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---

# Standalone Certificate, CSR, and Crypto Toolkit

Beyond the online/offline `step ca` flows, the CLI ships a self-contained
certificate toolkit (`step certificate`) and a general-purpose crypto toolkit
(`step crypto`) that operate on local files without contacting a CA.

## The certificate command group

`step certificate` (`command/certificate/certificate.go`) registers
subcommands for creating certificates and CSRs, signing CSRs, verifying,
inspecting, bundling, formatting, fingerprinting, linting, installing to a
system trust store, extracting keys, checking renewal need, and producing PKCS#12
archives. `step ca certificate` is separate and routes through the CA flows.

### Creating certificates and CSRs: `create`

`create.go` implements `step certificate create`. It supports the mutually
exclusive `--profile` or `--template` mode. Profiles are `leaf` (default, 24h
validity), `intermediate-ca` (10y), `root-ca` (10y, self-signed), and
`self-signed` (24h, requires `--subtle`). When `--template` is used, validity
defaults to 24h. Default validity is applied when `--not-after` is unset, and the
command rejects an expired `--not-after`.

Arguments are `<subject> <crt-file> <key-file>`; the key file is optional only if
`--key` is provided (which supplies an existing private key rather than
generating one). New keys are generated through `utils.GetKeyDetailsFromCLI`,
which defaults to `EC` / `P-256` and enforces a 2048-bit RSA minimum unless the
`--insecure` flag is set. `--no-password` (write the private key unencrypted)
requires `--insecure`.

`createAction` builds an X.509 certificate via `go.step.sm/crypto/x509util`,
using either the CSR-signing path (`x509util.NewCertificate`) or a
PublicKey-only path when `--skip-csr-signature` is set (required when `--key`
holds a public key). The signing parent is resolved by `parseSigner`, which
requires `--ca` and `--ca-key` for `leaf` and `intermediate-ca` profiles and
rejects them for `root-ca` and `self-signed`. `parseOrCreateKey` supports file or
KMS-backed keys via `internal/cryptoutil`. With `--csr`, the command produces a
CSR instead of a certificate.

### Signing a CSR: `sign`

`sign.go` implements `step certificate sign <csr-file> <crt-file> <key-file>`.
After validating the CSR signature, it loads the
issuer (`cryptoutil.LoadCertificate`) and issuer key (`cryptoutil.CreateSigner`),
and aborts if the key cannot sign X.509 or does not match the issuer's public
key (`validateIssuerKey`). Profiles `leaf`, `intermediate-ca`, and `csr` select
built-in templates; `intermediate-ca` supports `--path-len` and is validated
against the issuer's `pathLenConstraint` by `validateIssuer`. `--bundle` appends
the issuer certificate(s), `--omit-cn-san` controls whether the Common Name is
added as a SAN, and `--set`/`--set-file` feed template data.

### Verifying: `verify`

`verify.go` runs the RFC 5280 path validation via `cert.Verify` for a local file
or a remote peer's certificates (`getPeerCertificates`), with `--roots` (file,
list, or directory) and `--host`/`--servername`. It optionally checks CRL and
OCSP: `--verify-crl` consults `CRLDistributionPoints` (or `--crl-endpoint`),
downloading and parsing the CRL and comparing the leaf serial; `--verify-ocsp`
queries `OCSPServer` (or `--ocsp-endpoint`) with an OCSP request built from the
certificate and its issuer. The issuing CA is taken from `--issuing-ca` or the
certificate's `IssuingCertificateURL`.

### Inspecting: `inspect`

`inspect.go` prints certificate/CSR details in `text`, `json`, or `pem` format,
optionally `--bundle`, for a local file or `-`, or fetches a remote peer's
certificates over TLS (verifying with `--roots`). `--short` disables JSON/PEM
output. Bundles output the first certificate unless `--bundle` is passed, in which
case all are shown in order.

### Bundling and installing

`bundle.go` writes a chain of `<crt-file>` followed by its issuing CA to a
`<bundle-file>`. `install.go` / `p12.go` place the certificate into the system
trust store or a PKCS#12 archive; `install` uses the `smallstep/truststore`
dependency. Other subcommands: `fingerprint` (formats per `flags.FingerprintFormatFlag`),
`format` (PEM/DER conversion), `lint` (the `smallstep/zlint` checks), `key`
(extract the public key), and `needsRenewal`.

## The crypto command group

`step crypto` (`command/crypto/crypto.go`) exposes a "cryptographic plumbing"
toolkit whose unsafe options are gated behind the `--subtle` and `--insecure`
flags. The command's help documents key-length floor (256-bit symmetric, 2048-bit
RSA), the supported curves (P-256, P-384, P-521, Ed25519), and the stance that
none of the implemented public-key algorithms are quantum-safe.

Subcommand groups include:
- `keypair` (`keypair.go`): generate a raw PEM public/private key pair, or
  convert from a JWK with `--from-jwk`. Keys default to EC/P-256 and are
  encrypted; `--no-password` requires `--insecure`.
- `key` (`command/crypto/key/key.go`): format/public/inspect/fingerprint/sign/
  verify operations on key files.
- `jose`, `jwt`, `jws`, `jwe`: `step crypto jose` and the JWT/JWS/JWE
  sign/verify/inspect/encrypt/decrypt operations.
- `jwk` (`command/crypto/jwk`): create/keyset/public/thumbprint operations on
  JSON Web Keys and Key Sets.
- `hash`, `kdf` (scrypt, argon2, bcrypt comparison via `internal/kdf`), `nacl`
  (auth, box, secretbox, sign), `otp` (TOTP generate/verify), `rand`, and `winpe`.

## Shared flags for key material

The key/curve/size flags (`--kty`, `--curve`, `--size`) are defined in
`flags/flags.go` and shared across the toolkit. `utils.GetKeyDetailsFromCLI`
(`utils/cli.go`) validates the combination: RSA requires `--size` (default 2048),
EC requires a supported curve (default P-256), and OKP supports only Ed25519;
the defaults when no flags are given are EC/P-256. `--subtle` (delicate
operations) and `--insecure` (insecure operations) gate high-risk paths.

## Relation to KMS

The standalone toolkit is a primary consumer of the KMS integration seam:
`--kms` URIs and `--ca-kms`/`--ca-key` can back key generation, CSR signing, and
certificate signing through `internal/cryptoutil`, which dispatches to
`step-kms-plugin` when the key reference is not a file. See the
<!-- openwiki: broken internal link [./integrations/km-system-and-external-pki.md] file "./integrations/km-system-and-external-pki.md" does not exist. Fix the href or restore the target, then delete this comment. -->
[KMS and external PKI integration](./integrations/km-system-and-external-pki.md)
page.
