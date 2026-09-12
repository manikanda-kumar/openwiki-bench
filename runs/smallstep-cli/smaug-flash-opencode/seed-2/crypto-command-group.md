---
type: "Reference"
title: "Crypto command group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-94ab4d15cfde41a9ebf6a5b1
    resource: repo://command/crypto/kdf/kdf.go
  - id: openwiki-source-cbdbf656575c3c23d8f33ae7
    resource: repo://command/crypto/keypair.go
  - id: openwiki-source-43f82bca17775bc861344237
    resource: repo://internal/kdf/kdf.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---


## Responsibility

The `step crypto` command group ([`command/crypto/crypto.go`](../../command/crypto/crypto.go))
is a general-purpose crypto toolkit that "balances completeness and safety
(cryptographic strength, ease of use, and misuse prevention)". It implements a
selection of JOSE/JWK/JWT/JWS/JWE primitives, key derivation functions, keypair
creation, NaCl authenticated encryption/signing, one-time passwords, hashing,
and more, using safe defaults wherever possible.

## Safety gating

`command/crypto/crypto.go` documents the group's security posture: insecure or
subtle primitives are gated behind flags (`--insecure` and `--subtle`
respectively), so such operations require the user to affirm that they
understand the risks. It also documents key-length guidance:
- Symmetric keys: minimum 256 bits (considered quantum-safe).
- RSA: minimum 2048 bits (recommend 3072+ beyond 2030).
- EC curves P-256/P-384/P-521 and OKP Ed25519.

The group's documentation notes that none of the implemented public-key
algorithms are quantum safe, that keys sized for forward secrecy confer
additional protection, and that the tool does not gate "non-safe curves" but
selects P-256 as the default EC curve.

## Subcommand groups

Registered subcommands in `crypto.go`:

- `change-pass` — change the password protecting an encrypted private key.
- `keypair` — generate a public/private keypair in PEM format.
- `jwk` (in `command/crypto/jwk`) — create JWKs, key sets, public keys,
  thumbprints.
- `jwt` (in `command/crypto/jwt`) — sign, verify, and inspect JWTs.
- `jwe` (in `command/crypto/jwe`) — encrypt/decrypt data and wrap private keys.
- `jws` (in `command/crypto/jws`) — sign, verify, and inspect JWS.
- `jose` (in `command/crypto/jose`) — general JOSE/JWK operations.
- `hash` — file hashing.
- `kdf` — password hashing and verification.
- `key` — key inspection, formatting, signing, verification, fetching public part.
- `nacl` — NaCl crypto_box/secretbox/auth/sign.
- `otp` — TOTP/HOTP one-time password generation and verification.
- `rand` — random data generation.
- `winpe` — Windows PE signing helpers.

## Key derivation functions

[`internal/kdf/kdf.go`](../../internal/kdf/kdf.go) provides the core KDF
functions behind `kdf`:

- `KDF` is a functional type `func(password []byte) (string, error)`.
- `Scrypt` uses `scrypt-32768` (N=32768, r=8, p=1) and returns a PHC string.
- `Bcrypt` uses `bcrypt.GenerateFromPassword` with `bcrypt.DefaultCost` (cost
  10) and returns a Modular Crypt Format string.
- `Argon2i` and `Argon2id` use the Argon2 library with safe default parameters
  and return PHC strings with `argon2i$v=` / `argon2id$v=` identifiers.
- `Compare(password, phc)` decodes the PHC string and recomputes/compares the
  hash using constant-time comparison (constant time in the slice length and
  independent of contents); `CompareString` is a convenience wrapper.
- `phc.go` provides `phcEncode`/`phcDecode`; `scrypt.go` and `argon2.go` hold
  parameter tables and `newScryptParams`/`newArgon2Params`.

The `kdf` command group (`command/crypto/kdf/kdf.go`) exposes `hash` (default
algorithm `scrypt`) and `compare`. If the input is passed as a positional
argument rather than read (prompted) from STDIN, the `--insecure` flag is
required because the secret could be logged; prompting is the recommended path.

## Keypair creation defaults

`command/crypto/keypair.go` creates PEM keypairs using flags for
`--kty`/`--curve`/`--size`, `--password-file`, `--no-password`, and `--insecure`.
Private keys are encrypted with a password (prompted for automatically on use).
Key-detail parsing is centralized in `utils.GetKeyDetailsFromCLI`
([`utils/cli.go`](../../utils/cli.go)), which enforces:
- Defaults: EC over curve P-256, or RSA at 2048 bits when `--kty RSA` and no
  `--size` is given.
- RSA `--size` must be at least 2048 bits unless `--insecure`.
- EC curve must be one of P-256, P-384, P-521.
- OKP must be Ed25519 (default).
- Obsolete or conflicting flag combinations (e.g. `--size` with EC, `--curve`
  with RSA) are rejected.

## Underlying libraries

The group is built on top of `go.step.sm/crypto/jose`, `keyutil`, `pemutil`,
`x509util`, the `golang.org/x/crypto` KDF/NaCl/OTP libraries, and
`github.com/pquerna/otp`. `pkg/bcrypt_pbkdf` is a standalone vendored copy of
the bcrypt-pbkdf derivation used elsewhere.

## Relationships

The token/claim package ([token-claim.md](token-claim.md)) reuses the jose
signing machinery; the CA integration ([ca-integration.md](ca-integration.md))
consumes generated keys and JWKs for provisioner configuration; the certificate
group ([certificate-command-group.md](certificate-command-group.md)) shares
PEM/key outline.
