---
type: concept
title: Provisioning Tokens
description: How the step CLI mints, signs, and parses one-time JWT provisioning tokens, including the claim model, token types, validity bounds, and the online/offline token flows across provisioner types.
tags: [jwt, provisioning-tokens, otp, provisioners, claims]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-b614d1e6ddf14fa4b02eaa54
    resource: repo://token/provision/provision.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---

# Provisioning Tokens

A provisioning token is a short-lived JWT that authorizes a single CA request
(e.g. sign, renew, revoke, or SSH sign). This page covers the `token/` package
that models these tokens and the flows in `utils/cautils` that produce and
consume them.

## Claim model

The `token` package builds claims as `jose.Claims` (from `go.step.sm/crypto`)
plus `ExtraClaims` and `ExtraHeaders` maps. `DefaultClaims()` seeds:

- `iss` = `step-cli`, `aud` = `https://ca/sign`
- `nbf` and `iat` = now, `exp` = now + 5 minutes (`DefaultValidity`)

`token/token.go` defines the validity bounds enforced by `WithValidity`:
`MinValidity` 10s, `MaxValidity` 1h, and `MaxValidityDelay` 30 minutes between
now and the beginning of the validity window.

Well-known claim names are constants: `sha` (root certificate SHA256), `sans`
(required subject alternative names), `step` (custom step data), `user`
(user-provided custom data), and `cnf` (proof-of-possession / confirmation).

### Signing

`Claims.Sign(alg, key)`:

- computes the `kid` header as the SHA-256 thumbprint of the public key
  (`GenerateKeyID`, honoring `jose.OpaqueSigner`),
- sets the JWT `typ` header and merges any `ExtraHeaders`,
- forces `aud` to be a string when there is exactly one audience value,
- compact-serializes the JWT.

### Options

`token/options.go` provides functional `Options` that set claims:

- Standard/step claims: `WithClaim`, `WithRootCA`/`WithSHA`, `WithSANS`,
  `WithStep`, `WithSSH`, `WithUserData`.
- Confirmation: `WithConfirmationFingerprint(fp)` and `WithFingerprint`
  set the `cnf` claim with an `x5rt#S256` value (CSR or SSH public-key
  fingerprint).
- Validity and identity: `WithValidity` (bounds-checked), `WithIssuer`,
  `WithSubject`, `WithAudience`, `WithJWTID`, `WithKid`.
- Headers: `WithX5CFile`/`WithX5CCerts` (and `WithX5CInsecureFile`/
  `WithX5CInsecureCerts` for the `x5cInsecure` header), `WithNebulaCert`, and
  `WithSSHPOPFile`.

## Parsing and token types

`token/parse.go` defines `JSONWebToken` (a `jose.JSONWebToken` plus a typed
`Payload`) and `Type` detection:

- `Parse` verifies the JWT signature with the given key; `ParseInsecure`
  decodes claims without verification.
- `Payload.Type()` classifies tokens: `GCP` (google claim), `AWS` (amazon
  claim), `Azure` (xms_mirid-based), `K8sSA` (issuer
  `kubernetes/serviceaccount`), `JWK` (has `sha` or `sans` claims), and `OIDC`
  (issuer, subject, audience, expiry, and issued-at all present). Anything else
  is `Unknown`.
- For AWS tokens, `parseResponse` unmarshals the embedded instance identity
  document; for Azure tokens it parses the `xms_mirid` claim into
  subscription/resource group/resource type/name.

`token/provision/provision.go` exposes `provision.Token`, a one-time token
intended to be exchanged for a certificate; `New(subject, opts...)` applies
`sane defaults` for the claims and `SignedString(sigAlg, key)` serializes it.

## Token flows

`utils/cautils/token_flow.go` implements the flows that decide *which* token to
produce.

### NewTokenFlow (online)

`NewTokenFlow(ctx, tokType, subject, sans, caURL, root, ...)`:

1. Computes the audience from the CA URL and token type: `/1.0/sign`,
   `/1.0/renew`, `/1.0/revoke`, `/1.0/ssh/sign`, `/1.0/ssh/renew`,
   `/1.0/ssh/revoke`, `/1.0/ssh/rekey`.
2. For X.509 renewals (`RenewType`), every provisioner uses the same
   `generateRenewToken` path (an `x5cInsecure`-header token carrying the
   certificate being renewed).
3. Otherwise it downloads the provisioner list from the CA and prompts for a
   provisioner (`provisionerPrompt`), then dispatches by provisioner type:
   - JWK → `generateJWKToken` (signing JWK from `--key` or the provisioner's
     encrypted key).
   - OIDC → `generateOIDCToken` (re-invokes `step oauth`).
   - X5C → `generateX5CToken`; SSHPOP → `generateSSHPOPToken`; Nebula →
     `generateNebulaToken`.
   - K8sSA → `generateK8sSAToken` (reads the service-account token file).
   - GCP/AWS/Azure → `p.GetIdentityToken(subject, caURL)`.
   - ACME and SCEP → dedicated error types (`ACMETokenError`,
     `SCEPTokenError`) stating these provisioners do not support token flows.

When the subject is empty, the flow prompts for DNS names/IPs (or an SSH user
principal); OIDC provisioners skip the prompt because the CA derives
principals from the email.

`provisionerPrompt` narrows the candidate list based on flags — `--x5c-cert`/
`--x5c-key` (X5C only), `--sshpop-cert`/`--sshpop-key`, `--nebula-cert`/
`--nebula-key`, `--k8ssa-token-path` — and then filters by `--kid`,
`--admin-provisioner`, or `--provisioner`/`--issuer`. A single remaining match
is auto-selected; otherwise the user picks from a menu.

### OfflineTokenFlow

`OfflineTokenFlow` has two mutually exclusive modes:

- If the `--ca-config` file exists, it builds an `OfflineCA` and calls its
  `GenerateToken` (provisioners and keys come from `ca.json`).
- Otherwise it requires `--provisioner`/`--issuer` and `--key` and mints an
  X5C token (`--x5c-cert`/`--x5c-key`) or a JWK token directly from flags.

### NewIdentityTokenFlow

`NewIdentityTokenFlow` restricts the provisioner list to OIDC and returns an
error for any other provisioner type; it is used when an identity (rather than
certificate-signing) token is needed.

## Relationship to other pages

- The `TokenGenerator` and per-provisioner generators are detailed in
  [CA Client and Certificate Flows](ca-client-and-flows.md).
- The `step ca token` command and its flags are covered in
  [The step ca Command Group](../commands/ca-group.md).
