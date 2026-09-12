---
type: "Reference"
title: "Token claim"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-b614d1e6ddf14fa4b02eaa54
    resource: repo://token/provision/provision.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---


## Responsibility

The `token` package ([`token/token.go`](../../token/token.go), `token/options.go`,
[`token/parse.go`](../../token/parse.go)) models the one-time tokens (OTTs) used
to authorize requests against `step-ca`, and the `token/provision` package
defines a token type for newly provisioned end-entities. These tokens are JWTs
([RFC 7519]) built on `go.step.sm/crypto/jose`.

## Token interface and Claim types

`token/token.go` defines:

- `Token` — the interface that all token types attempt to implement:
  `SignedString(sigAlg string, priv interface{}) (string, error)`.
- `Claims` — a `jose.Claims` wrapper that adds `ExtraClaims` and `ExtraHeaders`
  maps, with `Set`/`SetHeader` helpers (guarding against nil maps).
- `Sign(alg, key)` — builds a `jose.Signer` with `type=JWT` and a `kid` header,
  forces a single `aud` to be a string, appends `ExtraClaims`, and compact
  serializes the JWT.

Default claims are produced by `DefaultClaims()`: issuer
`DefaultIssuer = "step-cli"`, audience `DefaultAudience = "https://ca/sign"`,
and validity windows set from [`token/token.go`](../../token/token.go) constants:

- `MinValidity = 10s`, `MaxValidity = 1h`, `DefaultValidity = 5m`,
  `MaxValidityDelay = 30m`.

`NewClaims(opts ...Options)` starts from `DefaultClaims()` and applies each
option.

## Claim-name constants

`token/token.go` declares the special claim property names:

- `RootSHAClaim = "sha"` — SHA-256 of the root certificate.
- `SANSClaim = "sans"` — required subject alternative names.
- `StepClaim = "step"` — custom information for the certificate.
- `UserClaim = "user"` — user-provided custom information.
- `ConfirmationClaim = "cnf"` — a JSON object used as proof-of-possession.

`GenerateKeyID` derives the `kid` as the SHA-256 thumbprint of the public key
(via `jose.Thumbprint`); opaque signers are handled specially.

## Claim options

`token/options.go` supplies the functional `Options` constructors:

- `WithClaim`, `WithRootCA` (computes the `sha` claim from a PEM cert, default
  to the `$STEPPATH` root), `WithSHA`, `WithSANS`, `WithStep`, `WithUserData`
  (merges into the `user` claim), `WithSSH`.
- `WithConfirmationFingerprint` / `WithFingerprint` — set the `cnf` claim with
  `x5rt#S256` (for a CSR or SSH public key).
- `WithValidity` — validates and sets `nbf`/`exp`: `exp` must not precede `nbf`,
  the requested validity delay is capped at `MaxValidityDelay`, and the validity
  is bounded by `MinValidity`/`MaxValidity`.
- `WithIssuer`, `WithSubject`, `WithAudience`, `WithJWTID`, `WithKid`.
- Header options: `WithX5CFile`/`WithX5CCerts` (sets the `x5c` header after
  validating the chain and key), `WithX5CInsecureFile`/`WithX5CInsecureCerts`
  (sets the `x5cInsecure` header without chain validation — flagged as "here be
  dragons"), `WithNebulaCert` (sets the `nebula` header and validates the key
  against the certificate), `WithSSHPOPFile` (sets the `sshpop` header).

## Parsing

[`token/parse.go`](../../token/parse.go) provides parsing and type detection:

- `Payload` extends `jose.Claims` with the step-ca-specific claims: `sha`, `sans`,
  OIDC claims (`at_hash`, `azp`, `email`, `email_verified`, `hd`, `nonce`),
  Azure claims (`appid`, `appidacr`, `idp`, `oid`, `tid`, `ver`, `xms_mirid`),
  K8s service-account claims, and cloud providers (`Google`, `Amazon`, `Azure`).
- `Payload.Type()` detects the token type (JWK, X5C, OIDC, GCP, AWS, Azure, K8sSA,
  Nebula) from the claim presence.
- `Parse(token, key)` verifies and parses the token; `ParseInsecure(token)`
  parses without signature verification (used e.g. to inspect `--token` values
  before use).
- `parseResponse` post-processes cloud payloads, e.g. unmarshaling the AWS
  identity document and parsing the Azure `xms_mirid` into a structured
  `AzurePayload` (subscription/resource group/type/name) via a regex.

## The provision package

`token/provision/provision.go` defines `provision.Token`, a one-time-use token
intended to be exchanged for a newly provisioned certificate by an end entity.
Unlike a bootstrap token it does not self-contain networking information for the
CA. `New(subject, opts...)` builds it from `token.NewClaims` (with `WithSubject`
and sane defaults), and `SignedString` signs the underlying `token.Claims` in
compact serialization. It implements the `token.Token` interface.

## Relationships

The OTTs constructed here are consumed by the CA integration flows
([ca-integration.md](ca-integration.md)) where `NewTokenFlow`/`OfflineTokenFlow`
produce them, and the JOSE/JWT machinery in the crypto group
([crypto-command-group.md](crypto-command-group.md)) is built on the same
`go.step.sm/crypto/jose` library.
