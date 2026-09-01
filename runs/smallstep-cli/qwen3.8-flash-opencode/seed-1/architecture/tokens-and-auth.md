---
type: architecture
title: "Tokens, Claims, and Provisioner Authentication"
description: "How step builds and consumes CA provisioning JWTs: the token package claims and validity limits, token/provision OTTs, the online/offline token flows, audience mapping to CA endpoints, and x5c/sshpop/nebula header auth."
tags: [architecture, tokens, jwt, provisioner, x5c, sshpop, nebula]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:10:44.156Z
---

# Tokens, Claims, and Provisioner Authentication

`step` authenticates almost every CA operation with a short-lived JWT ("one-time
token" or OTT). Three layers participate:

1. `token/` — claim construction, signing, and parsing.
2. `token/provision/` — the OTT type exchanged for certificates.
3. `utils/cautils/token_flow.go` + `token_generator.go` — provisioner-aware
   orchestration shared by `step ca …` and `step ssh …` commands.

## The token package

`token.Claims` embeds `jose.Claims` plus `ExtraClaims` and `ExtraHeaders` maps
(token/token.go:49-56). `DefaultClaims()` sets issuer `step-cli`, audience
`https://ca/sign`, and a validity window of `DefaultValidity` = 5 minutes
starting now (token/token.go:12-23, 118-131). `Claims.Sign` builds a JWS with
type JWT, sets `kid` to the SHA-256 thumbprint of the signing key
(`GenerateKeyID`, token/token.go:42-52, 130+), forces a single-element `aud`
to a string, and serializes compactly.

Claim-name constants define the step token vocabulary (token/token.go:25-43):

- `sha` — SHA-256 of the expected root certificate (`WithRootCA` computes it
  from a PEM file, token/options.go:45-54),
- `sans` — required subject alternative names (`WithSANS`),
- `step` — custom CA data; `user` — user attributes inside it
  (`WithStep`, `WithUserData`, `WithSSH` set `step.ssh` for SSH sign options),
- `cnf` — proof-of-possession confirmation (`WithConfirmationFingerprint`,
  `WithFingerprint` from a CSR).

`WithValidity` is the guardrail on `--not-before`/`--not-after`
(token/options.go:148-170): validity must fall in [`MinValidity` 10s,
`MaxValidity` 1h] and the not-before delay may not exceed
`MaxValidityDelay` 30 minutes. There are 21 `With*` option constructors
including `WithX5CFile`/`WithX5CCerts` (validated `x5c` header),
`WithX5CInsecureCerts` (the non-standard `x5cInsecure` header),
`WithSSHPOPFile` (`sshpop` header), and `WithNebulaCert` (`nebula` header;
parses Nebula v1/v2 PEM banners and supports both curve types).

`token/provision.Token` (token/provision/provision.go:15-36) is the concrete
OTT: `New(subject, opts...)` wraps `token.NewClaims` with the subject and
implements `SignedString(sigAlg, priv)`. Its doc comment notes it differs from a
bootstrap token by not carrying network information.

`token/parse.go` is the reading side: `Parse`/`ParseInsecure` produce a
`JSONWebToken` whose `Payload` merges step claims (`sha`, `sans`) with OIDC,
Azure, K8sSA, GCP, and AWS claim shapes, and a `Type` discriminator
(JWK/X5C/OIDC/GCP/AWS/Azure/K8sSA/Nebula) (token/parse.go:13-60). The
`step crypto jwt inspect/verify` commands build on this.

## Online token flow

`cautils.NewTokenFlow` (utils/cautils/token_flow.go:101-183) is the entry used
by `step ca token|certificate|revoke|sign` and the ssh equivalents:

1. `parseAudience` (token_flow.go:39-76) turns `--ca-url` plus the token type
   into the audience URL — an HTTPS-only CA URL resolved against paths
   `/1.0/sign`, `/1.0/renew`, `/1.0/revoke`, `/1.0/ssh/sign`,
   `/1.0/ssh/renew`, `/1.0/ssh/revoke`, `/1.0/ssh/rekey`.
2. Renewals bypass provisioner selection entirely: `tokType == RenewType`
   returns `generateRenewToken` (token_flow.go:114-116), which requires
   `--x5c-cert`/`--x5c-key`, insists the subject equals the certificate CN, and
   signs claims with issuer `step-ca-client/1.0` and a base64 **`x5cInsecure`**
   header (token_generator.go:471-517) — renewal authenticates with the leaf
   certificate itself.
3. Provisioners are discovered by querying the live CA through
   `pki.GetProvisioners(caURL, root)` (external certificates/pki package;
   token_flow.go:118-121).
4. `provisionerPrompt` (token_flow.go:291-408) narrows candidates: the
   `--x5c-cert/--x5c-key`, `--sshpop-*`, `--nebula-*`, and
   `--k8ssa-token-path` flags force a single provisioner type; otherwise all
   known types list. It then filters by `--kid` (JWK keyID or OIDC clientID),
   `--admin-provisioner`, and `--provisioner/--issuer` name, and interactively
   selects when more than one remains (auto-selecting the sole candidate).
5. If no subject was given, the user is prompted for DNS names or an SSH
   principal — except for OIDC, where the CA derives principals from the email
   claim (token_flow.go:127-140).
6. A type switch dispatches token generation (token_flow.go:154-182):
   JWK → standard signed JWT; OIDC → shells out to `step oauth --oidc --bare`
   via `exec.Step` (which re-invokes `os.Args[0]` as a child process and
   captures stdout; token_generator.go:144-169, exec/exec.go:130-147);
   X5C/SSHPOP/Nebula → header-based tokens; K8sSA → read the service-account
   token file (default `/var/run/secrets/kubernetes.io/serviceaccount/token`,
   token_generator.go:183-193); AWS/GCP/Azure → the provisioner's own
   `GetIdentityToken` cloud identity document, setting
   `sharedContext.DisableCustomSANs`; ACME/SCEP → typed
   `ACMETokenError`/`SCEPTokenError` ("step ACME/SCEP provisioners do not
   support token auth flows"), which callers use to reroute to the ACME flow
   (token_flow.go:78-98, command/ca/certificate.go:259-264).

## How the standard JWT is built

`TokenGenerator` (utils/cautils/token_generator.go:35-94) holds kid/iss/aud/
root/validity/jwk. Every token gets a fresh random 256-bit `jti` (to identify
duplicated tokens), `WithKid/WithIssuer/WithAudience`, the root SHA claim when a
root file is known, and the validity window if either bound was set.
`SignToken` defaults `sans` to the subject, ties the token to a CSR via the
`cnf` fingerprint when a certificate request or confirmation fingerprint is in
the shared flow context, and merges custom user attributes
(token_generator.go:98-117). `SignSSHToken` embeds a `step.ssh` claim with
cert type, principals, and validity durations (token_generator.go:125-140).
Final signing is `provision.Token.SignedString(jwk.Algorithm, jwk.Key)`.

For JWK provisioners, `loadJWK` (token_generator.go:380-439) resolves the
signing key with a three-step rule: (1) an explicit `--key` file (possibly a
KMS URI through `cryptoutil.LoadJSONWebKey`, with kid from the provisioner, the
`--kid` flag, or the JWK thumbprint); (2) offline: the `encryptedKey` property
of the provisioner in `ca.json`; (3) online: `pki.GetProvisionerKey(caURL,
root, kid)` fetches the encrypted provisioner key from the CA. In cases (2)/(3)
the ciphertext is decrypted with `jose.Decrypt` using a password from
`--provisioner-password-file`/`--admin-password-file`/`--password-file` or an
interactive prompt ("Please enter the password to decrypt the provisioner
key"). The AES/JWE envelope format itself is implemented in the external
`go.step.sm/crypto/jose` package.

For X5C tokens the signer is a `jose.NewOpaqueSigner` around a KMS or PEM
signer (created via `cryptoutil.CreateSigner`), with the algorithm inferred
from the public key (ES256/384/512, default RSA, EdDSA —
token_generator.go:519-539), and the audience gains a `#<provisioner-token-id>`
suffix (`fmt.Sprintf("%s#%s", audience, p.GetIDForToken())`,
token_generator.go:235-237) so the CA can bind the token to one provisioner.

## Offline token flow

`OfflineTokenFlow` (token_flow.go:212-273) serves `step ca token --offline`.
If the `ca-config` file exists it defers to `OfflineCA.GenerateToken` (the
provisioner switch over `ca.json`, see
[CA client integration](/openwiki/architecture/ca-client-integration.md));
otherwise it builds tokens purely from flags, requiring `--provisioner/--issuer`
plus `--key`. Note the root fallback at token_flow.go:246-252 errors with a
"root required" message when the default root file *exists* rather than when it
is missing — an apparent inverted condition that stands in current source; the
repository contains no test pinning this branch.

## Invariants

- One-time tokens are self-consistent JWTs, not sessions; the CA enforces the
  audience path, `sha` root pinning, `sans` allow-list, and `cnf`
  proof-of-possession independently — those server-side checks are not part
  of this repository.
- `sharedContext` in cautils is a package-global flow context mutated through
  `Option`s (`WithSSHPublicKey`, `WithCertificateRequest`, …, see
  utils/cautils/certificate_flow.go:42-103); it exists to pass CSR/fingerprint
  data between the command and token layers within one process invocation.
