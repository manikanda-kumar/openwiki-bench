---
type: "Reference"
title: "Provisioner and One-Time Tokens"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
---

# Provisioner and One-Time Tokens

Commands that talk to a Step CA authenticate with short-lived one-time JWT tokens (OTTs). The CLI builds them in two layers: the `token` package (claim definitions, options, JWT signing/parsing) and `utils/cautils` (the interactive `TokenFlow` that picks a provisioner and per-provisioner `generate*` helpers). The token audience always encodes the CA endpoint it will be presented to, so a token is bound to both the CA URL and the operation (`/1.0/sign`, `/1.0/renew`, ...).

## The token package (token/)

### Constants and claims (token/token.go:11-40)

- `DefaultIssuer = "step-cli"`, `DefaultAudience = "https://ca/sign"` (token/token.go:13-15).
- Validity: `MinValidity = 10s`, `DefaultValidity = 5m`, `MaxValidity = 1h`, `MaxValidityDelay = 30m` (token/token.go:17-23).
- Step CA custom claim names: `sha` (root SHA-256), `sans` (required SANs), `step` (certificate custom info), `user` (user-provided custom info), `cnf` (confirmation / proof-of-possession) (token/token.go:26-40).

`Claims` (token/token.go:48-52) wraps `jose.Claims` with `ExtraClaims`/`ExtraHeaders` maps; `DefaultClaims` (token/token.go:118-130) seeds issuer, default audience, and a 5-minute validity from `time.Now()`; `Sign` (token/token.go:71-104) builds a JOSE signer with `kid` (via `GenerateKeyID`, the SHA-256 thumbprint of the public key, token/token.go:132-144) and compact-serializes the JWT, forcing `aud` to a string when there is a single audience.

### Options (token/options.go)

`Options` is a function `func(*Claims) error` (token/options.go:27-28). Key constructors:

- Identity/claims: `WithClaim` (31), `WithIssuer` (172), `WithSubject` (184), `WithAudience` (196), `WithJWTID` (208), `WithKid` (220, overrides the thumbprint kid).
- Step CA claims: `WithRootCA` (45, computes the `sha` claim from a root file), `WithSHA` (59), `WithSANS` (68), `WithStep` (76), `WithUserData` (85, merges into `user`), `WithSSH` (104, sets `step` with `provisioner.SignSSHOptions`), `WithConfirmationFingerprint` (112) and `WithFingerprint` (123, builds `cnf` from a CSR).
- Validity: `WithValidity` (148, validates boundaries against Min/MaxValidity).
- Headers: `WithX5CFile`/`WithX5CCerts` (231/247, sets the `x5c` header), `WithNebulaCert` (261, sets the nebula header), `WithX5CInsecureCerts` (319+, sets `x5cAllowInvalid` for self-signed chains).

### Parsing (token/parse.go)

- `Parse(token, key)` (token/parse.go:139-151) verifies the signature; `ParseInsecure(token)` (token/parse.go:154-166) reads claims without verification — the flow uses `ParseInsecure` because signature verification is the CA's job.
- `Payload` (token/parse.go:38-62) decodes standard JWT claims plus Step CA claims: `sha`/`sans` (JWK tokens), `at_hash`/`azp`/`email`/... (OIDC), Azure claims (`appid`, `tid`, `xms_mirid`, ...), Kubernetes service-account claims (`kubernetes.io/serviceaccount/*`), and embedded GCP/AWS/Azure identity payloads.
- `Payload.Type()` (token/parse.go:65-82) classifies tokens: GCP (`google` claim) → AWS (`amazon`) → Azure → K8sSA (issuer `kubernetes/serviceaccount`) → JWK (`sha` or `sans` present) → OIDC (aud/iss/sub/exp/iat set) → `Unknown`.
- `parseResponse` (token/parse.go:168-189) post-processes AWS documents (unmarshals the instance identity document) and Azure tokens (matches `xms_mirid` against `azureXMSMirIDRegExp` and checks known Azure issuer prefixes, token/parse.go:191-206).

### provision.Token (token/provision/provision.go:14-35)

`provision.Token` is the unsigned one-time token type used by the generators: `New(subject, opts...)` starts from `token.WithSubject` + defaults, and `SignedString(sigAlg, key)` compact-serializes it. Unlike a bootstrap token it does not self-contain networking information for reaching the CA.

## TokenFlow (utils/cautils/token_flow.go)

### Sign types and audiences

Eight token signing types (utils/cautils/token_flow.go:26-36): `SignType`, `RevokeType`, `SSHUserSignType`, `SSHHostSignType`, `SSHRevokeType`, `SSHRenewType`, `SSHRekeyType`, `RenewType`.

`parseAudience` (utils/cautils/token_flow.go:39-76) maps each type to an endpoint path under the CA URL (scheme forced to https): `/1.0/sign`, `/1.0/renew`, `/1.0/revoke`, `/1.0/ssh/sign` (both SSH sign types), `/1.0/ssh/revoke`, `/1.0/ssh/renew`, `/1.0/ssh/rekey`; other schemes are rejected.

### NewTokenFlow (utils/cautils/token_flow.go:101-183)

1. Applies flow options to the shared context.
2. Builds the audience; for `RenewType` it skips provisioner discovery entirely and calls `generateRenewToken` (an x5c-based renewal token).
3. Otherwise fetches provisioners with `pki.GetProvisioners(caURL, root)` (smallstep/certificates) and runs `provisionerPrompt`.
4. Prompts for the subject when empty — skipped for OIDC provisioners (the CA derives principals from the email), with a different prompt for `SSHUserSignType` ("What user principal would you like to use? (e.g. alice)").
5. Dispatches on the provisioner concrete type:
   - `JWK` → `generateJWKToken`
   - `OIDC` → `generateOIDCToken`
   - `X5C` → `generateX5CToken`
   - `Nebula` → `generateNebulaToken`
   - `SSHPOP` → `generateSSHPOPToken`
   - `K8sSA` → `generateK8sSAToken`
   - `GCP`/`AWS`/`Azure` → `p.GetIdentityToken(subject, caURL)` after copying the provisioner's `DisableCustomSANs` into the shared context
   - `ACME` → `&ACMETokenError{Name}` ("step ACME provisioners do not support token auth flows", utils/cautils/token_flow.go:78-87); `SCEP` → `&SCEPTokenError` (utils/cautils/token_flow.go:89-98)

`ACMETokenError` is consumed by `step ca certificate` to switch into the ACME flow with the provisioner name (command/ca/certificate.go:258-266).

### NewIdentityTokenFlow (utils/cautils/token_flow.go:187-205)

The bootstrap flow: lists only OIDC provisioners (filter on `provisioner.TypeOIDC`), prompts, and calls `generateOIDCToken`; any other type is an error.

### OfflineTokenFlow (utils/cautils/token_flow.go:212-273)

Used with `--offline`. If the `--ca-config` file exists it delegates to `OfflineCA.GenerateToken`; otherwise it requires `--provisioner`/`--issuer` plus `--key` (with optional `--kid`), derives the audience and root the same way, and generates an X5C token when `--x5c-cert`/`--x5c-key` is set, else a JWK token.

### provisionerPrompt (utils/cautils/token_flow.go:291-408)

- Flag-driven type filters: `--x5c-cert`/`--x5c-key` → only X5C; `--sshpop-cert`/`--sshpop-key` → only SSHPOP; `--nebula-cert`/`--nebula-key` → only Nebula; `--k8ssa-token-path` → only K8sSA; default lists JWK, OIDC, ACME, SCEP, K8sSA, X5C, SSHPOP, Nebula and cloud (GCP/AWS/Azure) provisioners.
- Extra filters: `--kid` matches `JWK.Key.KeyID` or `OIDC.ClientID`; `--admin-provisioner` and `--provisioner`/`--issuer` match by name. Each mismatch is an `errs.InvalidFlagValue`.
- Renders items per type (e.g. `name (type) [kid: ...]`, `[client: ...]`, `[tenant: ...]`); a single candidate is auto-selected and printed, otherwise `ui.Select` prompts "What provisioner key do you want to use?".

## Token generators (utils/cautils/token_generator.go)

`TokenGenerator` (utils/cautils/token_generator.go:35-53) holds `kid`, `iss`, `aud`, `root`, validity times, and the signing `jwk`:

- `Token(sub, opts...)` (utils/cautils/token_generator.go:56-94): random 256-bit `jti` to catch duplicates, `WithKid`/`WithIssuer`/`WithAudience`, `WithRootCA` when a root is set, optional `WithValidity`, then `provision.New` + `SignedString` with the JWK's algorithm.
- `SignToken` (utils/cautils/token_generator.go:98-117): adds `WithSANS` (subject as the only SAN when empty), ties the request to the CSR via `WithFingerprint` (from `sharedContext.CertificateRequest`) or `WithConfirmationFingerprint`, and merges `sharedContext.CustomAttributes` into `user`.
- `RevokeToken` (120-122) is plain; `SignSSHToken` (125-140) adds `WithSSH` with `CertType`, `KeyID` (subject), `Principals`, and `ValidAfter`/`ValidBefore`.

Per-provisioner generators:

- `generateJWKToken` (utils/cautils/token_generator.go:441-469) + `loadJWK` (380-439): the key comes from `--key` (loaded via `cryptoutil.LoadJSONWebKey`, KMS-aware) or from the CA — offline mode uses the provisioner's `encryptedKey` from ca.json, online mode fetches `pki.GetProvisionerKey(caURL, root, kid)`; the encrypted JWK is decrypted with a prompted password and unmarshaled. The issuer is the provisioner name. Dispatches by token type to `SignToken`/`RevokeToken`/`SignSSHToken` (user/host).
- `generateOIDCToken` (utils/cautils/token_generator.go:144-169): execs the CLI's own `step oauth --oidc --bare` with the provisioner's `ConfigurationEndpoint`, `ClientID`, `ClientSecret`, scopes/auth-params, optional `--console`, and `--listen` from `ListenAddress` (unless `STEP_LISTEN` is set), returning the token on stdout.
- `generateX5CToken` (utils/cautils/token_generator.go:195-273): requires `--x5c-cert`/`--x5c-key`, builds a KMS-aware signer (`cryptoutil.CreateSigner`), picks the JOSE algorithm with `getSigningAlgorithm` (ES256/384/512, RSA default, EdDSA; utils/cautils/token_generator.go:519-539), appends `--x5c-chain` certs, sets the `x5c` header (or `x5cAllowInvalid` with `--x5c-insecure`), and uses audience `<aud>#<provisioner ID>` via `p.GetIDForToken()`.
- `generateNebulaToken` (utils/cautils/token_generator.go:275-311): reads the nebula signing key with `jose.ReadKey` (ed25519 CA key), audience `<aud>#<provisioner ID>`, and sets the nebula header via `token.WithNebulaCert`.
- `generateSSHPOPToken` (utils/cautils/token_generator.go:313-345): only supports `SSHRevokeType`/`SSHRenewType`/`SSHRekeyType` with `--sshpop-cert`/`--sshpop-key`, attaching the SSH cert via `token.WithSSHPOPFile`.
- `generateK8sSAToken` (utils/cautils/token_generator.go:183-193): reads the service account token from `--k8ssa-token-path` (default `/var/run/secrets/kubernetes.io/serviceaccount/token`) and returns it as-is.
- `generateRenewToken` (utils/cautils/token_generator.go:471-517): requires `--x5c-cert`/`--x5c-key`, verifies the subject argument matches the leaf CN when given, builds claims with issuer `step-ca-client/1.0` and the target audience, sets the x5c chain in `ExtraHeaders[jose.X5cInsecureKey]`, and signs with the leaf key.

## Where audience/fingerprint derivation happens

- Audience: `parseAudience` (utils/cautils/token_flow.go:39-76) for token-flow tokens; per-provisioner generators append `#<provisioner ID>` for X5C/Nebula/SSHPOP. Bootstrap/provisioning tokens carry the root as the `sha` claim (`token.WithRootCA`, token/options.go:45) and `CertificateFlow.GetClient` uses that SHA to trust the CA (utils/cautils/certificate_flow.go:134-171).
- Fingerprinting: `token.WithFingerprint` (token/options.go:123) derives the `cnf` claim from a CSR in the shared flow context; `GenerateKeyID` (token/token.go:132-144) derives `kid` as a SHA-256 JWK thumbprint.
- Uncertainty: token *verification*, provisioner key retrieval (`pki.GetProvisioners`, `pki.GetProvisionerKey`), and identity-token validation live inside `smallstep/certificates` (and `go.step.sm/crypto/jose` for JOSE mechanics); this repository only constructs, parses, and presents tokens.
