---
type: "Reference"
title: "Provisioning tokens: claims, options, and parsing"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-810170e37dbea715fcf454da
    resource: repo://token/parse_test.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-b614d1e6ddf14fa4b02eaa54
    resource: repo://token/provision/provision.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# Provisioning tokens: claims, options, and parsing

One-time provisioning tokens (OTTs) authenticate certificate requests to a
step-ca authority. The `token` package defines the claim model and the
`token/provision` package the thin signing wrapper used by the CA token flows.

## Claim model

`token.Claims` embeds `jose.Claims` (standard `iss`, `aud`, `sub`, `exp`,
`nbf`, `iat`, `jti`) and adds `ExtraClaims` and `ExtraHeaders` maps
(`token/token.go:47-52`). Signing a claims object:

- Adds `"typ":"JWT"` and a `kid` header; `kid` defaults to the SHA-256
  thumbprint of the signing key (`GenerateKeyID`) but can be overridden through
  `ExtraHeaders` (`token/token.go:71-104`).
- Forces a single-element audience to be serialized as a string (`aud`),
  matching what step-ca expects (`token/token.go:94-97`).

`DefaultClaims` sets issuer `step-cli`, audience `https://ca/sign`, a 5-minute
expiry, and `nbf`/`iat` at the current UTC time (`token/token.go:118-130`).

### Validity constraints

The package-level constants bound token lifetimes
(`token/token.go:11-24`):

| Constant | Value |
|---|---|
| `DefaultValidity` | 5 minutes |
| `MinValidity` | 10 seconds |
| `MaxValidity` | 1 hour |
| `MaxValidityDelay` | 30 minutes |

`WithValidity` enforces that `exp` is after `nbf`, that the requested
not-before delay is at most `MaxValidityDelay`, and that the requested validity
window is within `[MinValidity, MaxValidity]` (`token/options.go:146-168`).

## Claim options

`token/options.go` provides `Options` functions applied by `NewClaims`:

- **Identity**: `WithIssuer`, `WithSubject`, `WithAudience`, `WithJWTID`,
  `WithKid` (header).
- **Smallstep claims**: `WithRootCA`/`WithSHA` set the `sha` claim (SHA-256 of
  the root certificate); `WithSANS` sets the `sans` claim; `WithStep` sets a
  `step` claim; `WithUserData` merges into the `user` claim; `WithSSH` wraps an
  SSH signing payload under `step.ssh`; `WithConfirmationFingerprint`/
  `WithFingerprint` set the `cnf` claim with `x5rt#S256` proof-of-possession
  (`token/options.go:30-168`).
- **Header certificates**: `WithX5CFile`/`WithX5CCerts` set the `x5c` header
  (chain validated against the key), `WithX5CInsecureFile`/`WithX5CInsecureCerts`
  set `x5cInsecure`, `WithNebulaCert` sets the `nebula` header (Nebula
  certificate + key validation), and `WithSSHPOPFile` sets the `sshpop` header
  (`token/options.go:230-362`).

## Token parsing and type detection

`token.Parse` verifies the signature with the given key and returns a
`JSONWebToken`; `token.ParseInsecure` decodes claims without verification
(`token/parse.go:138-166`). The `Payload` carries both standard claims and
step-ca extensions: `sha`, `sans`, OIDC claims (`at_hash`, `azp`, `email`,
`email_verified`, `hd`, `nonce`), Azure claims (`appid`, `tid`, `oid`,
`xms_mirid`), Kubernetes service-account claims, and cloud payloads
(`google`, `amazon`, `azure`) (`token/parse.go:38-62`).

`Payload.Type()` classifies the token in priority order
(`token/parse.go:64-82`):

1. `google` payload present → **GCP**.
2. `amazon` payload present → **AWS**.
3. `azure` payload present → **Azure**.
4. Issuer `kubernetes/serviceaccount` → **K8sSA**.
5. Non-empty `sha` or `sans` → **JWK**.
6. Audience + issuer + subject + exp + iat present → **OIDC**.
7. Otherwise → **Unknown**.

`parseResponse` additionally decodes the AWS instance identity document from
the `amazon.document` claim and parses Azure's `xms_mirid` into
subscription/resource-group/resource fields via a regular expression
(`token/parse.go:168-206`). The token type constants also include `X5C`
(JWK with an x5c header) and `Nebula` (`token/parse.go:17-27`).

`token/parse_test.go` verifies parsing and classification for JWK, OIDC, GCP,
AWS, and Azure tokens (including Azure managed-identity `xms_mirid` variants).

## The provision token helper

`token/provision.Token` wraps `token.Claims` and implements the `token.Token`
interface. `provision.New` applies `WithSubject` plus any options and builds
the claims; `SignedString` signs them into a compact JWT
(`token/provision/provision.go:14-36`). The CA token generator
(`utils/cautils/token_generator.go`) uses this helper to mint the tokens whose
generation strategy depends on the selected provisioner type (see
[CA client and enrollment flows](ca-client-flows.md)).
