---
type: concept
title: One-Time Token Flow and Provisioners
description: How step generates one-time tokens (OTTs) authorizing CA operations, dispatches by provisioner type, encodes claims, and runs online vs offline.
tags: [tokens, jwt, provisioners, claim, offline, online, step-ca]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:42:28.757Z
sources:
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-09-12T20:42:28.757Z" }
---

# One-Time Token Flow and Provisioners

A one-time token (OTT) is a signed JWT that authorizes a single CA request
(e.g. sign, renew, revoke, SSH sign). Token claims constrain the subject,
audience (operation endpoint), SANs, and validity. Provisioners are the
authentication methods configured on the CA; each token type is produced by a
provisioner-specific generator.

## Token claims and constraints

`token.NewClaims` builds a JWT with sane defaults (issuer `step-cli`,
audience `https://ca/sign`, default validity 5 minutes). Validity is bounded:
minimum 10 seconds, maximum 1 hour, and the delay between "now" and the token's
`NotBefore` is capped at 30 minutes (`WithValidity`, `token/options.go`,
`token/token.go`).

Custom claims supported:

- `sans` (`SANSClaim`): required SAN list, matched 1:1 by the CSR.
- `sha`/`RootSHAClaim`: SHA256 of a root cert, used by bootstrap/root flows.
- `cnf`/`ConfirmationClaim`: proof-of-possession as `x5rt#S256` fingerprint of
  a CSR or SSH public key, binding the token to that request.
- `step`/`StepClaim`: embeds SSH options.
- `user`/`UserClaim`: user-supplied custom data from `--set`.

Signing adds a `kid` header (the JWK thumbprint of the signing key unless
overridden) and forces `aud` to a single string when only one audience is set
(`token/token.go`, `token/options.go`).

## Token flow and provisioner dispatch

The token generation entrypoint is `step ca token <subject>`, which parses
flags (`--revoke`, `--renew`, `--rekey`, `--ssh`, `--host`, `--san`,
`--principal`, `--cnf`, `--set`) and selects a token type, then calls
`cautils.NewTokenFlow` (online) or `cautils.OfflineTokenFlow` (offline)
(`command/ca/token.go`).

`NewTokenFlow` computes the audience from `ca-url` (e.g. `/1.0/sign`,
`/1.0/revoke`, `/1.0/ssh/sign`) and fetches the provisioner list from the CA.
It then prompts/interacts with the selected provisioner
(`utils/cautils/token_flow.go`). Token types are enumerated
(`SignType`, `RevokeType`, `SSHUserSignType`, `SSHHostSignType`, `SSHRevokeType`,
`SSHRenewType`, `SSHRekeyType`, `RenewType`).

## Provisioner types

Provisioner-specific generators live in `utils/cautils/token_generator.go`:

- **JWK**: sign with a JWK private key (default); the key is loaded from file
  or fetched/decrypted from the CA.
- **OIDC**: run `step oauth --oidc --bare` with the provisioner's client
  credentials to obtain an identity token.
- **X5C**: place the certificate chain in the JWT `x5c` header and sign with
  the corresponding key.
- **SSHPOP**: place an SSH certificate in the `sshpop` header and sign with
  its key.
- **Nebula**: put a Nebula certificate in the `nebula` header.
- **K8sSA**: read a Kubernetes service-account token from
  `/var/run/secrets/kubernetes.io/serviceaccount/token`.
- **GCP/AWS/Azure**: fetch a cloud identity token via the provisioner.
- **ACME**: not supported for the token flow; returns an
  `ACMETokenError`/`SCEPTokenError` asking to use the ACME/SCEP protocol
  directly.

`TokenGenerator` centralizes kid/issuer/audience/root/SAN and validity
handling, signing a JWT with the provisioner's key
(`utils/cautils/token_generator.go`).

## Online versus offline token flows

The online flow contacts the CA to discover provisioners and fetch encrypted
provisioner keys (`token_flow.go`). The offline flow uses a `ca.json`
configuration (from `step ca init`) plus flags (`--kid`, `--issuer`,
`--key`), or flags alone when no `ca.json` exists; priority is given to
existing `ca.json` (`OfflineTokenFlow`, `utils/cautils/token_flow.go`).

## Renewal and revocation

`--renew`/`--revoke` tokens set a distinct audience. Renewal tokens are X5C
signed against the existing certificate (`generateRenewToken`), enabling
renew-after-expiry. Revoke tokens may require a confirmation claim
(`command/ca/token.go`, `utils/cautils/token_generator.go`).
