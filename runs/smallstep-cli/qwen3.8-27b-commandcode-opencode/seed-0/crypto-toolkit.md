---
type: commands
title: "Crypto Toolkit Commands"
description: "The step crypto command family (JWT/JWK/JWS/JWE/JOSE, key, hash, KDF, NaCl, OTP, rand, winpe, change-pass, keypair), KMS-aware key loading via step-kms-plugin in internal/cryptoutil, and the auxiliary step base64 and step fileserver commands."
tags: [crypto, jose, jwt, jwk, kdf, nacl, otp, kms, fileserver, base64]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-2e6c694726c08169fdc82b8d
    resource: repo://command/base64/base64.go
  - id: openwiki-source-b869844a56f117af4344a1a7
    resource: repo://command/crypto/change-pass.go
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-28ba490bc69eee1f1517a107
    resource: repo://command/crypto/jwk/create.go
  - id: openwiki-source-7791e23a8d1c79740aae9b97
    resource: repo://command/crypto/jwt/sign.go
  - id: openwiki-source-94ab4d15cfde41a9ebf6a5b1
    resource: repo://command/crypto/kdf/kdf.go
  - id: openwiki-source-3bdf37a01f825d65dfb7e6b0
    resource: repo://command/crypto/rand/rand.go
  - id: openwiki-source-c5aec1f16c8547bbd1e1036a
    resource: repo://command/crypto/winpe/winpe.go
  - id: openwiki-source-a148da75eb7742358a4e5571
    resource: repo://command/fileserver/fileserver.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-75b7456546c94f96bee19f43
    resource: repo://internal/kdf/argon2.go
  - id: openwiki-source-df2d16b29c2bbf9191277bfd
    resource: repo://utils/read.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

The `step crypto` group is the standalone crypto toolkit: everything here works on local files and STDIN, with no CA connection required. The top level also includes `change-pass` and `keypair`, and two adjacent top-level commands — `step base64` and `step fileserver` — round out the operational toolkit.

## Subcommand map

| Group | Subcommands | Purpose |
|---|---|---|
| `jwt` | `sign`, `verify`, `inspect` | RFC 7519 tokens: sign with flag-driven claims (`--iss/--sub/--aud/--exp/--nbf/--iat/--jti` and header options), verify, pretty-print (`command/crypto/jwt/`). |
| `jwk` | `create`, `keyset`, `public`, `thumbprint` | JWK management: generate keys (`--kty/--crv/--size`, `--alg`, `--use`, `--kid`, `--key-ops`, `--from-pem`), build key sets, extract public parts, compute RFC 7638 thumbprints (`command/crypto/jwk/`). |
| `jws` | `sign`, `verify`, `inspect` | JSON Web Signatures over arbitrary data. |
| `jwe` | `encrypt`, `decrypt` | JSON Web Encryption of data and private-key wrapping. |
| `jose` | `format` | Pretty-print/serialize any JOSE message (`command/crypto/jose/jose.go`). |
| `key` | `format`, `public`, `inspect`, `fingerprint`, `sign`, `verify` | Private/public key operations: PEM↔JWK/DER conversion, extract public key, inspect, fingerprint (`--format` via `flags.ParseFingerprintFormat`, `--certificate` to include SSH cert bytes), sign/verify digests. |
| `hash` | `digest`, `compare` | File/string digests and comparison. |
| `kdf` | `hash`, `compare` | Password hashing with scrypt/bcrypt/argon2 in PHC string format (below). |
| `nacl` | `auth`, `box`, `secretbox`, `sign` | NaCl primitives: authenticated encryption (box), secret-box, MAC, blind signatures; box/secretbox can generate keys. |
| `otp` | `generate`, `verify` | TOTP/HOTP (RFC 4226/6238) via `pquerna/otp`, with optional QR code output (`command/crypto/otp/`). |
| `rand` | (action) | Random strings: formats `ascii`, `alphanumeric`, `alphabet`, `hex`, `dec`, `lower`, `upper`, `emoji`, `raw`; defaults to 32 chars, or 6 dash-separated words from a `--dictionary` file for memorable passwords (`command/crypto/rand/rand.go:20-60`). |
| `winpe` | `extract` | Extract Authenticode certificate tables from Windows PE executables using `debug/pe` + `go.mozilla.org/pkcs7`; errors with `No Certificate Table found` when absent (`command/crypto/winpe/winpe.go:1-45`). |
| `change-pass` | (action) | Re-encrypt a private key: reads the PEM key (optionally decrypting with `--password-file`), re-encrypts with `--new-password-file`; `--no-password` requires `--insecure`; in-place or `--out` (`command/crypto/change-pass.go:94-130`). |
| `keypair` | (action) | Generate a key pair (including `--from-jwk` to re-encode an existing JWK). |

## KMS-aware key loading (internal/cryptoutil)

Commands that accept a `--kms` URI (e.g., `step ca init --kms`, `step crypto` key operations) resolve key material through `internal/cryptoutil`:

- **`IsKMS(rawuri)`** (`cryptoutil.go:28-39`): a value is treated as a KMS URI only if it does *not* exist as a file and `kms.TypeOf` maps it to a non-default KMS type — so a path that happens to match a KMS pattern wins as a file.
- **`CreateSigner` / `PublicKey` / `LoadCertificate` / `LoadJSONWebKey`** (`cryptoutil.go:52-171`): if the name is a file, standard `pemutil`/`jose` loading is used; otherwise a `kmsSigner`/`kmsPublicKey` wrapping the **`step-kms-plugin` executable** is returned.
- **Plugin subprocess protocol** (`cryptoutil.go:229-362`): the plugin is located with `plugin.LookPath("kms")` (the same dispatch as top-level plugins). `newKMSSigner` runs `step-kms-plugin key [--kms <uri>] <key>` and parses the PEM public key from stdout; `Sign` runs `sign --format base64 [--kms <uri>] <key>` writing the digest to the plugin's **stdin** and base64-decoding the stdout signature (RSA gets `--alg SHA256/384/512`, and PSS options add `--pss --salt-length <n>`); `Attest` runs `attest`.
- **`Attestor` interface** (`cryptoutil.go:40-44`): `crypto.Signer` plus `Attest() ([]byte, error)`; `CreateAttestor` is used for TPM/attestation flows (see the certificate issuance page).
- **`IsX509Signer`** (`cryptoutil.go:191-205`): true for ECDSA/RSA/Ed25519 public keys, but for `sshagentkms:` URIs only Ed25519 (ssh-agent keys) may sign X.509 certificates.

This is how the README's statement that "step-kms-plugin is integrated directly into step" works: no Go KMS client is embedded — the plugin binary is the KMS boundary, and it must be on `$PATH` or in `$(step path --base)/plugins`.

## KDFs (internal/kdf + command/crypto/kdf)

- `step crypto kdf hash` derives a key from input (STDIN by default; a positional input requires `--insecure` because it can leak into logs/shell history) and prints a **PHC string** with algorithm, salt, and parameters (`command/crypto/kdf/kdf.go:100-140`).
- Algorithms: `scrypt` (fixed N=32768, r=8, p=1), `bcrypt` (fixed work factor 10), `argon2i`/`argon2id` with bounded parameters — max memory 16 GiB, max parallelism 32, max iterations 128 (`internal/kdf/argon2.go:7-22`).
- PHC string parsing is in `internal/kdf/phc.go` (bcrypt special-cased), and `step crypto kdf compare` verifies a password against a stored hash using constant-time comparison (`crypto/subtle`).

## Auxiliary commands

- **`step base64`** (`command/base64/base64.go`): RFC 4648 encoding/decoding from an argument or STDIN, with `-d/--decode`, `-r/--raw` (no padding), `-u/--url` (URL-safe).
- **`step fileserver <dir>`** (`command/fileserver/fileserver.go:95-185`): serves a directory over HTTP (TLS when `--cert`/`--key` are given) on `--address`, with optional mTLS via `--roots` (enforces `RequireAndVerifyClientCert`, TLS >= 1.2), `--pidfile` (written 0644, removed on exit), a 15s `ReadHeaderTimeout`, and a `tlsRenewer` that reloads cert/key/roots on **SIGHUP** and shuts down gracefully (5s timeout) on SIGINT/SIGTERM (`command/fileserver/fileserver.go:188-273`). This is the server behind `step ca acme --webroot`-style challenge serving and manual certificate distribution.

## Conventions

- Input files may be `-` for STDIN in most commands (de facto CLI convention implemented in `utils/read.go`).
- Written keys use 0600 permissions via `pemutil.ToFile`; JSON output is available on `inspect` commands for piping into `step certificate inspect --format json` and similar.
- Password entry goes through `ui.PromptPassword` (wired globally in `internal/cmd/root.go`), so `--password-file` variants exist for automation.
