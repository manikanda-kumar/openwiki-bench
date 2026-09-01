---
type: flow
title: "X.509 and Crypto Toolkit"
description: "step's offline crypto surface: step certificate create/inspect/verify/sign/lint/install with profiles and JSON templates, and the step crypto JOSE (JWT/JWS/JWE/JWK), KDF, hash, NaCl, and OTP commands and their key-generation defaults."
tags: [x509, certificates, jose, jwt, kdf, crypto]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-455e13fae8bb72a40c8b6ba6
    resource: repo://command/certificate/install.go
  - id: openwiki-source-2f8947cb371741300d028072
    resource: repo://command/certificate/lint.go
  - id: openwiki-source-82fd4fa4e59959a7d48ef2b1
    resource: repo://command/certificate/p12.go
  - id: openwiki-source-e91e5966889eb4feb80e760a
    resource: repo://command/certificate/remote.go
  - id: openwiki-source-d369a2fc6aab1546fc84613b
    resource: repo://command/certificate/verify.go
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-94ab4d15cfde41a9ebf6a5b1
    resource: repo://command/crypto/kdf/kdf.go
  - id: openwiki-source-e25f8110899c96c8cbd7cdbc
    resource: repo://command/crypto/otp/generate.go
  - id: openwiki-source-3bdf37a01f825d65dfb7e6b0
    resource: repo://command/crypto/rand/rand.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-d9d38bfde91a5cafc769a652
    resource: repo://internal/kdf/phc.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# X.509 and Crypto Toolkit

The `step certificate` and `step crypto` groups operate without any CA contact: they create and consume X.509 material and JOSE objects directly. All of it runs on top of `go.step.sm/crypto` (x509util, keyutil, jose, pemutil) whose file-writing and password-prompting behavior step overrides globally in `newApp` (`internal/cmd/root.go:97-103`) — the reason `--password-file`, `--force` and terminal prompts work uniformly across these commands.

## `step certificate create`: profiles become templates

`create` takes `<subject> <crt-file> [<key-file>]` (key file optional with `--key`), and is template-driven (`command/certificate/create.go:495-545`). The `--profile` flag selects one of four built-in profiles, each mapping to a `x509util` default template and a default validity when `--not-before/--not-after` are unset: `leaf` (default, 24h), `self-signed` (24h, and additionally requires `--subtle`), `intermediate-ca` (10 years), `root-ca` (10 years); a custom `--template <file>` replaces the profile template and implies 24h validity — and `--profile` with an explicit `--template` is rejected as incompatible (`command/certificate/create.go:543-690`, `command/certificate/create.go:33-39`).

Mechanics:

- Template data is assembled with `x509util.CreateTemplateData(subject, sans)` plus user data from `--set key=value`/`--set-file` (`flags.GetTemplateData`), so templates can reference `.User.*` (`command/certificate/create.go:556-560`, `command/certificate/create.go:672-687`, `flags/flags.go:613-642`).
- The subject is the default single SAN for leaf/self-signed/template paths; `--bundle` (only valid with the leaf profile) appends the parent certificate PEM after the leaf (`command/certificate/create.go:642-661`, `command/certificate/create.go:754-760`).
- Without `--ca/--ca-key` the certificate is self-issued (parent = template itself); `parseSigner` resolves the CA key, also accepting `--ca-kms` URIs (`command/certificate/create.go:658-664`, `command/certificate/create.go:771`).
- `--csr` produces a certificate *request* instead, always via a template (default `x509util.DefaultCertificateRequestTemplate`), and profile values other than leaf are rejected for CSRs (`command/certificate/create.go:596-638`).
- `--key <file>` supplies an existing key, and a *public-key-only* `--key` requires `--skip-csr-signature` (the cert is built with `x509util.NewCertificateFromX509` rather than by signing a CSR); KMS-backed signers (`cryptoutil.IsKMSSigner`) skip writing a local key file (`command/certificate/create.go:653-657`, `command/certificate/create.go:700-710`, `command/certificate/create.go:761-764`).
- Output files are written 0600; private keys are PEM-serialized with password encryption unless `--no-password`, which itself requires `--insecure` (`command/certificate/create.go:766-770`, `command/certificate/create.go:504-508`).

Key defaults come from `utils.GetKeyDetailsFromCLI`: EC P-256 unless `--kty` selects RSA (minimum `keyutil.MinRSAKeyBytes*8` bits without `--insecure`, default 2048) or OKP Ed25519 (`utils/cli.go:14-70`, `flags/flags.go:24-70`).

## The rest of `step certificate`

`Subcommands`: bundle, create, fingerprint, format, inspect, install/uninstall, key, lint, needs-renewal, p12, sign, verify (`command/certificate/certificate.go:84-102`). Representative behaviors:

- **inspect/verify/lint/fingerprint/needs-renewal all accept a remote TLS endpoint instead of a file**: when the positional argument parses as a URL, they dial it (`getPeerCertificates` with `--servername`, `--insecure`) and use the first peer certificate (`command/certificate/verify.go:170-182`, `command/certificate/remote.go`). `verify` additionally supports `--roots` (file, comma list, or directory), `--host` name checking, `--verify-ocsp`/`--verify-crl`, and treats post-leaf PEMs as intermediates (`command/certificate/verify.go:149-215`). `lint` runs `smallstep/zlint` checks (`command/certificate/lint.go:130-144`), and `needs-renewal` flags certificates past two-thirds of lifetime or within `--expires-in` (`command/certificate/needsRenewal.go:26-110`).
- **sign** locally signs a CSR with `--ca/--ca-key` (or KMS URIs), honoring the same profile/template flags plus `--bundle` and an optional skip of CN-as-SAN promotion (`command/certificate/sign.go:50-210`).
- **install/uninstall** manage root trust in the OS default store, Java keystore, and Firefox NSS database via `smallstep/truststore`, with granular `--java`, `--firefox`, `--system`, and `--name` flags (`command/certificate/install.go:22-152`).
- **p12** packages cert+key+chain into a PKCS#12 file, with an opt-in legacy algorithm mode (PBE+SHA1+RC2/3DES) for old consumers (`command/certificate/p12.go:26-85`); **bundle** assembles a full validation chain from PEM/DER inputs; **format** re-encodes PEM↔DER; **fingerprint** prints SHA-256 (SHA-1 only with `--insecure`) per bundle position (`command/certificate/fingerprint.go:26-99`).

## `step crypto`: JOSE and primitives

The `crypto` group aggregates jwk/jwt/jwe/jws/jose, hash, kdf, key, nacl, otp, rand, winpe, plus top-level `keypair` and `change-pass` (`command/crypto/crypto.go:160-176`):

- **JWT/JWS/JWE/JWK**: `step crypto jwt sign|verify|inspect` and the JWS/JWE counterparts operate on JWKs from files, KMS URIs (`--kms`), or key IDs; `jwk create` emits public/private JWK JSON, `jwk keyset` manages JWKS files, and `jose` offers serialization swapping and key conversion utilities (`command/crypto/jwk/create.go`, `command/crypto/jwt/jwt.go`, `command/crypto/jose/jose.go:19-35`). JWK signatures feed `step ssh` SSHPOP token generation (`utils/cautils/token_generator.go:313-345`), the same library path as these commands.
- **KDF**: `step crypto kdf hash|compare|gen-salt` supports `scrypt`, `bcrypt`, and `argon2i`/`argon2id`, emitting and parsing PHC-format strings (`$argon2id$v=19$m=..,t=..,p=..$salt$hash`) through `internal/kdf`; input is read from the terminal by default, and passing the secret as a CLI argument explicitly requires `--insecure` (to keep it out of process listings) (`command/crypto/kdf/kdf.go:27-138`, `command/crypto/kdf/kdf.go:165-193`, `internal/kdf/phc.go`, `internal/kdf/argon2.go`, `internal/kdf/scrypt.go`). `change-pass` and `keypair` reuse these for PEM passphrase handling (`command/crypto/change-pass.go`, `command/crypto/keypair.go:22-90`).
- **hash** digests files or directories (directory mode serializes entries for deterministic hashing) with `--algorithm` selection and a constant-time `verify` against an expected digest (`command/crypto/hash/hash.go:34-165`).
- **nacl** wraps libsodium-style primitives (`box`, `secretbox`, `sign`) and **otp** generates/verifies TOTP codes via `pquerna/otp` including `--key-uri` secrets (`command/crypto/nacl/nacl.go:15`, `command/crypto/otp/generate.go:9-10`); **rand** emits random strings in selectable encodings or from a dictionary file (`command/crypto/rand/rand.go:25-34`).

## Reading order

Offline creation (`certificate create/sign`) is the local mirror of what the CA does on enrollment; the same templates, SANs, and profile rules apply — compare [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md) for the online equivalent of `certificate sign` (which is `step ca sign`).
