---
type: workflow
title: OAuth and JOSE Toolkit Workflows
description: step oauth's four grant flows with embedded Google clients and loopback/device/OOB/JWT-bearer handling, plus the crypto toolkit (jwt/jws/jwe/jwk/kdf/otp/nacl/hash) built on go.step.sm/crypto.
tags: [oauth, oidc, jose, jwt, kdf, otp, crypto-toolkit]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-b869844a56f117af4344a1a7
    resource: repo://command/crypto/change-pass.go
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-7791e23a8d1c79740aae9b97
    resource: repo://command/crypto/jwt/sign.go
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-43f82bca17775bc861344237
    resource: repo://internal/kdf/kdf.go
  - id: openwiki-source-4658661d824001e81c8b5758
    resource: repo://pkg/bcrypt_pbkdf/bcrypt_pbkdf.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---

# OAuth and JOSE Toolkit Workflows

Two families turn identity into tokens: `step oauth` (an OAuth 2.0/OIDC client)
and `step crypto` (general-purpose JOSE/KDF/OTP toolkit). `step ca token` ties
them together by minting provisioning JWTs.

## `step oauth`

`command/oauth/cmd.go` implements the "installed application" OAuth 2.0 flows.
It ships **embedded Google client credentials** for the default provider —
regular and device-authorization client IDs plus a "not so secret" secret —
documented in-code as open-source test clients with no API access
(command/oauth/cmd.go:38-60); `--client-id/--client-secret` override them for
any provider.

### Flow selection (command/oauth/cmd.go:491-511)

| Mode | Trigger | Implementation |
| --- | --- | --- |
| Authorization-code + loopback redirect | default | `DoLoopbackAuthorization`: `httptest.Server` bound to `127.0.0.1` (or `--listen <addr>`, with `--listen-url` advertising a different public redirect URI), browser opened via `exec.OpenInBrowser`; if the browser cannot launch — or `STEP_OPEN_BROWSER=0` — the auth URL is printed for manual opening (cmd.go:768-800, exec/exec.go:103-127) |
| OOB | `--console-flow oob` (or `STEP_CONSOLE=1` device) | `DoManualAuthorization`: user pastes the code from `urn:ietf:wg:oauth:2.0:oob` callback (cmd.go:819-838) |
| Device | `--console-flow device` (+ optional `--device-authorization-endpoint`, which requires `--token-endpoint`) | `DoDeviceAuthorization`: polls the token endpoint honoring `interval`/`slow_down`, prints verification URI (accepting legacy `verification_url`) and user code (cmd.go:863-982, 411-426) |
| Two-legged / JWT bearer | `--interactive=false` + `--subject`/`--jwt` | `DoTwoLeggedAuthorization`, or `DoJWTAuthorization` which builds an RS256 assertion (iss=sub=issuer, exp=+3600, kid=clientID) signed by the PEM PKCS8 client secret using the `jwt-bearer` grant URN (cmd.go:983-1092, 62-66) |

Output is shaped by `--header` (`Authorization: Bearer …` line), `--bare`
(raw access or, with `--oidc`, ID token), else pretty-printed token JSON.
Default scope is `openid email`, extendable with repeated `--scope`;
`--prompt` and `--auth-param` pass OIDC prompt semantics
(cmd.go:463-470).

OIDC id_tokens from `step oauth` are verifiable with `step crypto jwt verify`,
and the CA's OIDC provisioner flow drives this command as a subprocess —
`generateOIDCToken` invokes `step oauth --oidc --bare --provider …` via
`exec.Step` (utils/cautils/token_generator.go:144-169; see
[CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)).

## `step ca token`

`command/ca/token.go` is the user-facing entry to the token machinery: it
maps `--type` (default `x509-sign`, plus `ssh-revoke`, `ssh-renew`,
`ssh-rekey`, `ssh-host-sign`, `ssh-user-sign`, `x509-revoke`, `x509-renew`)
to `cautils` token-type constants and calls `NewTokenFlow`/
`OfflineTokenFlow` (command/ca/token.go:323-342). The result is a JWT whose
claims are documented in [Provisioning Tokens](/openwiki/core/token-package.md).

## `step crypto` toolkit

The group registers: `change-pass`, `create-keypair`, `jwk`, `jwt`, `jwe`,
`jws`, `jose`, `hash`, `kdf`, `key`, `nacl`, `otp`, `rand`, `winpe`
(command/crypto/crypto.go:160-175). The group help states the security
policy: safe defaults everywhere, and subtle/insecure primitives are gated
behind `--subtle`/`--insecure` with per-command SECURITY CONSIDERATIONS
sections (command/crypto/crypto.go:28-48).

- **JWK** (`command/crypto/jwk/`): `create` (RSA/EC/OKP/oct per key flags
  validated by `utils.GetKeyDetailsFromCLI` — see
  [Shared Flags](/openwiki/core/flags-and-configuration.md)), `keyset`
  (build JWKS from key files), `public` (strip private material),
  `thumbprint`.
- **JWT/JWS** (`jwt sign|verify|inspect`, `jws sign|verify|inspect`): thin
  CLI layers over `go.step.sm/crypto/jose` with explicit claim flags
  (`--alg/--aud/--iss/--sub/--exp/…`) and x5c/x5t header options
  (command/crypto/jwt/sign.go:24-34) — independent of the `token` package's
  CA-oriented claims builder.
- **JWE** (`encrypt/decrypt`): asymmetric or symmetric (`--subtle` gates key
  policies).
- **OTP** (`command/crypto/otp/`): TOTP/HOTP generation and verification via
  `github.com/pquerna/otp`.
- **NaCl** (`command/crypto/nacl/`): `box`, `secretbox`, `auth`, `sign`
  (libsodium-style primitives from `golang.org/x/crypto`).
- **KDF** (`command/crypto/kdf/` `hash|compare`): backed by `internal/kdf`,
  which implements `Scrypt` (scrypt-32768 default), `Bcrypt`, and `Argon2`
  producing **PHC string format** hashes with random salts
  (`randutil.Salt(16)`), and constant-time comparison via
  `crypto/subtle` (internal/kdf/kdf.go:20-46, internal/kdf/phc.go).
- **hash**, **rand**, **key** (`fingerprint|format|inspect|public|sign|verify`),
  **winpe** (PE Authenticode inspection), **change-pass** (re-encrypt PEM keys
  via `pemutil.Parse`/serialize with old/new password files
  command/crypto/change-pass.go:119-136). `pkg/bcrypt_pbkdf` is a
  compatibility-published package (OpenBSD bcrypt_pbkdf(3)-compatible KDF)
  with no in-repo command consumers (pkg/bcrypt_pbkdf/bcrypt_pbkdf.go:5-7).

## KMS and plugin boundaries

Keys for `step crypto`/`step certificate`/token signing may live outside the
process: the shared `--kms` flag (flags/flags.go:471-508) accepts
`yubikey:`, `pkcs11:`, `tpmkms:`, `cloudkms:`, `awskms:`, `azurekms:` URIs.
Cloud/HSM backends are provided by the external **step-kms-plugin** binary
(`plugin.GetURL` resolves `kms` to its repo; the CA-facing X5C generator wires
KMS signers through `cryptoutil.CreateSigner`,
utils/cautils/token_generator.go:216-233). The plugin model itself is
documented in [CLI Runtime and Plugin Dispatch](/openwiki/architecture/cli-runtime.md).

## Representative tests

- `integration/testdata/crypto/`: per-flow txtar scripts for `jwk create`
  (all four key types), `jwt sign/verify/inspect`, `keypair`, `otp`, help
  (integration/crypto_test.go:30-314).
- `openssl-jwt.sh` in `integration/` cross-checks JWT verification against
  OpenSSL.

## See also

- [Provisioning Tokens (token package)](/openwiki/core/token-package.md)
- [CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)
