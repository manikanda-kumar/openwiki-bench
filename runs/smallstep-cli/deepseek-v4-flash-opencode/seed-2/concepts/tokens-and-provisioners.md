---
type: concept
title: Provisioners and One-Time Tokens
description: The provisioner model and how the step CLI mints one-time provisioning tokens (JWTs) for signing, renewing, revoking, and SSH operations, including token types, audiences, claims, and confirmation binding.
tags: [concept, tokens, provisioners, jwt]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# Provisioners and One-Time Tokens

A certificate authority uses **provisioners** as identities that authorize
certificate requests. The CLI turns a provisioner's credentials into a
**one-time token** (an OTT): a JWT signed by the provisioner's key that is
embedded in the `OTT` field of sign/revoke requests. This page covers the token
model and the `NewTokenFlow` machinery in `utils/cautils`.

## The token package

`token/token.go` defines the claim model shared by all provisioning tokens:

- Default claims: issuer `step-cli`, audience `https://ca/sign`, `nbf=now`,
  `iat=now`, and `exp=now+5m`. Validity is bounded: minimum 10s, maximum 1h,
  and a maximum 30m delay before the validity period begins
  (`MinValidity`, `MaxValidity`, `DefaultValidity`, `MaxValidityDelay`).
- Custom claims are stored in `ExtraClaims`; custom headers in `ExtraHeaders`.
  `Claims.Sign` adds a `kid` header (the SHA-256 thumbprint of the signing key),
  forces `aud` to be a string when it is a single-element audience, and emits a
  compact-serialized JWT.
- `GenerateKeyID` returns the JWK thumbprint of the public key (or an opaque
  signer's public key) used as the `kid`.
- `token/provision.New` builds a `provision.Token` with `WithSubject(subject)`
  applied over `NewClaims`, and `SignedString` signs it with the given algorithm.

### Claim and header options

`token/options.go` provides the building blocks used by token generators:

- `WithRootCA(path)` / `WithSHA(sum)` set the `sha` claim to the SHA-256 of a
  root certificate, enabling bootstrap-style client construction.
- `WithSANS` sets the `sans` claim (the SAN set the signing request must match).
- `WithStep` / `WithSSH` set the `step` claim; `WithUserData` merges a map into
  the `user` claim (exposed to templates as `.Token.user`).
- Confirmation claims: `WithFingerprint` and `WithConfirmationFingerprint` set a
  `cnf` claim with `x5rt#S256`, binding the token to a specific CSR or SSH
  public key (Proof-of-Possession).
- Headers: `WithX5CCerts`/`WithX5CFile` set the `x5c` header, `WithX5CInsecureCerts`
  the `x5cInsecure` header, `WithNebulaCert` the `nebula` header, and
  `WithSSHPOPFile` the `sshpop` header. `WithKid` overrides the header kid.

## Token types and audiences

`token/parse.go` defines how the CLI classifies an arbitrary token. `Payload.Type()`
returns one of `JWK`, `X5C`, `OIDC`, `GCP`, `AWS`, `Azure`, `K8sSA`, `Nebula`,
or `Unknown`, inferred from claims (e.g. a `google` claim means GCP, an
`amazon` claim means AWS, issuer `kubernetes/serviceaccount` means K8sSA, a
`sha`/`sans` claim means JWK). AWS and Azure payloads are post-processed in
`parseResponse` (decoding the instance-identity document and parsing the
`xms_mirid` claim respectively). `Parse` verifies the signature, while
`ParseInsecure` only parses — commands use the latter when the CA will validate
the token anyway.

The token **audience** is derived from the CA URL and the token purpose.
`parseAudience` (utils/cautils/token_flow.go:39-76) resolves the CA URL and
appends an API path: `/1.0/sign`, `/1.0/renew`, `/1.0/revoke`,
`/1.0/ssh/sign`, `/1.0/ssh/renew`, `/1.0/ssh/revoke`, or `/1.0/ssh/rekey`,
matching the token type (`SignType`, `RenewType`, `RevokeType`,
`SSHUserSignType`, `SSHHostSignType`, `SSHRevokeType`, `SSHRenewType`,
`SSHRekeyType`).

## NewTokenFlow dispatch

`NewTokenFlow` (utils/cautils/token_flow.go:101-183) is the central flow for
generating a token against an online CA:

1. It computes the audience from `--ca-url` and the token type.
2. For `RenewType` it short-circuits to `generateRenewToken`, which builds an
   X5C-token from the certificate/key passed via `--x5c-cert`/`--x5c-key`.
3. Otherwise it fetches the provisioner list from the CA (`pki.GetProvisioners`),
   filters and prompts via `provisionerPrompt`, then dispatches on the
   provisioner concrete type:
   - **JWK**: `generateJWKToken` — `loadJWK` loads the private key from
     `--key`/KMS or decrypts the provisioner's encrypted key fetched from the
     CA (`pki.GetProvisionerKey`), using the provisioner's `kid` as the JWT kid.
   - **OIDC**: `generateOIDCToken` re-invokes `step oauth --oidc --bare` with
     the provider's configuration endpoint, client id/secret, scopes, and auth
     params, returning the identity token.
   - **X5C**: `generateX5CToken` signs with the `--x5c-key` (optionally via
     KMS), sets the `x5c`/`x5cInsecure` header from `--x5c-cert`/`--x5c-chain`.
   - **Nebula**: `generateNebulaToken` sets the `nebula` header from
     `--nebula-cert`/`--nebula-key`.
   - **SSHPOP**: `generateSSHPOPToken` sets the `sshpop` header from
     `--sshpop-cert`/`--sshpop-key` for revoke/renew/rekey token types.
   - **K8sSA**: `generateK8sSAToken` reads the service-account token file
     (default `/var/run/secrets/kubernetes.io/serviceaccount/token`).
   - **GCP/AWS/Azure**: `p.GetIdentityToken(subject, caURL)` obtains the
     platform identity token and records `DisableCustomSANs` in the shared flow
     context.
   - **ACME/SCEP**: return typed errors (`ACMETokenError`, `SCEPTokeError`) so
     callers switch to the ACME protocol flow instead.

`provisionerPrompt` filters the list by `--x5c-cert`/`--x5c-key`,
`--sshpop-cert`/`--sshpop-key`, `--nebula-cert`/`--nebula-key`,
`--k8ssa-token-path`, then by `--kid`, `--admin-provisioner`, and
`--provisioner`/`--issuer`; it auto-selects when exactly one candidate remains.

## Offline token flow

`OfflineTokenFlow` (utils/cautils/token_flow.go:212-273) generates tokens without
a CA. When the `ca.json` file exists it delegates to `OfflineCA.GenerateToken`,
which uses the embedded provisioners and the synthesized audience. Otherwise it
requires `--provisioner`/`--issuer` and `--key` and builds a JWK token directly
(optionally with an X5C header), deriving `kid` from `--kid` or the key
thumbprint.

## Sign-token binding

The sign flow ties tokens to the request:

- `TokenGenerator.SignToken` (utils/cautils/token_generator.go:98-117) sets the
  `sans` claim (subject when none given) and, when a CSR or confirmation
  fingerprint is present in the shared flow context, adds the `cnf` claim.
- On the command side, `step ca certificate` validates that the JWK token subject
  matches the CSR common name, and rejects `--token` combined with `--san`
  (utils/cautils token flows and command/ca/certificate.go:280-293).
- `generateRenewToken` checks the positional subject matches the certificate
  common name and requires both `--x5c-cert` and `--x5c-key`.

## Command surface

`step ca token` (command/ca/token.go) is the direct CLI for this machinery: it
maps `--revoke`/`--renew`/`--rekey` and `--ssh`/`--host`/`--principal` flags to
the appropriate token type, parses `--cnf`/`--cnf-file` into confirmation
claims, handles `--not-before`/`--not-after` and `--cert-not-before`/
`--cert-not-after` bounds, and either prints the token or writes it to
`--output-file` (mode 0600). It rejects incompatible flag combinations such as
`--ssh` with `--san`.
