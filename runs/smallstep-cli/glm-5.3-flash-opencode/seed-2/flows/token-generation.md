---
type: flow
title: Token Generation
description: How step builds and signs the JWT one-time tokens used to authenticate to step-ca — claim defaults, per-type audiences, provisioner selection, offline token generation, and the per-provisioner generators.
tags: [tokens, jwt, jose, provisioners, audiences]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# Token Generation

## The `token` package: claim building blocks

`token/token.go` defines the JWT skeleton every CA token starts from:
issuer `step-cli`, audience `https://ca/sign`, `iat`/`nbf` now, `exp` now +
5 minutes (`DefaultValidity`), with hard bounds of 10 seconds minimum and 1
hour maximum validity and a maximum 30-minute `nbf` delay
(`MaxValidityDelay`). Custom claim names are constants: `sha` (root
fingerprint), `sans`, `step` (custom certificate data), `user`, and `cnf`
(proof-of-possession fingerprint). Signing sets the `kid` header to the
JWK thumbprint of the signing key and forces a single-element `aud` to a
plain string.

`token/options.go` provides the option constructors used by all flows:
`WithRootCA` (embeds the SHA-256 of the root certificate in the `sha`
claim), `WithSANS`, `WithStep`/`WithSSH` (the `step` claim with an `ssh`
property for SSH tokens), `WithUserData` (merges into the `user` claim),
`WithConfirmationFingerprint` (`cnf` with `x5rt#S256`), `WithJWTID`, and
`WithValidity`.

## Audiences per token type

`parseAudience` derives the audience from `--ca-url` and the token type:

| Token type | Audience path |
| --- | --- |
| `SignType` | `/1.0/sign` |
| `RenewType` | `/1.0/renew` |
| `RevokeType` | `/1.0/revoke` |
| `SSHUserSignType`, `SSHHostSignType` | `/1.0/ssh/sign` |
| `SSHRevokeType` | `/1.0/ssh/revoke` |
| `SSHRenewType` | `/1.0/ssh/renew` |
| `SSHRekeyType` | `/1.0/ssh/rekey` |

The scheme must be `https` (or empty, which is normalized). Unknown token
types are an error.

## The shared `NewTokenFlow`

`NewTokenFlow(ctx, tokType, subject, sans, caURL, root, ...)` is the common
path for online CA commands:

1. Compute the audience from the CA URL and token type; `RenewType` short-
   circuits to `generateRenewToken` (an x5cInsecure JWT signed with the
   `--x5c-cert`/`--x5c-key` pair, issuer `step-ca-client/1.0`, subject forced
   to match the certificate CN).
2. Fetch the CA's provisioner list (`pki.GetProvisioners(caURL, root)`).
3. Select a provisioner via `provisionerPrompt`: the candidate list is
   filtered by the flags in play (`x5c-cert/x5c-key` → X5C only,
   `sshpop-cert/sshpop-key` → SSHPOP, `nebula-*` → Nebula,
   `k8ssa-token-path` → K8sSA), then by `--kid`, `--admin-provisioner`, and
   `--provisioner`/`--issuer`; a single candidate is auto-selected, multiple
   candidates render an interactive picker.
4. If the subject is empty, prompt for it — except for OIDC provisioners,
   where the CA derives principals from the email (or, for SSH user tokens,
   ask for a user principal).
5. Dispatch to the provisioner-specific generator.

ACME and SCEP provisioners deliberately reject the token flow
(`ACMETokenError`/`SCEPTokenError`).

## Per-provisioner generators (`utils/cautils/token_generator.go`)

- **JWK**: loads the provisioner's encrypted JWK from the CA (decrypting
  with `--provisioner-password-file` or an interactive prompt) or reads the
  key file given with `--key`; `kid` comes from the provisioner, `--kid`, or
  the JWK thumbprint. `TokenGenerator` assembles claims (random 256-bit
  `jti`, `kid`, issuer = provisioner name, audience, `sha` root fingerprint,
  optional validity window) and signs with the JWK's algorithm.
  `SignToken` defaults SANs to the subject and ties the token to a CSR
  fingerprint (`cnf`) when one was captured; `SignSSHToken` wraps
  `provisioner.SignSSHOptions` (cert type, key id, principals, validity)
  into the `step.ssh` claim.
- **X5C**: signs with the `--x5c-key` (optionally via `--kms`), embedding the
  `--x5c-cert` chain plus `--x5c-chain` extras in the `x5c` (or
  `x5cInsecure` with `--x5c-insecure`) header; audience is
  `<audience>#<provisioner-id>`.
- **Nebula**: reads the nebula key JWK and embeds the nebula certificate.
- **SSHPOP**: signs with an existing SSH certificate/key pair.
- **K8sSA**: reads the pod's service-account token file (path override via
  `--k8ssa-token-path`).
- **GCP/AWS/Azure**: delegate to the provisioner library's
  `GetIdentityToken` (cloud metadata flows) and surface
  `DisableCustomSANs` to the caller.
- **OIDC**: shells out to `step oauth --oidc --bare` with the provisioner
  configuration (see [OAuth and Single Sign-On](/openwiki/flows/oauth-and-sso.md)).

Signing algorithms are derived from the key type: ES256/384/512 by curve,
`DefaultRSASigAlgorithm` for RSA, EdDSA for Ed25519.

## Offline token generation

`OfflineTokenFlow` serves `--offline` mode with two mutually exclusive
sources, prioritized: when `--ca-config` points at an existing CA
configuration (from `step ca init`), the offline CA generates the token from
the provisioners configured in that file; otherwise the caller must supply
`--provisioner`/`--issuer` and `--key` (plus `--ca-url`/`--root`), and the
token is generated directly from the given key (JWK flow, or X5C when
`--x5c-cert`/`--x5c-key` are set).
