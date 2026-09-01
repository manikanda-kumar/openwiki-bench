---
type: ca-token-and-provisioner-system
title: CA Tokens and Provisioners
description: How step generates the single-use JWTs that authorize certificate requests, and how token generation dispatches on the authority's provisioner type.
tags: [tokens, jwt, provisioners, jwk, oidc, x5c, sshpop, authentication]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# CA Tokens and Provisioners

## Purpose and ownership

Every authenticated operation against a step-ca server (sign, renew, revoke,
SSH sign/renew/rekey/rekey) is authorized by a short-lived, single-use JWT
called a "token" (sometimes OTT). The CLI builds these tokens in two layers:

- the `token` package (`token/token.go`, `token/options.go`, `token/parse.go`,
  `token/provision`) owns claim construction, signing, and parsing;
- `utils/cautils` owns the *flows* that decide which credentials to use based
  on the authority's provisioner type (`token_flow.go`, `token_generator.go`).

## Token claims, validity, and signing

`token.Claims` extends `jose.Claims` with `ExtraClaims` and `ExtraHeaders`
maps (repo://token/token.go#L47-L68). Defaults (repo://token/token.go#L11-L24,
repo://token/token.go#L118-L130):

- Issuer `step-cli`, audience `https://ca/sign`;
- validity bounds: `MinValidity` 10s, `MaxValidity` 1h, default validity 5
  minutes, and `MaxValidityDelay` 30 minutes for the not-before skew;
- custom claim names: `sha` (root fingerprint), `sans`, `step` (custom cert
  info), `user` (user data), and `cnf` (proof-of-possession confirmation).

`Claims.Sign` computes the `kid` header via `GenerateKeyID` (the JOSE
thumbprint of the signing key's public key), forces a single `aud` to a string,
and serializes compact JWS (repo://token/token.go#L71-L104,
repo://token/token.go#L132-L144). Option setters in `token/options.go` add
root-CA SHA, SANs, user data, SSH options, confirmation fingerprints,
validity windows, and header-embedding credentials (`WithX5CCerts`,
`WithX5CInsecureCerts`, `WithNebulaCert`, `WithSSHPOPFile`)
(repo://token/options.go#L31-L353).

`provision.New` builds the unsigned one-time token used by sign flows, and its
`SignedString` signs with the compact serialization
(repo://token/provision/provision.go#L23-L38). `TokenGenerator.Token` in
cautils assembles a random 256-bit `jti`, `kid`, issuer, audience, optional
root-CA SHA, custom options, and the validity window before delegating to
`provision.New` (repo://utils/cautils/token_generator.go#L56-L94). Specialized
generators bind the token to the request: `SignToken` embeds SANs and either a
certificate fingerprint or confirmation fingerprint; `SignSSHToken` embeds
`SignSSHOptions` (cert type, key ID, principals, validity)
(repo://utils/cautils/token_generator.go#L96-L140).

## Parsing and identification

`token/parse.go` parses tokens back into a `Payload` that models the claim
vocabularies of every supported provider (Smallstep JWK, OIDC, GCP, AWS,
Azure, K8sSA, Nebula) and classifies a payload via `Payload.Type()` — for
example `sha`/`sans` presence marks a JWK token, the issuer
`kubernetes/serviceaccount` marks a K8sSA token (repo://token/parse.go#L17-L82).
`Parse` verifies the signature against a key; `ParseInsecure` reads claims
without verification (repo://token/parse.go#L138-L166). AWS payloads get their
instance identity document unmarshaled, and Azure payloads are detected by
issuer prefixes (`sts.windows.net`, `login.microsoftonline.*`, etc.) with
`xms_mirid` parsed into subscription/resource group/resource fields
(repo://token/parse.go#L168-L206).

## Audience derivation

Online flows derive the audience from `--ca-url`: `parseAudience` appends the
operation-specific path — `/1.0/sign`, `/1.0/renew`, `/1.0/revoke`,
`/1.0/ssh/sign`, `/1.0/ssh/revoke`, `/1.0/ssh/renew`, `/1.0/ssh/rekey` — and
rejects non-https URLs (repo://utils/cautils/token_flow.go#L38-L76). The
offline CA derives audiences from the first DNS name in `ca.json` with the same
paths but without the `1.0` segment (repo://utils/cautils/offline.go#L140-L158).

## Provisioner selection

`provisionerPrompt` filters the authority's provisioner list based on the flags
present (`x5c-cert`/`x5c-key` → X5C only; `sshpop-*` → SSHPOP;
`nebula-*` → Nebula; `k8ssa-token-path` → K8sSA), narrows by `--kid` and
provisioner/issuer name, and interactively selects when several remain; a
single candidate is auto-selected (repo://utils/cautils/token_flow.go#L311-L412).

## Dispatch by provisioner type

`NewTokenFlow` is the common entry: it applies shared-context options,
derives the audience, fetches the provisioner list from the CA
(`pki.GetProvisioners`), prompts for selection, prompts for a subject when
empty (except OIDC, where the CA derives principals from the email), and then
switches on provisioner type (repo://utils/cautils/token_flow.go#L100-L183):

| Provisioner | Token generation path |
| --- | --- |
| JWK | `generateJWKToken`: load JWK from `--key` file/KMS or decrypt the provisioner's encrypted key fetched from the CA (online) or `ca.json` (offline) (repo://utils/cautils/token_generator.go#L380-L469) |
| OIDC | `generateOIDCToken`: re-executes `step oauth` with the provisioner's configuration endpoint, client ID/secret, scopes, and optional listen address (repo://utils/cautils/token_generator.go#L144-L169) |
| X5C | `generateX5CToken`: signer from `x5c-key` (file or KMS URI), x5c header from `x5c-cert` chain, insecure variant bypasses cert/key binding checks (repo://utils/cautils/token_generator.go#L195-L273) |
| SSHPOP | `generateSSHPOPToken`: only for SSH renew/rekey/revoke types, embedding the SSH cert via `WithSSHPOPFile` (repo://utils/cautils/token_generator.go#L313-L345) |
| Nebula | `generateNebulaToken`: ed25519 Nebula CA/leaf keys from `nebula-key`, embedding `WithNebulaCert` (repo://utils/cautils/token_generator.go#L275-L311) |
| K8sSA | `generateK8sSAToken`: reads the service account token from the well-known in-pod path (or `--k8ssa-token-path`) (repo://utils/cautils/token_generator.go#L183-L193) |
| GCP / AWS / Azure | `p.GetIdentityToken(subject, caURL)` from the cloud metadata identity document; also sets `sharedContext.DisableCustomSANs` from the provisioner config (repo://utils/cautils/token_flow.go#L167-L175) |
| ACME / SCEP | token flows are unsupported: typed errors `ACMETokenError` / `SCEPTokenError` ("do not support token auth flows") (repo://utils/cautils/token_flow.go#L78-L98, repo://utils/cautils/token_flow.go#L176-L179) |

X.509 renewal is special-cased before provisioner selection: every provisioner
type uses `generateRenewToken`, which signs with the renewing certificate's own
key and embeds the certificate chain in the `x5cInsecure` header with issuer
`step-ca-client/1.0` (repo://utils/cautils/token_flow.go#L113-L116,
repo://utils/cautils/token_generator.go#L471-L517).

## Offline and bootstrap variants

`OfflineTokenFlow` takes static `ca.json` configuration when `--ca-config`
exists (delegating to `OfflineCA.GenerateToken`), otherwise requires
`--provisioner`/`--issuer` and `--key` flags and builds a JWK or X5C token from
flags alone (repo://utils/cautils/token_flow.go#L215-L283). The bootstrap flow
(`NewBootstrapToken`) only supports OIDC provisioners and errors on any other
type (repo://utils/cautils/token_flow.go#L185-L201).

## Invariants and failure behavior

- Token validity defaults to 5 minutes and is clamped by `MinValidity`/`MaxValidity`
  in the options layer (repo://token/token.go#L11-L24, repo://token/options.go#L148-L170).
- A random 256-bit JWT ID identifies each token to detect duplicates
  (repo://utils/cautils/token_generator.go#L56-L58).
- Renewal tokens must match the certificate common name when a subject is given
  (repo://utils/cautils/token_generator.go#L492-L494).
- `loadJWK` requires either a `--key` file or a resolvable provisioner
  encrypted key; offline mode requires the `encryptedKey` property inside
  `ca.json` (repo://utils/cautils/token_generator.go#L380-L439).
