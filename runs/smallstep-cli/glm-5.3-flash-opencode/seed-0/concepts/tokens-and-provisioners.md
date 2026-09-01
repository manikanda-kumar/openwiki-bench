---
type: token-model-concept
title: One-Time Tokens and Provisioners
description: The JOSE one-time-token model used to authenticate against step-ca - claims, validity bounds, per-provisioner token generation, type sniffing, and audience conventions.
tags: [tokens, jwt, jose, provisioners, audiences, jwk, oidc, x5c, sshpop, nebula]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-94215bbc8923986ec4e6eb4f
    resource: repo://token/options_test.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-810170e37dbea715fcf454da
    resource: repo://token/parse_test.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-fe701a9db3b467667b0bc90d
    resource: repo://token/token_test.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

`step` authenticates most CA operations with short-lived signed JWT one-time tokens
(OTTs). The token machinery spans three layers: the `token` package (claims and
options), `token/provision` (the one-time-token wrapper), and
`utils/cautils` (provisioner dispatch and token generation flows). This page explains
the model and its invariants; the issuance flow page shows how commands consume it.

## Token claims and defaults

The `token` package defines the claim vocabulary (token/token.go:11-40):

- Standard JOSE claims with defaults: issuer `step-cli` (`DefaultIssuer`), audience
  `https://ca/sign` (`DefaultAudience`), issued-at/not-before = now, expiry =
  now+5m (`DefaultValidity`) (token/token.go:11-24, DefaultClaims at 117-130).
- Smallstep extension claims: `sha` (root certificate SHA-256), `sans` (required
  SANs), `step` (custom certificate information, e.g. SSH options), `user`
  (user-provided template data), and `cnf` (proof-of-possession confirmation
  fingerprint) (token/token.go:26-40).

`Claims.Sign` builds the JWT: it derives a `kid` header via `GenerateKeyID` (the JOSE
thumbprint of the signing key's public half, token/token.go:132-144), sets `typ: JWT`,
applies any extra headers, and forces a single-element audience to a plain string
rather than an array (token/token.go:70-104). `token.NewClaims` applies functional
options over the defaults (token/token.go:106-115), and `provision.New` is the
one-token constructor that wraps claims with a subject
(token/provision/provision.go:23-36) — this is the single creation entry used by the
token generator (utils/cautils/token_generator.go:88-94).

### Validity bounds are enforced at construction

`token.WithValidity` rejects an expiration before not-before, a not-before more than
`MaxValidityDelay` (30 minutes) in the future, and a validity shorter than
`MinValidity` (10s) or longer than `MaxValidity` (1h) (token/token.go:11-24;
token/options.go:146-168). These bounds are part of the token contract, not CA
enforcement — the CLI will not produce a token outside them.

## Options encode token semantics

Functional options in token/options.go translate CLI-level intent into claims:

- `WithRootCA(path)` computes the root certificate's SHA-256 into the `sha` claim;
  `WithSHA` sets it directly (token/options.go:45-64).
- `WithSANS`, `WithStep`/`WithSSH` (the latter nests SSH options under the `step`
  claim), `WithUserData` (merges a map into `user`) (token/options.go:66-108).
- `WithConfirmationFingerprint` and `WithFingerprint` build the `cnf` claim with key
  `x5rt#S256`; the latter accepts a CSR or SSH public key and computes the
  base64url SHA-256 fingerprint itself, binding a token to the key it authorizes
  (token/options.go:110-144). `SignToken` applies it automatically when a CSR or
  fingerprint is present in the shared flow context (utils/cautils/token_generator.go:104-109).
- Header-embedding options attach certificates: `WithX5CCerts`/`WithX5CInsecureCerts`
  set the `x5c`/`x5cAllowInvalid` headers (validating chain-key match first),
  `WithNebulaCert` sets the `nebula` header after verifying the nebula cert matches
  the private key, and `WithSSHPOPFile` sets the `sshpop` header
  (token/options.go:230-362).

## Token types and sniffing

The `token.Type` enum distinguishes JWK, X5C, OIDC, GCP, AWS, Azure, K8sSA, and
Nebula tokens (token/parse.go:17-27). `Payload` embeds the union of all supported
claim sets, and `Payload.Type()` sniffs the type from content: a `google` payload is
GCP, `amazon` is AWS, an Azure payload with `xms_mirid` is Azure, issuer
`kubernetes/serviceaccount` is K8sSA, presence of `sha`/`sans` is JWK, and otherwise
a complete iss/sub/aud/exp/iat set is OIDC (token/parse.go:65-82). This sniffing is
how commands interpret `--token` values supplied by users.

Two parse entry points exist: `Parse(token, key)` verifies the signature, and
`ParseInsecure(token)` deliberately uses `UnsafeClaimsWithoutVerification`
(token/parse.go:138-166). CA flows use `ParseInsecure` because the CLI only needs to
inspect claims (e.g. the `sha` claim to bootstrap the root) before sending the token
to the CA, which performs the real verification. AWS tokens additionally get their
instance identity document unmarshaled, and Azure tokens get `xms_mirid` parsed into
subscription/resource-group/name components via a regex (token/parse.go:168-187,
128-136).

## Audience conventions

Token audiences identify the CA endpoint being authorized. `parseAudience` maps a
token type to a path under the CA URL (utils/cautils/token_flow.go:38-76):

| Token type | Audience path |
|---|---|
| Sign | `/1.0/sign` |
| Renew | `/1.0/renew` |
| Revoke | `/1.0/revoke` |
| SSH user/host sign | `/1.0/ssh/sign` |
| SSH revoke | `/1.0/ssh/revoke` |
| SSH renew | `/1.0/ssh/renew` |
| SSH rekey | `/1.0/ssh/rekey` |

The scheme is forced to https (empty scheme is allowed and upgraded). The token type
constants themselves are declared at utils/cautils/token_flow.go:27-36, and
`step ca token` selects among them for `--renew`/`--revoke` and SSH variants
(command/ca/token.go:330-344).

## Provisioner dispatch

`NewTokenFlow` is the online token entry point (utils/cautils/token_flow.go:100-183):
it computes the audience, short-circuits renewal tokens for all provisioner types
(`RenewType` → `generateRenewToken`, token_flow.go:113-116), fetches the authority's
provisioner list from the CA via `pki.GetProvisioners(caURL, root)`, picks one via
`provisionerPrompt` (auto-selecting when only one candidate survives filtering), and
prompts for a subject when needed — except for OIDC, where the CA derives principals
from the email claim (token_flow.go:127-140). It then dispatches per provisioner
type (token_flow.go:154-182):

- **JWK** → `generateJWKToken`: loads the provisioner's encrypted key — from the CA
  (`pki.GetProvisionerKey`) with password decryption online, from ca.json offline, or
  from `--key` file/KMS — and signs with `TokenGenerator.SignToken`/`SignSSHToken`
  (utils/cautils/token_generator.go:380-469). The shared `TokenGenerator` assembles
  jwt ID, kid, issuer, audience, root SHA, and validity (token_generator.go:35-94).
- **OIDC** → `generateOIDCToken`: shells out to `step oauth --oidc --bare` with the
  provisioner's configuration endpoint, client credentials, scopes, auth params, and
  listen address (honoring `STEP_LISTEN` override) via `exec.Step`
  (token_generator.go:142-168). The OAuth page covers the subcommand this invokes.
- **X5C** → `generateX5CToken`: signs with the certificate key (file or KMS via
  `cryptoutil.CreateSigner`) and embeds the chain in the `x5c` (or
  `x5cAllowInvalid` for insecure) header (token_generator.go:195-273).
- **Nebula** → `generateNebulaToken` (token_generator.go:275-311).
- **SSHPOP** → `generateSSHPOPToken`, restricted to SSH revoke/renew/rekey types
  (token_generator.go:313-345).
- **K8sSA** → `generateK8sSAToken`: reads the pod service-account token file
  (token_generator.go:183-193).
- **GCP/AWS/Azure** → the provisioner's own `GetIdentityToken(subject, caURL)`
  produces the cloud identity token; these provisioners may set
  `DisableCustomSANs` (token_flow.go:167-175).
- **ACME/SCEP** → no token exists; the flow returns `ACMETokenError`/`SCEPTokenError`
  ("do not support token auth flows"), which callers convert into the ACME/SCEP
  flows (token_flow.go:78-98, 176-179).

`NewIdentityTokenFlow` is the OIDC-only variant used by bootstrap flows
(token_flow.go:185-205).

### Renewal tokens are provisioner-independent

`generateRenewToken` (utils/cautils/token_generator.go:471-517) does not use a
provisioner: it builds a JWT with issuer `step-ca-client/1.0`, subject = the leaf
certificate's common name, the `/1.0/renew` audience, and an `x5cInsecure` header
carrying the full certificate chain, signed by the certificate's own private key
(requiring `--x5c-cert`/`--x5c-key` in this path). `step ca renew` uses the same
scheme inline (see the renewal page).

## Offline tokens

`OfflineTokenFlow` (utils/cautils/token_flow.go:212-273) builds tokens from the local
ca.json provisioner configuration instead of fetching from the CA: it locates the
JWK provisioner by `--provisioner`/`--kid`, loads the key from `--key` or the
provisioner's `EncryptedKey` in ca.json (decrypted with a password prompt), and
delegates to the same generator. Offline flows can also produce SSH tokens with the
same audience mapping.

## Representative tests

The token package's unit tests (token/token_test.go, token/parse_test.go,
token/options_test.go) pin the claim construction, sniffing
(`TestPayload_Type`), and option behaviors; the integration suite exercises the
JWK token path end-to-end through `step ca` scenarios. The guide on extending
provisioning describes where a new provisioner type must be threaded through.
