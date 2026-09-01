---
type: "Reference"
title: "Provisioning Tokens (token package)"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-94215bbc8923986ec4e6eb4f
    resource: repo://token/options_test.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-810170e37dbea715fcf454da
    resource: repo://token/parse_test.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-b614d1e6ddf14fa4b02eaa54
    resource: repo://token/provision/provision.go
  - id: openwiki-source-fe701a9db3b467667b0bc90d
    resource: repo://token/token_test.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---


# Provisioning Tokens (token package)

`github.com/smallstep/cli/token` defines the JWT structure exchanged between
the CLI and a `step-ca` authority (the `OTT` in sign/renew/revoke requests),
and re-exported building blocks used by `step crypto jwt sign`. It has two
halves: a **parse side** (`parse.go`) that inspects tokens without trusting
them, and a **build side** (`token.go`, `options.go`, `provision/`) that
assembles and signs claims. All JOSE work is delegated to
`go.step.sm/crypto/jose`.

## Payload model and token types

`JSONWebToken` embeds `jose.JSONWebToken` plus a `Payload` (token/parse.go:29-62)
that combines standard RFC 7519 claims with per-source claim sets:

- JWK/step claims: `sha` (root SHA256), `sans`
- OIDC: `at_hash`, `azp`, `email`, `email_verified`, `hd`, `nonce`
- Azure: `appid`, `appidacr`, `idp`, `oid`, `tid`, `ver`, `xms_mirid`
- K8sSA: the four `kubernetes.io/serviceaccount/*` claims
- Cloud: nested `google` (ComputeEngine fields) and `amazon` (instance
  identity `document` + `signature`) payloads

`Payload.Type()` classifies by structural presence, in priority order
(token/parse.go:65-82): nested `google`/`amazon`/`azure` claims ⇒ GCP/AWS/
Azure; `iss == "kubernetes/serviceaccount"` ⇒ K8sSA; non-empty `sha` or `sans`
⇒ JWK; complete aud+iss+sub+exp+iat ⇒ OIDC; else Unknown. X5C and Nebula are
header-based types (`X5C` "Smallstep JWK with x5c header", `Nebula` "a JWT
with nebula header") declared in the same enum (token/parse.go:17-27); header
presence is what makes them valid to the CA, not payload shape.

## Parsing semantics

- `Parse(token, key)` verifies the signature with the given key before
  unmarshaling claims (token/parse.go:139-151).
- `ParseInsecure(token)` skips verification entirely via
  `UnsafeClaimsWithoutVerification` (token/parse.go:153-166) — used by flows
  that inspect a token to shape requests, never to authorize.
- Post-processing in `parseResponse` (token/parse.go:168-189): AWS tokens
  unmarshal the embedded instance identity document; Azure tokens with an
  issuer matching a known `sts.windows.net`/`login.microsoftonline.*` prefix
  (incl. US/China clouds, token/parse.go:191-206) get their `xms_mirid`
  regex-parsed into `AzurePayload{SubscriptionID, ResourceGroup, ResourceType,
  ResourceName}`.

## Building tokens: Claims, Options, defaults

`Claims` wraps `jose.Claims` with `ExtraClaims` and `ExtraHeaders` maps
(token/token.go:48-68). `NewClaims` starts from `DefaultClaims`
(iss `step-cli`, aud `https://ca/sign`, exp = now + 5m, nbf/iat now) and
applies each `Options` function in order (token/token.go:106-134,
token/token.go:11-25).

Option groups (token/options.go):

- **Standard claims:** `WithIssuer/WithSubject/WithAudience/WithJWTID` reject
  empty strings; `WithKid` overrides the header `kid` (otherwise the
  thumbprint of the signing key is used via `GenerateKeyID`,
  token/token.go:137-145).
- **Validity:** `WithValidity` enforces nbf<exp, nbf no more than
  `MaxValidityDelay` (30m) in the future, and total validity between
  `MinValidity` (10s) and `MaxValidity` (1h) (token/options.go:148-168).
- **Step claims:** `WithRootCA` (SHA256 of a root file; falls back to the
  $STEPPATH secrets root when unused), `WithSHA`, `WithSANS`, `WithStep`, and
  `WithSSH` (which nests under the `step` claim: `{"ssh": …}`)
  (token/options.go:45-108).
- **Proof-of-possession:** `WithFingerprint` computes the base64rawurl SHA256
  of a CSR's DER or a marshaled SSH key into the `cnf` claim as `x5rt#S256`;
  `WithConfirmationFingerprint` sets the same claim from a precomputed value
  (token/options.go:110-144).
- **Custom data:** `WithClaim` (any name) and `WithUserData`, which merges
  into the `user` claim and fails if `user` already holds a non-map
  (token/options.go:31-100).
- **Auth headers:** `WithX5CFile`/`WithX5CInsecureCerts` validate the chain
  against the key (`jose.ValidateX5C`) and set `x5c` or the `x5cInsecure`
  (allow-invalid) header; `WithSSHPOPFile` sets the `sshpop` header via
  `jose.ValidateSSHPOP`; `WithNebulaCert` accepts raw or PEM-wrapped Nebula v1/
  v2 certificates, verifies the private key matches, and sets the binary
  `nebula` header (token/options.go:231-362).

`Claims.Sign` merges `ExtraHeaders` over the signer options (so it can replace
`kid`), forces a single-element audience to serialize as a string rather than
an array, and emits compact JWT (token/token.go:69-103).

## token/provision: the OTT wrapper

`provision.New(subject, opts…)` is a thin convenience: it prepends
`WithSubject` to the caller's options, builds claims via `token.NewClaims`,
and returns a `Token` whose `SignedString(sigAlg, key)` signs the JWT
(token/provision/provision.go:14-36). `cautils.TokenGenerator` is the only
in-repo producer of OTTs through this path; per the package doc it
intentionally does not carry networking info, unlike the CA's bootstrap token
(token/provision/provision.go:12-16).

## Who consumes what

`utils/cautils` (build side — see
[CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md))
and `command/ca/token.go` produce tokens; `ParseInsecure` shapes clients and
default SANs; `command/crypto/jwt sign|verify|inspect` expose the same claim
machinery to users generically.

## Representative tests

- `token/parse_test.go`: `TestParse` (signature-required success/failure),
  `TestParseInsecure` table over JWK/OIDC/cloud token fixtures,
  `TestPayload_Type` pinning the detection ordering
  (token/parse_test.go:59, 139, 285).
- `token/token_test.go`: `TestClaims_Set/SetHeader/Sign`, `TestNewClaims`,
  `TestGenerateKeyID` (token/token_test.go:17-186).
- `token/options_test.go`: one table `TestOptions` exercising every With…
  builder (token/options_test.go:26).
- `token/provision/provision_test.go`: `TestNew` and `TestToken_SignedString`
  (token/provision/provision_test.go:24, 71).

When changing claim shapes or detection rules, these four files are the
contract to update together with the CA-side expectations in
`smallstep/certificates` (which this repository does not control).

## See also

- [CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)
- [Change Guide: Extending Token and Provisioner Flows](/openwiki/changes/extending-token-and-provisioner-flows.md)
- [OAuth and JOSE Toolkit Workflows](/openwiki/workflows/oauth-and-jose.md)
