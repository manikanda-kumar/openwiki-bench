---
type: architecture
title: Token Model and JWT Claims
description: The JWT/one-time-token model used to authorize step-ca operations, including claim fields, signing feature options, supported token types, and strict validity constraints.
tags: [architecture, token, jwt, claims, jose]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---

# Token Model and JWT Claims

Many `step ca` operations are authorized by a one-time token (OTT), represented
as a signed JSON Web Token (JWT). The `token/` package defines the claims
model, defaults, signing options, and payload typing.

## Claim model

The `token.Token` interface (token/token.go:42-45) requires a `SignedString`
method. `token.Claims` (token.go:48-52) embeds `jose.Claims` (the standard
issuer/audience/expiry/nbf/iat/subject/jti) and adds `ExtraClaims` plus
`ExtraHeaders`. `Set` and `SetHeader` let callers attach custom claims and JOSE
headers.

`DefaultClaims` (token.go:118-130) seeds defaults:

- Issuer: `step-cli` (`DefaultIssuer`)
- Audience: `https://ca/sign` (`DefaultAudience`)
- ttl expires `DefaultValidity` (5 minutes) from now, with NotBefore and
  IssuedAt set to the current UTC time.

Named claim keys are defined as constants: `sha` (root SHA256, `RootSHAClaim`),
`sans` (`SANSClaim`), `step` (`StepClaim`), `user` (`UserClaim`), and `cnf`
(Confirmation/Proof-of-Possession, `ConfirmationClaim`).

`Claims.Sign` (token/token.go:71-104) builds a JWT signer with the given
algorithm and key, computes a `kid` header via the SHA256 thumbprint of the
public key (`GenerateKeyID`), adds any extra headers, forces a single `aud` to a
string, and compact-serializes the signed JWT.

## Signing options

`token/options.go` defines `Options func(c *Claims) error` functional options
that are applied by `NewClaims`.

- `WithRootCA(path)`/`WithSHA(sum)` — set the `sha` root fingerprint claim.
- `WithSANS(sans)` — set the `sans` claim.
- `WithStep(v)`, `WithSSH(v)`, `WithUserData(map)` — attach a `step` and
  `user` claim payload.
- `WithConfirmationFingerprint(fp)`/`WithFingerprint(v)` — set a `cnf` claim
  with the base64url SHA256 `x5rt#S256` fingerprint of a CSR or SSH public key
  for Proof-of-Possession.
- `WithValidity(nbf, exp)` — sets NotBefore/Expiry after validating bounds.
- `WithIssuer`, `WithSubject`, `WithAudience`, `WithJWTID`, `WithKid` — set the
  corresponding claim/header values.
- `WithX5CFile`/`WithX5CCerts` (and `WithX5CInsecure*`) — attach an `x5c`
  certificate chain header (the chain is validated against the signing key
  unless the insecure variants are used).
- `WithNebulaCert` — attach a `nebula` header carrying a parsed Nebula
  certificate after verifying it matches the given key.
- `WithSSHPOPFile` — attach an `sshpop` header via
  `jose.ValidateSSHPOP(certFile, key)`.

`WithValidity` (options.go:148-168) enforces strict bounds defined as constants
(token.go): a minimum validity of `MinValidity` (10s), a maximum of `MaxValidity`
(1h), and a maximum allowed delay between now and the beginning of the validity
window (`MaxValidityDelay`, 30m). Violations return errors.

## Token typing and payload parsing

`token/parse.go` defines `Payload` (parse.go:38-62) embedding `jose.Claims` and
adding the step-ca-specific claim fields (`sha`, `sans`, OIDC `at_hash`/`azp`/
`email`, Azure `appid`/`tid`/`oid`, Kubernetes service-account claims, plus
`google`, `amazon`, and `azure` nested payloads).

`Payload.Type()` (parse.go:65-82) classifies a token:

- `GCP` when `google` present, `AWS` when `amazon` present, `Azure` when
  `azure` present or the issuer matches Microsoft STS prefixes.
- `K8sSA` when issuer is `kubernetes/serviceaccount`.
- `JWK` when `sha` or `sans` is present.
- `OIDC` when it has audience/issuer/subject and non-zero expiry/issued-at.
- else `Unknown`.

`Parse(token, key)` verifies the signature and decrypts claims; `ParseInsecure`
decodes claims without verification. During `parseResponse`, AWS tokens
unmarshal the `document` into an instance-identity document edition, and Azure
tokens parse the `xms_mirid` claim into subscription/resource-group/type/name.

## Related

- [Certificate and Token Flows](token-flows.md) — how these tokens are obtained.
- [Online and Offline step-ca Client Integration](../integration/ca-client.md) — token use in sign/renew/revoke.
