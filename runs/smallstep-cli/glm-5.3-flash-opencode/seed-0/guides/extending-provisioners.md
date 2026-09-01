---
type: change-guide
title: "Guide: Extending Token Provisioning"
description: How to thread a new provisioner token type or new token claim through the token package, token dispatch, and CA flows, with the invariants that must hold.
tags: [guide, tokens, provisioners, claims, extension]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-ff8a7fe9f3a4815e9b6b5c30
    resource: repo://command/ca/sign.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-94215bbc8923986ec4e6eb4f
    resource: repo://token/options_test.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-810170e37dbea715fcf454da
    resource: repo://token/parse_test.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

Adding a provisioner token type (or teaching existing tokens a new claim) is the
representative deep change in this repository. The provisioner types themselves
(`provisioner.JWK`, `provisioner.OIDC`, ...) are defined in the external
`smallstep/certificates` module; this guide covers what must change *here* to
produce and consume a new kind of token. Work through the layers top-down.

## 1. Token representation: token/parse.go

A new token type needs three edits in token/parse.go:

- A new `Type` constant in the enum (JWK, X5C, OIDC, GCP, AWS, Azure, K8sSA,
  Nebula today) — token/parse.go:17-27.
- Payload fields for its claims, following the existing union style
  (token/parse.go:38-62). Cloud providers nest a dedicated payload struct
  (`GCPGooglePayload`, `AWSAmazonPayload`, `AzurePayload`) that gets parsed
  further in `parseResponse` (token/parse.go:168-187).
- A branch in `Payload.Type()` — token/parse.go:65-82. **Order matters**: the
  sniffing is a chain of content tests (`google` payload → GCP, `amazon` → AWS,
  Azure payload, issuer `kubernetes/serviceaccount` → K8sSA, `sha`/`sans` → JWK,
  complete iss/sub/aud/exp/iat → OIDC, else Unknown). A new type must be
  distinguishable before the more generic branches claim it, and
  `token/parse_test.go`'s `TestPayload_Type` (parse_test.go:285) pins this
  behavior.

If the type has post-parse structure (like the Azure `xms_mirid` regex split into
subscription/resource-group/name), do it in `parseResponse` and cover it in
`TestParse`/`TestParseInsecure`.

## 2. Claim/headers: token/options.go and token/token.go

New claims follow the established pattern: a claim-name constant in
token/token.go:26-40 and a functional option in token/options.go that validates
and sets it via `c.Set(...)` — see `WithRootCA` (computes SHA-256, options.go:45-55)
or `WithFingerprint` (accepts typed inputs, options.go:123-144). New JWT *headers*
(cert chains, nebula certs, sshpop) belong in the `WithX5C*`/`WithNebulaCert`/
`WithSSHPOPFile` family (options.go:231-362) and flow through `Claims.Sign`'s
extra-headers loop (token/token.go:82-84).

Invariants to respect here:

- `WithValidity` bounds hold for every token — 10s minimum, 1h maximum, 30m
  maximum not-before delay (token/token.go:11-24, options.go:146-168). A
  provisioner needing longer-lived tokens is a design change, not a local edit.
- Single-element audiences are serialized as strings, not arrays
  (token/token.go:94-97); the CA side relies on this.
- `kid` is the JOSE thumbprint unless explicitly overridden
  (token/token.go:132-144).

## 3. Provisioner selection: utils/cautils/token_flow.go

`provisionerPrompt` (token_flow.go:291-408) is the gate every online flow passes:

- **Flag-driven filtering**: if `--x5c-cert`/`--x5c-key` is set, only X5C
  provisioners are listed, and so on for sshpop, nebula, and k8ssa flags
  (token_flow.go:292-303). A new provisioner with dedicated flags needs a
  `allowXxxProvisionerFilter` and a case here, plus a case in the default filter's
  type switch (token_flow.go:306-317) — otherwise the provisioner will be
  invisible to `step ca token` and friends.
- **Selection rendering**: each type gets a human-readable label in the select
  list (JWK shows kid, OIDC shows client ID, Azure shows tenant —
  token_flow.go:362-393). Unknown types are silently skipped (`default: continue`),
  which is a silent-omission hazard when adding a new type.
- A single surviving candidate is auto-selected (token_flow.go:395-400).

## 4. Token generation: utils/cautils/token_generator.go

Add a `generateXxxToken(ctx, p *provisioner.Xxx, tokType int, tokAttrs tokenAttrs)`
generator and a dispatch case in `NewTokenFlow`'s type switch
(token_flow.go:154-182). Study `generateX5CToken` (token_generator.go:195-273) as
the template for a credential-bearing provisioner: required-flag checks with
`errs.RequiredWithProvisionerTypeFlag`, key loading via `cryptoutil.CreateSigner`
(KMS-aware), the signing algorithm from the public key (`getSigningAlgorithm`,
token_generator.go:519-539), a `TokenGenerator` assembled with
`fmt.Sprintf("%s#%s", audience, p.GetIDForToken())` as the audience, and a final
switch over `tokType` choosing `SignToken`/`RevokeToken`/`SignSSHToken`/`Token`.

If the provisioner cannot mint tokens locally (like ACME/SCEP), follow the
`ACMETokenError`/`SCEPTokenError` pattern (token_flow.go:78-98, 176-179): define
an error type and let the callers (`certificateAction`, `signCertificateAction`)
detect it with `errors.As` and reroute to the provisioner's own flow
(command/ca/certificate.go:261-266, command/ca/sign.go:192-198).

Cloud-identity provisioners that mint tokens elsewhere (GCP/AWS/Azure) simply call
`p.GetIdentityToken(subject, caURL)` and may set `sharedContext.DisableCustomSANs`
(token_flow.go:167-175) — the SAN-default logic in the issuance flow reads it.

## 5. Downstream consumption: CA flows

`CertificateFlow.CreateSignRequest` (certificate_flow.go:312-378) switches on
`jwt.Payload.Type()` to derive subject and SANs. A new type needs a case deciding:

- what the CSR common name is,
- which SANs default in (and whether `DisableCustomSANs` suppresses the subject),
- whether the CLI validates the subject or defers to the server (compare
  certificate.go:280-293: JWK is validated client-side; OIDC/AWS/GCP/Azure/K8sSA
  defer to the CA; anything unrecognized is rejected).

Add the new type to those validation switch statements too — leaving it out makes
`step ca certificate` reject valid tokens with "token is not supported".

If the type authorizes a new CA endpoint, extend `parseAudience`
(token_flow.go:38-76) so the audience maps to the right `/1.0/...` path; the
audience table is the contract the offline authority mirrors (offline.go:140-158).

## 6. Claims that ride along (lighter path)

For a new *claim* on existing token types rather than a new type, the surface is
smaller: constant + option (§2), plumb it through `TokenGenerator.SignToken` or
`SignSSHToken` (token_generator.go:96-140) — typically via a `sharedContext` field
and a `cautils.Option` like `WithCustomAttributes` (token_generator.go:112-114) —
and expose it from the command flags. `step ca token`'s `--set`/`--set-file`
already demonstrates the full path into the `user` claim
(command/ca/token.go:359-390).

## 7. Verify

- Extend `token/parse_test.go` (`TestPayload_Type`, `TestParse`,
  `TestParseInsecure`) and `token/options_test.go` for the new representation.
- Offline coverage: `OfflineCA.GenerateToken` and `OfflineTokenFlow` exercise the
  same `tokenAttrs` machinery without a network, which makes flow-level behavior
  testable.
- End-to-end verification against a real CA is out of scope for this repository's
  suite; the integration tests cover the standalone token surfaces (JWT sign/verify,
  JWK) rather than CA provisioner round-trips. The guide on adding commands covers
  the general test conventions.

## Checklist

1. `token/parse.go`: Type constant, Payload fields, `Type()` branch (order!),
   `parseResponse` structure, tests.
2. `token/token.go` + `token/options.go`: claim constants, options, header options
   if needed.
3. `token_flow.go`: prompt filters (flag-driven and default), select rendering,
   `NewTokenFlow` dispatch (or an error type that callers reroute on).
4. `token_generator.go`: `generateXxxToken` with required-flag checks, KMS-aware
   key loading, tokType switch.
5. `certificate_flow.go`: SAN/subject defaults; `certificate.go`/`sign.go`:
   subject-validation switches.
6. `parseAudience` + offline audience if a new endpoint.
7. Changelog entry; behavior changes require one
   (docs/local-development.md:10).
