---
type: concept
title: Crypto Toolkit and Key Material
description: How the step crypto command group provides JWT/JWS/JWE/JWK/JOSE, KDF, OTP, nacl, hash, and keypair operations with secure defaults and --insecure/--subtle gating.
tags: [crypto, jose, jwt, jws, jwe, jwk, kdf, otp, nacl, step-cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:42:28.757Z
sources:
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-de56a7f013c914abea1b5a39
    resource: repo://command/crypto/jose/jose.go
  - id: openwiki-source-dc8182e26ff530a41971d72d
    resource: repo://command/crypto/jws/jws.go
  - id: openwiki-source-3366fea11fc7ad406ab418a9
    resource: repo://command/crypto/jwt/jwt.go
  - id: openwiki-source-cbdbf656575c3c23d8f33ae7
    resource: repo://command/crypto/keypair.go
  - id: openwiki-source-8d273008d6963aaf2e8448ae
    resource: repo://command/crypto/nacl/nacl.go
  - id: openwiki-source-afbfd40e83f88bda82951c69
    resource: repo://command/crypto/otp/otp.go
  - id: openwiki-source-43f82bca17775bc861344237
    resource: repo://internal/kdf/kdf.go
generated: { by: "opencode", at: "2026-09-12T20:42:28.757Z" }
---

# Crypto Toolkit and Key Material

The `step crypto` command group is a general-purpose cryptographic toolkit that
balances completeness and safety: secure defaults are selected, and insecure or
subtle primitives/options are gated behind flags (`--insecure`, `--subtle`).
Its help banner documents key-length, key-use, safe-curve, and quantum-safety
considerations (`command/crypto/crypto.go`).

## JOSE: JWT, JWS, JWE, JWK, and jose

- **JWT**: sign and verify JSON Web Tokens (`step crypto jwt sign`,
  `verify`, `inspect`) (`command/crypto/jwt/jwt.go`).
- **JWS**: sign/verify JSON Web Signature over arbitrary data, including
  `--json` verification output (`command/crypto/jws/jws.go`).
- **JWE**: encrypt/decrypt data and wrap private keys using JSON Web
  Encryption (`command/crypto/jwe/jwe.go`).
- **JWK**: create keys, key sets, public keys, thumbprints
  (`command/crypto/jwk/jwk.go`).
- **jose format**: swap between compact and JSON serialization for JWT/JWS/JWE
  reading from stdin (`command/crypto/jose/jose.go`).

## Key pairs

`step crypto keypair` generates a raw public/private keypair in PEM format for
use by signing/encryption operations)Skip. Key parameters use the same
centralized validation as certificate creation (RSA/EC/OKP; see
`utils/cli.go`), with RSA keys defaulting to at least 2048 bits unless
`--insecure` relaxes it. Private keys are encrypted with a password
(`command/crypto/keypair.go`).

The `step crypto key` command inspects, formats, fingerspublic, signs, and
verifies using keys (`command/crypto/key/`).

## KDF and password hashing

`internal/kdf` implements scrypt-32768, bcrypt, and Argon2i hash functions:

- `Scrypt` returns a PHC-format string using scrypt-32768 with a random salt.
- `Bcrypt` uses modular crypt format at default cost.
- `Argon2i` returns a PHC string, optimized to resist side-channel attacks.

`step crypto kdf hash` computes these hashes and `step crypto kdf compare`
verifies passwords. `step crypto kdf` is used for password verification in
other flows (`internal/kdf/kdf.go`, `command/crypto/kdf/`).

## TOTP, NaCl, hash, rand

- `step crypto otp generate` and `step crypto otp verify` implement TOTP
  multi-factor authentication (`command/crypto/otp/`).
- `step crypto nacl` exposes NaCl high-speed `auth`, `box`, `secretbox`, and
  `sign` operations (`command/crypto/nacl/`).
- `step crypto hash` computes file hashes.
- `step crypto rand` generates random data, and `step crypto winpe` handles
  Windows PE-specific keys (`command/crypto/winpe/`).

## Security gating

Subcommands that need to relax safe defaults require an explicit affirmative
flag:

- `--insecure` gates insecure operations (e.g. RSA keys below 2048 bits,
  writing unencrypted keys).
- `--subtle` gates delicate operations (e.g. self-signed leaf certificates).

The help text describes the security implications, and where an operation may
be risky the user is prompted or must pass the gating flag
(`command/crypto/crypto.go`).
