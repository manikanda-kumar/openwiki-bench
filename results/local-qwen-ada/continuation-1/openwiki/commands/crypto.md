---
type: "Reference"
title: "Crypto Primitives Command Group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
sources:
  - id: openwiki-source-b869844a56f117af4344a1a7
    resource: repo://command/crypto/change-pass.go
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-5464c4759e501e702f648ef7
    resource: repo://command/crypto/hash/hash.go
  - id: openwiki-source-de56a7f013c914abea1b5a39
    resource: repo://command/crypto/jose/jose.go
  - id: openwiki-source-a749871528c2fe530a3365e4
    resource: repo://command/crypto/jwe/decrypt.go
  - id: openwiki-source-fd0c8b2a63abedd315212868
    resource: repo://command/crypto/jwe/encrypt.go
  - id: openwiki-source-3ff18e43c134f8b68db97e9e
    resource: repo://command/crypto/jwe/jwe.go
  - id: openwiki-source-28ba490bc69eee1f1517a107
    resource: repo://command/crypto/jwk/create.go
  - id: openwiki-source-fad3c125efd2d257e435d317
    resource: repo://command/crypto/jwk/jwk.go
  - id: openwiki-source-d8803d9fc4f45ad041dfe4d7
    resource: repo://command/crypto/jwk/keyset.go
  - id: openwiki-source-8fa0bacd6b9b18e0aa36d749
    resource: repo://command/crypto/jwk/public.go
  - id: openwiki-source-2c9e75be2fec3489aa0d4771
    resource: repo://command/crypto/jwk/thumbprint.go
  - id: openwiki-source-da97655f93f184f1df633723
    resource: repo://command/crypto/jws/inspect.go
  - id: openwiki-source-dc8182e26ff530a41971d72d
    resource: repo://command/crypto/jws/jws.go
  - id: openwiki-source-260611d5483b584457cd33e6
    resource: repo://command/crypto/jws/sign.go
  - id: openwiki-source-c9717a200bb0b9d137fe725c
    resource: repo://command/crypto/jws/verify.go
  - id: openwiki-source-a50b0e7b4d6f4710aca3eade
    resource: repo://command/crypto/jwt/inspect.go
  - id: openwiki-source-3366fea11fc7ad406ab418a9
    resource: repo://command/crypto/jwt/jwt.go
  - id: openwiki-source-7791e23a8d1c79740aae9b97
    resource: repo://command/crypto/jwt/sign.go
  - id: openwiki-source-5bb28d96c1ab610dcac1ed24
    resource: repo://command/crypto/jwt/verify.go
  - id: openwiki-source-94ab4d15cfde41a9ebf6a5b1
    resource: repo://command/crypto/kdf/kdf.go
  - id: openwiki-source-beda00d0d9e488a0ce8041d5
    resource: repo://command/crypto/key/fingerprint.go
  - id: openwiki-source-29eacbc7b048544b6a96fb65
    resource: repo://command/crypto/key/format.go
  - id: openwiki-source-9db58eb1c6254b94bdead9b9
    resource: repo://command/crypto/key/key.go
  - id: openwiki-source-446cd55c39005a84c534e59f
    resource: repo://command/crypto/key/sign.go
  - id: openwiki-source-22a550315cbdbe5b5ae47327
    resource: repo://command/crypto/key/verify.go
  - id: openwiki-source-cbdbf656575c3c23d8f33ae7
    resource: repo://command/crypto/keypair.go
  - id: openwiki-source-8d273008d6963aaf2e8448ae
    resource: repo://command/crypto/nacl/nacl.go
  - id: openwiki-source-e25f8110899c96c8cbd7cdbc
    resource: repo://command/crypto/otp/generate.go
  - id: openwiki-source-afbfd40e83f88bda82951c69
    resource: repo://command/crypto/otp/otp.go
  - id: openwiki-source-3bdf37a01f825d65dfb7e6b0
    resource: repo://command/crypto/rand/rand.go
  - id: openwiki-source-c5aec1f16c8547bbd1e1036a
    resource: repo://command/crypto/winpe/winpe.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-75b7456546c94f96bee19f43
    resource: repo://internal/kdf/argon2.go
  - id: openwiki-source-43f82bca17775bc861344237
    resource: repo://internal/kdf/kdf.go
  - id: openwiki-source-e88354b0c3fe800a081c381a
    resource: repo://internal/kdf/scrypt.go
  - id: openwiki-source-4658661d824001e81c8b5758
    resource: repo://pkg/bcrypt_pbkdf/bcrypt_pbkdf.go
generated: { by: "opencode", at: "2026-09-14T13:44:47.469Z" }
---

# Crypto Primitives Command Group

The `step crypto` group ("useful cryptographic plumbing", `command/crypto/crypto.go:25`) bundles standalone cryptographic operations that work without a CA: key generation (PEM and JWK), JWT/JWS/JWE sign-verify-inspect, JOSE serialization, hashing, password KDFs, NaCl primitives, one-time passwords, random strings, key reformatting/fingerprinting, and Windows PE certificate extraction. The group is registered in `init()` via `command.Register` (`crypto.go:22-23`, `crypto.go:178`).

The group exposes 14 subcommands (`crypto.go:160-175`): `change-pass`, `keypair`, `jwk`, `jwt`, `jwe`, `jws`, `jose`, `hash`, `kdf`, `key`, `nacl`, `otp`, `rand`, and `winpe`.

## Safety model

The group help states that safe defaults are selected wherever possible and that insecure or subtle options are gated behind `--insecure` and `--subtle` flags, with the rationale documented in the **SECURITY CONSIDERATIONS** section of each subcommand's help (`crypto.go:26-37`). Documented minimums: 256 bits for symmetric keys, NIST-recommended 2048 bits for RSA (`crypto.go:51-61`); P-256 is the default EC curve and non-safe curves are deliberately not gated, while Ed25519 is the only curve listed as safe (`crypto.go:105-130`). All public key algorithms in the group are documented as not quantum-safe (`crypto.go:132-139`).

## `step crypto change-pass`

`changePassCommand` (`change-pass.go:22`) re-encrypts an encrypted private key stored as PEM or JWK. The action detects the format by the `-----BEGIN ` prefix (`change-pass.go:118`): PEM keys are parsed with `pemutil.Parse` and re-serialized with `pemutil.Serialize` at mode `0o644` (`change-pass.go:119-142`); JWK keys are read with `jose.ReadKey` and re-encrypted with `jose.Encrypt`, written at mode `0o600` (`change-pass.go:143-178`). Flags: `--password-file`, `--new-password-file`, `--out` (defaults to overwriting the input file), `--force`, `--insecure`, and `--no-password` (which requires `--insecure`) (`change-pass.go:70-86`, `change-pass.go:103-105`).

## `step crypto keypair`

`createKeyPairCommand` (`keypair.go:18`) generates a raw PEM public/private keypair for `<pub_file> <priv_file>`. Flags: `--kty` (default `EC`, `flags/flags.go:24-29`), `--size`, `--curve`, `--from-jwk` (build the PEM from an existing JWK file, incompatible with `--kty`/`--curve`/`--size`), `--password-file`, `--no-password` (requires `--insecure`), `--insecure`, `--force` (`keypair.go:80-93`, `keypair.go:108-137`). New keys are generated with `keyutil.GenerateKeyPair` after `utils.GetKeyDetailsFromCLI`; under `--insecure` the keyutil library is put in insecure mode so RSA keys shorter than 2048 bits are allowed (`keypair.go:151-168`). Private keys are written encrypted with a prompted password unless `--no-password`, always at mode `0600` (`keypair.go:171-199`).

## `step crypto jwk`

The `jwk` group (`command/crypto/jwk/jwk.go:6`) "creates JWKs (JSON Web Keys) and manages JWK Key Sets" per RFC7517/RFC7518/RFC8037, and exposes `create`, `keyset`, `public`, and `thumbprint` (`jwk.go:88-93`).

### `step crypto jwk create`

`createCommand` (`create.go:37`) writes a public and a (JWE-encrypted) private JWK to `<public-jwk-file> <private-jwk-file>`.

- **Key types.** `--kty` accepts `EC` (default), `oct`, `OKP`, `RSA` (`create.go:168-188`). `--kty EC`/`OKP` reject `--size`; `--kty RSA`/`oct` reject `--curve`. RSA sizes below `keyutil.MinRSAKeyBytes*8` and oct sizes below 16 bytes require `--insecure` (`create.go:433-471`).
- **Algorithms and use.** `--alg` defaults are chosen from key type/use/curve (e.g. EC P-256 sig → ES256, oct sig → HS256, RSA sig → RS256, OKP Ed25519 → EdDSA; EC enc → ECDH-ES, oct enc → A256GCMKW, RSA enc → RSA-OAP-256) (`create.go:191-210`). `--use` defaults to `sig` and accepts `enc` (`create.go:305-322`). The hidden `--key-ops` flag is defined but marked "Not currently implemented" (`create.go:331-333`).
- **kid.** Without `--kid`, asymmetric keys get a base64url RFC7638 thumbprint as key ID; symmetric (oct) keys are intentionally not thumbprinted because "a hash of a symmetric key can leak information" (`create.go:486-496`).
- **Private JWK encryption.** Private JWKs are JWE-encrypted by default with `PBES2-HS256+A128KW`, a 16-byte salt, and 600,000 PBKDF2 iterations (the OWASP Dec 2022 recommendation; the fallback path uses a printed random 32-character key with `A128KW`) (`create.go:26-35`, `create.go:531-561`). The payload is encrypted with `jose.DefaultEncAlgorithm` and content type `jwk+json`, and both files are written at mode `0600` (`create.go:563-595`). `--no-password` (with `--insecure`) writes the private JWK in cleartext (`create.go:396-408`, `create.go:587-592`).
- **PEM import.** `--from-pem` builds the JWK from an existing PEM via `jose.GenerateJWKFromPEM` instead of generating a new key (`create.go:473-480`).

### `step crypto jwk keyset`

The `keyset` group manages JWK Sets and exposes `add`, `remove`, `list`, and `find` (`keyset.go:20-41`). `add` reads a JWK from STDIN, transparently decrypts JWE-encrypted input with a password prompt, appends it to the set, and writes it back under the file lock from `rwLockKeySet`; duplicate `kid`s are allowed per RFC7517 (`keyset.go:124-158`). `remove` and `find` select keys by `--kid` (`keyset.go:60-122`).

### `step crypto jwk public` / `thumbprint`

`public` reads a (possibly JWE-encrypted) private JWK from STDIN and prints the derived public JWK; oct keys are printed as-is because `JSONWebKey.Public()` returns an empty key for them (`public.go:31-63`). `thumbprint` prints the base64url RFC7638 SHA-256 thumbprint of a JWK from STDIN (`thumbprint.go:31-56`).

## `step crypto jwt`

The `jwt` group exposes `sign`, `verify`, and `inspect` (`command/crypto/jwt/jwt.go:12-16`).

- **`jwt sign`** reads a payload from a file or STDIN and sets registered claims via `--iss`, `--aud`, `--sub`, `--exp`, `--nbf`, `--iat`, `--jti` (`sign.go:118-173`); the signing key comes from `--key` (PEM or JWK), `--jwks` (key selected by `--kid`), or `--x5c-key`/`--x5t-key` with certificate files for x5c/x5t headers (`sign.go:175-205`, `sign.go:311-320`).
- **`jwt verify`** reads the JWT from STDIN and verifies the signature and standard claims; the key again comes from `--key`/`--jwks`/`--kid`, and `--no-exp-check` skips expiration validation (`verify.go:49-96`, `verify.go:119`, `verify.go:187-190`).
- **`jwt inspect`** decodes and prints the JWT without verifying it (`inspect.go:23`).

## `step crypto jwe`

The `jwe` group exposes `encrypt` and `decrypt` (`command/crypto/jwe/jwe.go:10-13`).

- **`jwe encrypt`** reads the payload from STDIN. The key management `--alg` is taken from the flag, else the JWK `alg` member, else a default per key type; a mismatch between flag and JWK requires `--subtle` (`encrypt.go:33-45`). The content encryption `--enc` defaults to `A256GCM` (`encrypt.go:96-99`). Recipient keys come from `--key`, `--jwks`+`--kid`, and headers can be set with `--typ` and `--cty` (`encrypt.go:123-147`).
- **`jwe decrypt`** reads the JWE from STDIN and decrypts it with a key from `--key` or `--jwks`+`--kid`, with `--password-file` supporting encrypted key files (`decrypt.go:31-52`, `decrypt.go:64`, `decrypt.go:112-118`).

## `step crypto jws`

The `jws` group exposes `sign`, `inspect`, and `verify` (`command/crypto/jws/jws.go:10-14`). `sign` reads a payload from a file or STDIN and supports JOSE headers `--jku`, `--jwk`, `--typ`, `--cty` plus the same `--key`/`--jwks`/`--kid`/`--x5c-key`/`--x5t-key` key sources as JWT (`sign.go:37-154`, `sign.go:258-264`). `verify` checks a JWS from STDIN against `--key` or `--jwks` and can print the JSON structure with `--json` (`verify.go:41-72`, `verify.go:91`). `inspect` decodes a JWS without verification (`inspect.go:24`).

## `step crypto jose format`

The `jose` group's only subcommand, `format`, reads a JWT/JWS/JWE from STDIN and swaps serialization between compact and JSON (`command/crypto/jose/jose.go:34-40`).

## `step crypto hash`

The `hash` group exposes `digest` and `compare` (`command/crypto/hash/hash.go:31-33`). Both take a file or directory and `--alg` (default `sha256`; also sha1, sha224, sha384, sha512, sha512-224, sha512-256, and `md5` which requires `--insecure`) (`hash.go:100-137`). Directories are hashed by hashing each file, with symlinks handled separately (`hash.go:319`, `hash.go:364`).

## `step crypto kdf`

The `kdf` group "creates and verifies passwords using key derivation functions" and exposes `hash` and `compare` (`command/crypto/kdf/kdf.go:17-21`, `kdf.go:91-94`).

- **`kdf hash`** derives a password hash with `--alg` one of `scrypt` (default), `bcrypt`, `argon2i`, `argon2id` (`kdf.go:134-156`). Input comes from a prompt or non-TTY STDIN; a positional input requires `--insecure` because the secret would appear in process listings (`kdf.go:179-193`). Output is a PHC string.
- **`kdf compare`** takes a PHC hash plus a plaintext (prompted or, with `--insecure`, positional), prints `ok` on success, and exits non-zero on mismatch (`kdf.go:205-244`, `kdf.go:247-279`).
- **Defaults.** The implementations live in `internal/kdf`: scrypt at N=32768, r=8, p=1 (the `scrypt-32768` preset, `internal/kdf/kdf.go:24-38`, `internal/kdf/scrypt.go:31-35`), bcrypt at `bcrypt.DefaultCost` (`internal/kdf/kdf.go:42-48`), argon2i at m=32768, t=3, p=4 and argon2id at m=65536, t=1, p=4 with 16-byte salts (`internal/kdf/kdf.go:54-83`, `internal/kdf/argon2.go:36-39`). A code comment notes the current methods use safe defaults and that future parameterization would use functional options (`internal/kdf/kdf.go:17-19`).
- **Parameter limits and comparison.** Decoding PHC strings enforces `ScryptMaxCost` ln=20, `ScryptMaxBlockSize`/`ScryptMaxParallelism` r, p ≤ 32 (`internal/kdf/scrypt.go:18-29`, `internal/kdf/scrypt.go:42-62`) and `Argon2MaxMemory` 16 GiB, ≤128 iterations, ≤32 threads (`internal/kdf/argon2.go:12-25`, `internal/kdf/argon2.go:38-55`). `kdf.Compare` dispatches on the PHC id (bcrypt, scrypt, argon2i, argon2id), rejects unknown ids and unsupported argon2 versions, and compares with `subtle.ConstantTimeCompare` (`internal/kdf/kdf.go:88-130`). PHC string parsing/encoding is in `internal/kdf/phc.go` with a bcrypt special case (`phc.go:41-108`).

## `step crypto key`

The `key` group "manages keys" and exposes `format`, `public`, `inspect`, `fingerprint`, `sign`, and `verify` (`command/crypto/key/key.go:8-31`).

- **`key format`** converts between PEM and DER with documented per-algorithm encodings (PKIX public keys, SEC1 EC private, PKCS#1 RSA private, PKCS#8 Ed25519 private), and can target `--pkcs8`, `--pem`, `--der`, `--ssh`, or `--jwk` output with `--out` (`format.go:30-52`, `format.go:114-144`).
- **`key fingerprint`** computes a key fingerprint; the default is SHA-256 printed base64 with a `SHA256:` prefix, `--sha1` restores the legacy SHA-1/hex output, `--pkix` and `--ssh` are mutually exclusive encodings, and `--raw` prints raw bytes (`fingerprint.go:143-170`, flags at `fingerprint.go:100-116`).
- **`key sign` / `key verify`** sign or verify a digest/message with a PEM or JWK key; `--alg` (default `sha256`) selects the hash for RSA PKCS#1 v1.5 and RSA-PSS, `--pss` switches to PSS, and `--raw` treats input as a raw digest (`sign.go:24-50`, `sign.go:105-118`, `verify.go:60-69`).

## `step crypto nacl`

The `nacl` group exposes NaCl-based subcommands `auth` (digest/verify), `box` (keypair/seal/open), `secretbox` (seal/open), and `sign` (keypair/open/sign) (`command/crypto/nacl/nacl.go:12-44`). Message inputs/outputs are base64url by default with `--no-base64`-style flags to disable encoding, and nonces may carry a `base64:` prefix (`nacl.go:46-56`, `box.go:164`, `sign.go:119`).

## `step crypto otp`

The `otp` group exposes `generate` and `verify` for TOTP/HOTP one-time passwords (`command/crypto/otp/otp.go:10-13`). `generate` defaults: `--period` 30 seconds, `--length`/digits 6, `--secret-size` 20, `--alg` SHA1; `--url` prints the TOTP key URI and `--qr` writes a QR code (`generate.go:31-67`). `verify` checks a code with matching `--period`, window, digits, and algorithm options (`verify.go:26-61`).

## `step crypto rand`

`rand` generates random strings; the default format is `ascii` (94 printable ASCII characters) and the default length is 32, or 6 dash-separated words when `--dictionary` is given. Supported formats: `ascii`, `alphanumeric`, `alphabet`, `hex`, `dec`, `lower`, `upper`, `emoji`, and `raw` (`command/crypto/rand/rand.go:21-64`).

## `step crypto winpe`

The `winpe` group extracts code-signing certificates from Windows Portable Executable files; its only subcommand is `extract`, and extraction fails with `ErrCodeSignCertsNoCertificateTableFound` when the PE has no certificate table (`command/crypto/winpe/winpe.go:20-44`).

## KMS-aware key helpers (`internal/cryptoutil`)

Although `step crypto` subcommands read keys directly from files (e.g. JOSE commands use `jose.ReadKey`/`jose.ReadKeySet`, `command/crypto/jws/sign.go:258-264`), the repository provides KMS URI support through `internal/cryptoutil`, which is used by the `step certificate` and `step ca` commands (see [Certificate Command Group](/openwiki/commands/certificate.md)).

- `IsKMS` returns true only when the URI resolves to a KMS type via `kms.TypeOf` and no file exists at that path (`cryptoutil.go:26-38`).
- `PublicKey`, `CreateSigner`, `LoadCertificate`, and `LoadJSONWebKey` each accept a file name or a KMS key name; KMS paths shell out to `step-kms-plugin` discovered via `plugin.LookPath("kms")` (`cryptoutil.go:52-123`).
- `LoadJSONWebKey` wraps a KMS signer as an opaque JWK signer and assigns the default signing algorithm per key type (ES256/ES384/ES512, RS256, EdDSA) plus an RFC7638 thumbprint key ID (`cryptoutil.go:126-169`).
- The `Attestor` interface (`crypto.Signer` + `Attest()`) is implemented by the `kmsSigner` used with `step-kms-plugin`; `Sign` invokes `step-kms-plugin sign --format base64`, adding `--pss --salt-length` for RSA PSS and `--alg SHA256|SHA384|SHA512` for RSA, and `Attest` invokes `step-kms-plugin attest` (`cryptoutil.go:45-50`, `cryptoutil.go:229-260`, `cryptoutil.go:305-344`, `cryptoutil.go:346-362`).
- `IsX509Signer` reports X.509-signing capability, restricting `sshagentkms:` signers to Ed25519 (`cryptoutil.go:183-205`).

## `pkg/bcrypt_pbkdf`

`pkg/bcrypt_pbkdf` is an OpenBSD `bcrypt_pbkdf(3)`-compatible password-based KDF exposing `Key(password, salt, rounds, keyLen)` (up to 1024 output bytes) for consumers needing bcrypt-style derivation outside the PHC-based `internal/kdf` (`pkg/bcrypt_pbkdf/bcrypt_pbkdf.go:6-40`).

## Change guides

### Add a new `step crypto` subcommand

1. Create a package under `command/crypto/<name>/` (follow `command/crypto/hash` or `command/crypto/kdf` for a group with subcommands, or add a file to the `crypto` package for a single command like `change-pass.go`/`keypair.go`).
2. Export a `Command() cli.Command` (or a `xxxCommand() cli.Command` constructor) with `Name`, `Usage`, `UsageText`, `Description`, flags, and `Action`.
3. Register it in the group's `Subcommands` list in `command/crypto/crypto.go` (`crypto.go:160-175`), adding the package import alongside the other `command/crypto/...` imports (`crypto.go:3-20`). If the subcommand offers risky options, gate them with `--insecure`/`--subtle` (`flags.Insecure`, `flags.Subtle`) and document the rationale in a **SECURITY CONSIDERATIONS** section, matching the group's conventions (`crypto.go:26-37`).

### Add a new KDF to `step crypto kdf`

Add the identifier constant and default parameter preset in `internal/kdf` (e.g. the `scryptParams`/`argon2Params` maps in `internal/kdf/scrypt.go:31-35` and `internal/kdf/argon2.go:36-39`), implement a `KDF`-typed constructor plus a case in `kdf.Compare` (`internal/kdf/kdf.go:20`, `internal/kdf/kdf.go:88-130`), and wire the new `--alg` value into `hashAction`'s switch in `command/crypto/kdf/kdf.go:166-177`.
