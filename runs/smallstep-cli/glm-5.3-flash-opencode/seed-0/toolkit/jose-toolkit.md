---
type: toolkit-page
title: JOSE Crypto Toolkit
description: The standalone crypto commands - jwt/jws/jwe/jwk, keyset management with file locking, kdf, nacl, otp, and the misuse gates.
tags: [jose, jwt, jwe, jws, jwk, keyset, kdf, subtle, insecure]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-b869844a56f117af4344a1a7
    resource: repo://command/crypto/change-pass.go
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-de56a7f013c914abea1b5a39
    resource: repo://command/crypto/jose/jose.go
  - id: openwiki-source-a749871528c2fe530a3365e4
    resource: repo://command/crypto/jwe/decrypt.go
  - id: openwiki-source-fd0c8b2a63abedd315212868
    resource: repo://command/crypto/jwe/encrypt.go
  - id: openwiki-source-28ba490bc69eee1f1517a107
    resource: repo://command/crypto/jwk/create.go
  - id: openwiki-source-d8803d9fc4f45ad041dfe4d7
    resource: repo://command/crypto/jwk/keyset.go
  - id: openwiki-source-8fa0bacd6b9b18e0aa36d749
    resource: repo://command/crypto/jwk/public.go
  - id: openwiki-source-2c9e75be2fec3489aa0d4771
    resource: repo://command/crypto/jwk/thumbprint.go
  - id: openwiki-source-7791e23a8d1c79740aae9b97
    resource: repo://command/crypto/jwt/sign.go
  - id: openwiki-source-5bb28d96c1ab610dcac1ed24
    resource: repo://command/crypto/jwt/verify.go
  - id: openwiki-source-a3cf1d1249d15e362b08c110
    resource: repo://integration/crypto_test.go
  - id: openwiki-source-fa952c8392758efd9a296cbb
    resource: repo://integration/testdata/crypto/jwt-sign.txtar
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-43f82bca17775bc861344237
    resource: repo://internal/kdf/kdf.go
  - id: openwiki-source-4658661d824001e81c8b5758
    resource: repo://pkg/bcrypt_pbkdf/bcrypt_pbkdf.go
  - id: openwiki-source-df2d16b29c2bbf9191277bfd
    resource: repo://utils/read.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

`step crypto` is a general-purpose cryptographic toolkit built on the JOSE
standards. It shares the same command framework as everything else, but adds a
philosophy layer: safe defaults plus explicit gates against misuse. This page
describes the toolkit's structure and the invariants its commands enforce.

## Group structure and safety philosophy

`step crypto` registers change-pass, create-key-pair, jwk, jwt, jwe, jws, jose,
hash, kdf, key, nacl, otp, rand, and winpe (command/crypto/crypto.go:160-175).
Its help text documents the design stance (crypto.go:26-158):

- Insecure primitives require `--insecure`; delicate-but-legitimate options
  require `--subtle` (crypto.go:32-37).
- Minimum key sizes are policy: 256-bit symmetric keys and 2048-bit RSA
  (crypto.go:51-61), with RSA minimums enforced in code (e.g. JWK oct/RSA checks
  at command/crypto/jwk/create.go:445, 462).
- **P-256 is the default EC curve** despite not being a "safe curve" — the
  rationale (implementation-maturity tradeoffs) is documented at
  crypto.go:105-119.
- Key-use separation is enforced when a key has an envelope: signing keys cannot
  encrypt and vice versa (see below).

The JOSE implementation is never imported from go-jose directly; everything goes
through `go.step.sm/crypto/jose`, which layers option builders (`WithUse`,
`WithAlg`, `WithKid`, `WithSubtle`, `WithNoDefaults`, `WithPasswordFile`,
`WithPasswordPrompter`), `ReadKey`/`ReadKeySet`, `Decrypt`, and `ValidateJWK` on
top.

## step crypto jwt sign

`signAction` (command/crypto/jwt/sign.go:216-501) reads the payload from an
argument, a file, or stdin (`readPayload` tolerates empty stdin, producing an
empty JSON object — sign.go:466-501). Key selection is exactly one of `--key`
(JWK or PEM, possibly encrypted), `--jwks` **requiring** `--kid`
(sign.go:277-287), or `--x5c-cert`+`--x5c-key` / `--x5t-cert`+`--x5t-key` chains
(sign.go:237-275). Keys are read with `jose.WithUse("sig")` plus optional
algorithm/kid/subtle/password options (sign.go:289-305), then validated:

- public keys cannot sign (sign.go:326-328),
- the JWK `use` must be `sig` or empty (sign.go:331-333),
- an algorithm must be resolvable from `--alg`, the JWK, or guessing — otherwise
  "--alg is required with the given key" (sign.go:339-341),
- `jose.ValidateJWK` runs (sign.go:342-344),
- `--exp` must be in the future unless `--subtle` (sign.go:347-349).

Unless `--subtle`, iss/aud/sub/exp claims are required, and a random 256-bit
`jti` is auto-generated (sign.go:351-356 and the claim checks that follow).
Signing produces compact serialization with `typ=JWT` and a `kid` header unless
the hidden `--no-kid`; extra `--header k=v` pairs and the x5c/x5t header
embeddings mirror the token machinery (sign.go:399-462).

## step crypto jwt verify

`verifyAction` (command/crypto/jwt/verify.go:118-250) parses the compact token
from stdin. With `--jwks`, the kid comes from `--kid` or the token's own header
(verify.go:139-144) and `jose.ReadKeySet(..., WithKid(kid))` selects the matching
member. Anti-downgrade hardening: without `--insecure`, `jose.WithNoDefaults(true)`
prevents algorithm guessing (verify.go:176-178); iss and aud are required unless
`--subtle` (verify.go:150-157); `--no-exp-check` requires `--insecure`
(verify.go:160-162). Structural rejections: multiple signatures and `crit`
headers fail outright, and `--alg` must match the header
(verify.go:208-217). Signature failures produce the stable message "validation
failed: invalid signature" (verify.go:220-225).

Claim validation goes through a local `validateClaimsWithLeeway`
(verify.go:254-297) that re-implements go-jose's validation but aggregates all
failures into one message, with the exp check skippable via the insecure-gated
flag.

## JWE encrypt/decrypt

`jwe encrypt` (command/crypto/jwe/encrypt.go) defaults the content encoding to
`A256GCM` (encrypt.go:97, 298) and maps key algorithms in `getRecipientAlg`
(RSA-OAEP variants, AES-KW, dir, ECDH-ES, GCMKW, PBES2). Two distinct modes:
with a key file, the JWK's public half encrypts (`jwk.Public()`, and a `use=sig`
key is rejected — encrypt.go:244-249); in **PBES2 mode** (password-based), no key
file is allowed and the prompted password *is* the recipient key
(encrypt.go:192-241). `jwe decrypt` (decrypt.go) detects PBES2 from the JWE
header and prompts for the password (optionally prefilled from
`--password-file`), otherwise requires a private key — public keys and `use=sig`
keys are rejected (decrypt.go:139-145).

## JWK create and the keyset store

`step crypto jwk create` (command/crypto/jwk/create.go) generates a JWK pair with
opinionated defaults: private JWKs are **encrypted by default** — `--no-password`
requires `--insecure` (create.go:399-408); per-type constraints (EC forbids
`--size`, RSA forbids `--crv` and enforces the 2048-bit minimum, oct keys need ≥16
bytes) (create.go:434-468). The default `kid` is the SHA-256 thumbprint except for
oct keys, because "a hash of a symmetric key can leak information"
(create.go:486-496). Private JWKs are serialized as a **JWE** with
`PBES2_HS256_A128KW`, 600,000 PBKDF2 iterations (16-byte salt), and content type
`jwk+json` (constants at create.go:26-35; encryption at create.go:531-586); if
PBKDF2 is unsupported in the build, it falls back to a random 32-character
`A128KW` key that is printed once (create.go:553-561). Both files are written
0600 (create.go:519, 593).

`step crypto jwk keyset` (add/remove/list/find) manages JWK Set files through
`rwLockKeySet` (command/crypto/jwk/keyset.go:228-309): the file is opened
0600/O_RDWR|O_CREATE, exclusively **flocked** (non-blocking — a concurrent writer
fails with "file is locked"), read, mutated, and rewritten by truncate +
`WriteAt` before unlock. Duplicate kids are permitted per RFC 7517
(keyset.go:153-156). This locking is why concurrent `step ca`-style automation
can share a keyset file safely. `jwk public` decrypts and strips the private
material (copying oct keys as-is since go-jose cannot derive a public symmetric
key), and `jwk thumbprint` prints the SHA-256 thumbprint.

## Password handling across the toolkit

Three interchangeable sources feed key encryption passwords: interactive
prompts (`ui.PromptPassword`), `--password-file` (`jose.WithPasswordFile` at
jwt sign.go:303-305, jws, provisioner keys), and the shared password prompter
installed at startup (`jose.PromptPassword`, internal/cmd/root.go:101-103).
`utils.ReadPasswordFromFile` right-trims file contents (utils/read.go:53-62).

## change-pass, kdf, and the rest

- `crypto change-pass` re-encrypts an existing PEM key (via pemutil) or JWK (via
  `jose.Encrypt`) with a new password (command/crypto/change-pass.go:113-178).
- `crypto kdf` hashes/compares passwords using the internal `kdf` package:
  Scrypt (scrypt-32768 parameters), Bcrypt, Argon2i, and Argon2id, all emitting
  PHC-format strings with random salts; comparison re-derives and compares in
  constant time (internal/kdf/kdf.go:22-83, 85-137).
- `crypto jose format` converts between compact and JSON serializations by
  trying `ParseEncrypted` then `ParseJWS` (command/crypto/jose/jose.go).
- `crypto nacl`, `crypto otp`, `crypto hash`, `crypto rand`, `crypto key`, and
  `crypto winpe` round out the toolkit; `crypto jws` shares the JWT skeleton and
  adds `--typ/--cty/--jku/--jwk` headers (command/crypto/jws/sign.go:294-319).
- `pkg/bcrypt_pbkdf` ships the OpenBSD `bcrypt_pbkdf` implementation with no
  internal importers — kept for external consumers (pkg/bcrypt_pbkdf/bcrypt_pbkdf.go:5-7).

## Representative tests

The integration suite covers this toolkit most heavily of all command families:
JWK create per key type, JWT sign/verify/inspect (including the OpenSSL
interoperability oracle), keypair, OTP, and help snapshots
(integration/crypto_test.go:30-312, testdata/crypto/*.txtar). Error-message
stability ("cannot use a public key for signing") is asserted by those scripts,
making it part of the contract.
