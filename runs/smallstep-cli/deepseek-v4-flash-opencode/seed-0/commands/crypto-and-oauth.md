---
type: command-group
title: The step crypto Command Group and step oauth
description: The cryptographic plumbing commands (jose, jwk, jws, jwt, jwe, kdf, key, nacl, otp, hash, rand, winpe, change-pass, keypair) and the step oauth OAuth 2.0/OIDC flows.
tags: [crypto, jose, oauth, oidc, command-group]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-b869844a56f117af4344a1a7
    resource: repo://command/crypto/change-pass.go
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-de56a7f013c914abea1b5a39
    resource: repo://command/crypto/jose/jose.go
  - id: openwiki-source-3ff18e43c134f8b68db97e9e
    resource: repo://command/crypto/jwe/jwe.go
  - id: openwiki-source-fad3c125efd2d257e435d317
    resource: repo://command/crypto/jwk/jwk.go
  - id: openwiki-source-dc8182e26ff530a41971d72d
    resource: repo://command/crypto/jws/jws.go
  - id: openwiki-source-3366fea11fc7ad406ab418a9
    resource: repo://command/crypto/jwt/jwt.go
  - id: openwiki-source-94ab4d15cfde41a9ebf6a5b1
    resource: repo://command/crypto/kdf/kdf.go
  - id: openwiki-source-9db58eb1c6254b94bdead9b9
    resource: repo://command/crypto/key/key.go
  - id: openwiki-source-cbdbf656575c3c23d8f33ae7
    resource: repo://command/crypto/keypair.go
  - id: openwiki-source-8d273008d6963aaf2e8448ae
    resource: repo://command/crypto/nacl/nacl.go
  - id: openwiki-source-afbfd40e83f88bda82951c69
    resource: repo://command/crypto/otp/otp.go
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-75b7456546c94f96bee19f43
    resource: repo://internal/kdf/argon2.go
  - id: openwiki-source-43f82bca17775bc861344237
    resource: repo://internal/kdf/kdf.go
  - id: openwiki-source-d9d38bfde91a5cafc769a652
    resource: repo://internal/kdf/phc.go
  - id: openwiki-source-e88354b0c3fe800a081c381a
    resource: repo://internal/kdf/scrypt.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---

# The step crypto Command Group and step oauth

`step crypto` is a general-purpose cryptographic toolkit; `step oauth`
implements OAuth 2.0 / OpenID Connect flows for CLI applications. Both are
documented here because they share the JOSE/JWT machinery and the security
defaults enforced across the CLI.

## step crypto

`step crypto` registers the subcommands `change-pass`, `keypair`, `jwk`,
`jwt`, `jwe`, `jws`, `jose`, `hash`, `kdf`, `key`, `nacl`, `otp`, `rand`, and
`winpe`. Its help documents the security posture: RSA keys require at least
2048 bits, symmetric keys at least 256 bits, EC defaults to P-256, and
"subtle"/"insecure" operations are gated behind the `--subtle` and `--insecure`
flags. Key types and curves come from `flags.KTY`/`flags.Curve`/`flags.Size`
with the shared `utils.GetKeyDetailsFromCLI` validation.

### Keys and JWKs

- `step crypto keypair <pub_file> <priv_file>` generates a raw PEM public/
  private keypair. Private keys are encrypted with a prompted password (or
  `--password-file`); `--no-password` writes them unencrypted and requires
  `--insecure`. `--from-jwk` converts an existing JWK to PEM instead of
  generating a new key.
- `step crypto change-pass <key-file>` decrypts and re-encrypts an encrypted
  private key (PEM or JWK) with a new password (`--new-password-file`).
- `step crypto jwk` manages JSON Web Keys (RFC 7517): `create`, `keyset`
  (add/list/remove/find within a JWK Set), `public`, and `thumbprint`.
- `step crypto key` manages keys: `format` (PEM ↔ PKCS8), `public`,
  `inspect`, `fingerprint`, `sign`, and `verify`.

### JOSE

- `step crypto jwt` (sign/verify/inspect) works with JSON Web Tokens
  (RFC 7519); `step crypto jws` (sign/verify/inspect) works with JSON Web
  Signatures (RFC 7515).
- `step crypto jwe` (encrypt/decrypt) implements JSON Web Encryption
  (RFC 7516) and requires the `--subtle` flag as a misuse-prevention gate.
- `step crypto jose format` reads a JWT/JWS/JWE from stdin and swaps between
  the compact and JSON serializations.

### Password hashing and KDFs

`step crypto kdf hash` and `step crypto kdf compare` derive and verify
passwords using `scrypt` (default), `bcrypt`, `argon2i`, and `argon2id`. The
KDFs run with fixed "safe" parameters (scrypt `N=32768, r=8, p=1`; bcrypt cost
`10`), and output/compare PHC-formatted strings. Passing the secret as a
command-line argument requires the hidden `--insecure` flag. The
implementations live in `internal/kdf` (`kdf.go`, `scrypt.go`, `argon2.go`,
`phc.go`).

### Other primitives

- `step crypto nacl` (auth, box, secretbox, sign) is a thin CLI wrapper over
  the NaCl library, preferring safe defaults.
- `step crypto otp` (generate, verify) implements TOTP/HOTP one-time passwords
  using `github.com/pquerna/otp`.
- `step crypto hash` computes file hashes; `step crypto rand` generates random
  values; `step crypto winpe` embeds certificates into Windows PE executables.

## step oauth

`step oauth` implements OAuth 2.0 authorization and OIDC single sign-on for
CLI use, with a preconfigured Google client (client IDs/secrets are embedded in
the command for the installed-app flow). It also supports GitHub and arbitrary
providers given an OIDC discovery endpoint (`--provider`).

Supported flows:

- **Loopback authorization** (default): opens a browser, runs a loopback HTTP
  listener on `--listen` (default `127.0.0.1:0`), and exchanges the code with
  PKCE (`S256` code challenge) plus `state`/`nonce` protection.
- **Device Authorization Grant** (`--console` or `--console-flow device`):
  for input-constrained clients; polls the token endpoint.
- **Out-of-band** (`--console-flow oob`): prints an authorization URL and
  reads the verification code from the terminal.
- **Implicit** (`--implicit`, requires `--insecure`): hidden option for the
  implicit flow.
- **Two-legged JWT bearer** (`--account <service-account.json>`): for service
  accounts, either `--jwt` (JWT auth) or `DoTwoLeggedAuthorization`
  (jwt-bearer grant).

Validation rules enforced by `Validate`/`oauthCmd`: `--authorization-endpoint`
and `--device-authorization-endpoint` each require `--token-endpoint`; a custom
`--provider` requires `--client-id`; `--listen` must be a valid
`host:port`; `--listen-url` must be a valid URL with a scheme.

Output modes: by default the command prints the token as indented JSON; `--bare`
prints just the token; `--header` prints an `Authorization: Bearer ...` line;
`--oidc` selects the OIDC ID token instead of the access token.

## Relationship to other pages

- `step oauth --oidc --bare` is invoked by the OIDC token flow, see
  [Provisioning Tokens](../ca/provisioning-tokens.md).
- The shared key flags and `GetKeyDetailsFromCLI` are described in
  [Architecture Overview](../architecture/overview.md).
