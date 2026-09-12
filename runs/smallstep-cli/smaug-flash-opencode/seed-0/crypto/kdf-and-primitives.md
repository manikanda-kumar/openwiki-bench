---
type: crypto
title: KDF and Crypto Primitives
description: The crypto command group and internal KDF/key/CRL helpers, including scrypt/bcrypt/argon2 password hashing, PHC encoding, KMS-backed signers, and CRL utilities.
tags: [crypto, kdf, scrypt, bcrypt, argon2, crl, kms]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-94ab4d15cfde41a9ebf6a5b1
    resource: repo://command/crypto/kdf/kdf.go
  - id: openwiki-source-02cba02a31978f84a900def3
    resource: repo://internal/crlutil/crlutil.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-43f82bca17775bc861344237
    resource: repo://internal/kdf/kdf.go
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---

# KDF and Crypto Primitives

This page covers the cryptographic building blocks used by `step`: the `crypto`
command group, the internal KDF helpers for password hashing/verification,
cryptoutil helpers for loading keys (including KMS-backed keys), and CRL
utilities used by certificate verification.

## The crypto command group

`step crypto` (command/crypto/crypto.go) provides "useful cryptographic
plumbing", registering subcommand groups: `jwk`, `jwt`, `jwe`, `jws`, `jose`,
`hash`, `kdf`, `key`, `nacl`, `otp`, `rand`, `winpe`, `keypair`, and
`change-pass`. Its long description documents security considerations, key
sizing rules (minimum RSA 2048 bits, symmetric 256 bits, default EC curve
P-256), safe-curve guidance, and the `--insecure`/`--subtle` gating philosophy.

`step crypto kdf` (command/crypto/kdf/kdf.go) is the KDF-facing group with two
subcommands:

- `hash` (default algorithm `scrypt`) reads input from a TTY prompt or STDIN,
  applies the selected KDF, and prints a PHC-format string.
- `compare` takes a PHC-format hash and verifies a plaintext value, printing
  `ok` on success and failing (non-zero) otherwise.

Both commands require the hidden `--insecure` flag when a secret input is
given as a command-line argument, to discourage secrets from appearing in
shell history.

## KDF implementation

`internal/kdf/kdf.go` defines `KDF func(password []byte) (string, error)` with
four implementations:

- `Scrypt` uses scrypt-32768 (N=32768, r=8, p=1) and returns a PHC-encoded
  hash.
- `Bcrypt` uses `bcrypt.DefaultCost` and returns a bcrypt (modular crypt format)
  string.
- `Argon2i` returns a PHC-encoded Argon2i hash (optimized against side-channel
  attacks).
- `Argon2id` returns a PHC-encoded Argon2id hash (hybrid GPU/side-channel
  resistant).

`Compare(password, phc)` (kdf.go:88-130) decodes the PHC string, re-derives the
hash with the recorded algorithm/parameters, and uses `subtle.ConstantTimeCompare`
so the comparison time is independent of the password contents. It dispatches on
the PHC algorithm id (`bcrypt`, `scrypt`, `argon2i`, `argon2id`) and rejects
unsupported versions/ids.

The PHC encoding/decoding lives in `internal/kdf/phc.go`, and scrypt-specific
parameter handling in `internal/kdf/scrypt.go`.

## cryptoutil: key and signer loading

`internal/cryptoutil/cryptoutil.go` provides helpers to load or create keys
from either files or KMS systems, delegating to the `step-kms-plugin`:

- `CreateSigner(kmsURI, name)` (cryptoutil.go:74-87) reads a `crypto.Signer`
  from a file, or builds a `kmsSigner` that shells out to `step-kms-plugin`.
- `PublicKey` reads a public key from a file or KMS.
- `LoadJSONWebKey` loads a JWK from a file or KMS and sets the algorithm and
  `kid` based on the key type (ES256/ES384/ES512/RS256/EdDSA).
- `LoadCertificate` loads an X.509 certificate from a file or via the
  `step-kms-plugin certificate` command.
- `IsKMSSigner` / `IsX509Signer` (cryptoutil.go:178-205) tell whether a signer
  is KMS-backed and whether it can sign X.509 certificates (ECDSA/RSA/Ed25519);
  for `sshagentkms:` KMS only Ed25519 counts.
- `CreateAttestor` and the `Attestor` interface (cryptoutil.go:47-50, 173-175)
  support TPM/attestation flows.
- `kmsSigner.Sign` (cryptoutil.go:306-344) invokes `step-kms-plugin sign` with
  the appropriate hash algorithm (and PSS salt length for RSA-PSS).

`IsKMS` (cryptoutil.go:28-38) determines whether a URI is a KMS URI, returning
false if a file exists with the same name or the KMS type is the default.

## CRL utilities

`internal/crlutil/crlutil.go` parses and produces certificate revocation lists.

- `CRL` (crlutil.go:22-33) is the JSON representation of a CRL, including
  version, signature algorithm, issuer, this/next update, revoked certificates,
  and extensions.
- `ParseCRL` (crlutil.go:42-50) detects PEM (`-----BEGIN X509 CRL`) or DER
  encoding and uses `x509.ParseRevocationList`.

`verify` (command/certificate/verify.go) uses these primitives for CRL-based
status checks, plus sig algorithms in `internal/crlutil/signature_algorithms.go`
and extension helpers in `crl_extensions.go`.

## Related

- [Certificate Command Group](../certificates/certificate-commands.md) — CRL use in verification.
- [CLI Runtime and Command Registration](../architecture/command-runtime.md) — how crypto subcommands register.
