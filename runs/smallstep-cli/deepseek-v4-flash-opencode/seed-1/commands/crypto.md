---
type: "Reference"
title: "step crypto command group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-fad3c125efd2d257e435d317
    resource: repo://command/crypto/jwk/jwk.go
  - id: openwiki-source-3366fea11fc7ad406ab418a9
    resource: repo://command/crypto/jwt/jwt.go
  - id: openwiki-source-94ab4d15cfde41a9ebf6a5b1
    resource: repo://command/crypto/kdf/kdf.go
  - id: openwiki-source-c5aec1f16c8547bbd1e1036a
    resource: repo://command/crypto/winpe/winpe.go
  - id: openwiki-source-75b7456546c94f96bee19f43
    resource: repo://internal/kdf/argon2.go
  - id: openwiki-source-43f82bca17775bc861344237
    resource: repo://internal/kdf/kdf.go
  - id: openwiki-source-e88354b0c3fe800a081c381a
    resource: repo://internal/kdf/scrypt.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# step crypto command group

`step crypto` is a general-purpose cryptographic toolbox. Its design goal is
"completeness and safety": algorithms and options are selected to balance
cryptographic strength, ease of use, and misuse prevention, and unsafe
operations are gated behind explicit flags.

## Security gating and safe defaults

The group documents a security policy in its help text
(`command/crypto/crypto.go:39-159`):

- **`--insecure` / `--subtle`**: insecure or subtle primitives do not run
  unless the corresponding flag is passed. Examples include KDF input passed
  as a positional argument and the self-signed certificate profile.
- **Key sizes**: minimum 256-bit symmetric keys and 2048-bit RSA; EC defaults
  to P-256, which is also the `--kty`/`--curve` default everywhere in the CLI
  (`utils/cli.go:12-16`, `command/crypto/crypto.go:53-78`).
- **Safe curves**: Ed25519 is noted as the only "safe" curve among the
  supported ones; the non-safe curves are still enabled by default
  (`command/crypto/crypto.go:105-130`).
- **Key use**: the tool generally requires `use` to be specified when creating
  an enveloped key and enforces it when the key is used
  (`command/crypto/crypto.go:97-103`).

The group registers `change-pass`, `create-key-pair`, `jwk`, `jwt`, `jwe`,
`jws`, `jose`, `hash`, `kdf`, `key`, `nacl`, `otp`, `rand`, and `winpe`
(`command/crypto/crypto.go:160-176`).

## JOSE: jwt, jws, jwe, jwk, jose

- **`jwt`** signs, verifies, and inspects JSON Web Tokens. `sign` builds a JWT
  from issuer/audience/subject/expiry claims plus an optional payload,
  `verify` checks the signature and claims, and `inspect` prints the header,
  payload, and signature without verifying (needs `--insecure`)
  (`command/crypto/jwt/jwt.go:8-106`).
- **`jws`** signs, verifies, and inspects arbitrary data with JSON Web
  Signatures.
- **`jwe`** encrypts and decrypts data (and wraps private keys) with JSON Web
  Encryption.
- **`jwk`** creates JWKs and manages JWK Sets (RFC 7517): `create`, `keyset`
  (add/list/find/remove), `public`, and `thumbprint`
  (`command/crypto/jwk/jwk.go:6-94`).
- **`jose`** provides a generic JOSE utility.

These commands are built on `go.step.sm/crypto/jose`, the same library used for
provisioning tokens (see [Provisioning tokens: claims, options, and parsing](../architecture/tokens-and-provisioners.md)).

## kdf: password hashing and verification

The `command/crypto/kdf` group (`hash` and `compare`) uses the `internal/kdf`
package (`command/crypto/kdf/kdf.go:91-95`). Supported algorithms
(`internal/kdf/kdf.go:24-83`, `scrypt.go`, `argon2.go`):

| Algorithm | Parameters | Output |
|---|---|---|
| scrypt | N=32768 (ln=15), r=8, p=1, 32-byte key | PHC string |
| bcrypt | cost 10 | Modular Crypt Format |
| argon2i | m=32768, t=3, p=4 | PHC string |
| argon2id | m=65536, t=1, p=4 | PHC string |

`compare` decodes the PHC string to discover the algorithm and parameters, then
verifies using a constant-time comparison (`internal/kdf/kdf.go:88-130`).
Parsers bound parameter values (e.g. scrypt ln ≤ 20, r ≤ 32, p ≤ 32; argon2
m ≤ 16 GiB, t ≤ 128, p ≤ 32) to avoid excessive memory use
(`internal/kdf/scrypt.go:18-29`, `internal/kdf/argon2.go:15-28`).

The CLI guards the input: passing the secret as a positional argument requires
`--insecure`; otherwise it is prompted or read from STDIN
(`command/crypto/kdf/kdf.go:160-203`).

## Other subcommands

- **`hash`** computes file hashes.
- **`key`** inspects, formats, fingerprints, and derives the public key from a
  private key, and signs/verifies with raw keys.
- **`nacl`** exposes NaCl primitives: `auth`, `box`, `secretbox`, and `sign`.
- **`otp`** generates and verifies TOTP tokens (`generate`, `verify`).
- **`rand`** generates random strings/bytes.
- **`winpe`** inspects Windows Portable Executable (PE) binaries, primarily to
  support attestation of Windows devices.
- **`change-pass`** re-encrypts a private key with a new password, and
  **`create-key-pair`** generates an asymmetric key pair for other crypto
  commands.

KDF behavior is unit-tested in `internal/kdf/kdf_test.go`.
