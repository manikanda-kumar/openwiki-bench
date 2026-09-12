---
type: concept
title: Provisioning Token and JWT Claims System
description: The token package's default JWT claims and validity bounds, signing, per-token-type detection (JWK/OIDC/AWS/GCP/Azure/K8sSA/Nebula), the sha/sans/cnf/x5c claims and headers, and how the token flow commands build these authorization tokens.
tags: [tokens, jwt, claims, provisioner, jose]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
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
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---

# Provisioning Token and JWT Claims System

`step` authorizes certificate, renewal, revoke, and SSH operations against a CA
using single-use JWT provisioning tokens. The `token` package defines the claim
types, defaults, and product semantics; the token flow code in `utils/cautils`
chooses a provisioner and builds the concrete token.

## Defaults and validity bounds

`token/token.go` defines:
- `DefaultIssuer = "step-cli"`, `DefaultAudience = "https://ca/sign"`,
  `DefaultValidity = 5 * time.Minute`, `MinValidity = 10s`, `MaxValidity = 1h`,
  and `MaxValidityDelay = 30m`.

`DefaultClaims` sets `iss`, `aud`, `exp`, `nbf`, and `iat` from the current UTC
time. `WithValidity` (`token/options.go`) validates that the requested
`nbf`/`exp` are within these bounds: it rejects `exp < nbf`, an `nbf` more than
30 minutes in the future, and token validity shorter than 10s or longer than 1h.

`Claims.Sign` (`token/token.go`) builds a `kid` via `GenerateKeyID` (a SHA-256
thumbprint of the public key, or of an opaque signer's public key), adds the
"JWT" type, forces `aud` to a string when there's a single audience, and
compact-serializes the JWT.

## Claims and headers

The `Claims` type embeds `jose.Claims` and adds `ExtraClaims`/`ExtraHeaders`.
The `With...` options in `token/options.go` set:
- `WithRootCA(path)`/`WithSHA` set the `sha` claim to the SHA-256 of a root cert.
- `WithSANS` sets the `sans` claim (SANs allowed for this token).
- `WithStep`/`WithSSH` set the `step` claim (nested `ssh` for SSH options).
- `WithUserData` merges into the `user` claim.
- `WithConfirmationFingerprint`/`WithFingerprint` set the `cnf` claim
  (`x5rt#S256` fingerprint of a CSR or SSH public key) — proof of possession.
- `WithX5CCerts`/`WithX5CFile` put the validated certificate chain into the `x5c`
  header; `WithX5CInsecureCerts`/`WithX5CInsecureFile` use the `x5cInsecure`
  header.
- `WithNebulaCert` validates a Nebula certificate/key and sets the `nebula`
  header; `WithSSHPOPFile` validates an SSH cert/key and sets the `sshpop` header.

## Token type detection

`token/parse.go` defines the `Type` enum (JWK, X5C, OIDC, GCP, AWS, Azure, K8sSA,
Nebula, Unknown) and `Payload.Type()`, which infers the type from the payload:
GCP (a `google` claim), AWS (an `amazon` claim), Azure (issuer matching an Azure
login prefix), K8sSA (`issuer == "kubernetes/serviceaccount"`), JWK (a `sha` or
`sans` claim), and OIDC (issuer+subject+audience+exp+iat present). `Parse` verifies
the signature with the given key; `ParseInsecure` reads the payload without
verification. For AWS tokens, the embedded instance identity document is decoded
into `AWSInstanceIdentityDocument`; for Azure, `xms_mirid` is regex-parsed into
`AzurePayload` fields.

## The token flow

`NewTokenFlow` (`utils/cautils/token_flow.go`) is the shared entrypoint that
generates a token for a given operation type (`SignType`, `RenewType`,
`RevokeType`, `SSHUserSignType`, `SSHHostSignType`, `SSHRevokeType`,
`SSHRenewType`, `SSHRekeyType`). It:
1. Derives the JWT audience from `--ca-url` (`parseAudience`), using paths like
   `/1.0/sign`, `/1.0/renew`, `/1.0/revoke`, `/1.0/ssh/sign`, etc.
2. For X.509 renewal, delegates to `generateRenewToken` (which builds an
   `x5c`-header renewal token from the presented certificate/key).
3. Fetches the CA's provisioners (`pki.GetProvisioners`) and filters them with
   `provisionerPrompt` (by type, `--kid`, `--provisioner`/`--issuer`,
   `--admin-provisioner`).
4. Dispatches on the provisioner type to build the matching token.

`provisionerPrompt` filters out provisioner types that cannot issue tokens;
certain combinations narrow the list (X5C flags -> only X5C provisioners,
SSHPOP flags, Nebula flags, `--k8ssa-token-path`).

## Per-provisioner token generation

`token_generator.go` implements the concrete generators:
- **JWK**: `generateJWKToken` loads the signing key with `loadJWK` (from
  `--key`, the provisioner's encrypted key in offline mode, or fetched from the
  CA via `pki.GetProvisionerKey`), then builds `SignToken`/`RevokeToken`/
  `SignSSHToken` via a `TokenGenerator`. `SignToken` defaults SANs to the subject,
  and ties the certificate request to the token when `sharedContext.CertificateRequest`
  is set (via `WithFingerprint`) or a confirmation fingerprint exists.Skip
- **OIDC**: `generateOIDCToken` execs `step oauth --oidc --bare` with the
  provider metadata, client ID/secret, scopes, and auth params, reusing the same
  binary.
- **X5C**: `generateX5CToken` requires `--x5c-cert` and `--x5c-key`, builds an
  opaque signer (optionally through a KMS), validates the chain and key, and
  issues a token with the `x5c` header.
- **SSHPOP**: `generateSSHPOPToken` requires `--sshpop-cert`/`--sshpop-key` and
  emits renew/revoke/rekey tokens with the `sshpop` header.
- **Nebula**: `generateNebulaToken` requires `--nebula-cert`/`--nebula-key` and
  emits the `nebula` header.
- **K8sSA**: `generateK8sSAToken` reads the Kubernetes service account token from
  `--k8ssa-token-path` (default
  `/var/run/secrets/kubernetes.io/serviceaccount/token`).
- **AWS/GCP/Azure**: `GetIdentityToken` (from the `step-ca` provisioner types)
  obtains provider identity tokens, respecting `DisableCustomSANs`.

### TokenGenerator

`TokenGenerator` (with kid, iss, aud, root, notBefore/notAfter, and a JWK) is the
common helper. `Token` adds a random JWT ID (`randutil.Hex(64)`), the kid/iss/aud,
optional root SHA, validity, and signs with the JWK. `SignToken` appends SANs and
the CSR fingerprint confirmation; `SignSSHToken` wraps the SSH options in the
`step.ssh` claim.

### Offline invocation

The offline CA's `GenerateToken` (`utils/cautils/offline.go`) mirrors this
dispatch using the `ca.json` root and audience, with the same per-type sentinels
for unsupported types (`ACMETokenError`, `SCPETokenError`).

## Renewal tokens

`generateRenewToken` (`token_generator.go`) is shared: it requires
`--x5c-cert`/`--x5c-key`, verifies the subject matches the cert common name, and
signs a token with issuer `step-ca-client/1.0` and the `x5cInsecure` header
containing the certificate chain. The renew flow in `command/ca/renew.go` uses
the equivalent inline logic when `--mtls=false` or the certificate is expired.
