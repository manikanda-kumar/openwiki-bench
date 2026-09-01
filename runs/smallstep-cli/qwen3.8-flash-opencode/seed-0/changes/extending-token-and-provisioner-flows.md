---
type: "Reference"
title: "Change Guide: Extending Token and Provisioner Flows"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-94215bbc8923986ec4e6eb4f
    resource: repo://token/options_test.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-eac4c6d87c1234945c50c143
    resource: repo://utils/cautils/offline_test.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-d65498dad1900ee9e4309461
    resource: repo://utils/cautils/token_flow_test.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---


# Change Guide: Extending Token and Provisioner Flows

Provisioning tokens (JWTs sent as `OTT` to the CA) are the core authentication
mechanism of `step ca`/`step ssh` commands. This guide maps the seams you must
touch to add a provisioner type, a new claim, or offline behavior.

## Prerequisite: the provisioner type must exist upstream

Provisioner Go types (`provisioner.JWK`, `provisioner.OIDC`, …), their
configurations, and their server-side verification semantics come from
`github.com/smallstep/certificates/authority/provisioner` (go.mod:19,
utils/cautils/token_flow.go:12). This repo only *selects* provisioners fetched
from the CA (`pki.GetProvisioners`) or loaded from `ca.json`, and builds
matching tokens. Adding a genuinely new provisioner type requires the
certificates dependency to support it first; the CLI change then follows.

## Seam 1: the dispatch switches (there are two)

`NewTokenFlow` (online) ends in a type switch over the selected provisioner,
calling a per-type generator and dispatching renew tokens early because "all
provisioners use the same type of tokens to do a X.509 renewal"
(utils/cautils/token_flow.go:101-183):

```go
switch p := p.(type) {
case *provisioner.JWK:  return generateJWKToken(...)
case *provisioner.OIDC: return generateOIDCToken(...)
case *provisioner.GCP:  // sharedContext.DisableCustomSANs = p.DisableCustomSANs
                        return p.GetIdentityToken(subject, caURL)
case *provisioner.ACME: return "", &ACMETokenError{p.GetName()}
...
}
```

`OfflineCA.GenerateToken` carries the parallel switch, sourcing root/audience
from `ca.json` instead of the live CA (utils/cautils/offline.go:539-599).
Cloud provisioners obtain their identity tokens by calling into the
provisioner library (`p.GetIdentityToken`), and OIDC works by re-invoking the
running binary: `generateOIDCToken` shells out to
`step oauth --oidc --bare --provider …` via `exec.Step`
(utils/cautils/token_generator.go:144-169). **Any new generator must be wired
into both switches**, or the feature silently breaks in one mode.

`provisionerPrompt` gates which provisioners appear for selection: explicit
credential flags narrow the list to one type (`x5c-*` → X5C, `sshpop-*` →
SSHPOP, `nebula-*` → Nebula, `k8ssa-token-path` → K8sSA), otherwise a type
allow-list applies; it then filters by `--kid`, `--admin-provisioner`, and
`--provisioner/--issuer` (via `flags.FirstStringOf`) and errors when the list
empties (utils/cautils/token_flow.go:291-359). A new type must be added to the
default allow-list or it can never be prompted for.

## Seam 2: per-type generators and signing keys

Generators live in `utils/cautils/token_generator.go` and share a pattern:
load a signing key, build a `TokenGenerator` with
`NewTokenGenerator(kid, iss, aud, root, notBefore, notAfter, jwk)`, then call
the type-specific method (`SignToken`, `RevokeToken`, `SignSSHToken`, or raw
`Token`) selected by `tokType` (`SignType`, `RevokeType`, `SSHUserSignType`,
…, defined at utils/cautils/token_flow.go:27-36).

Key-loading conventions:

- JWK tokens resolve the key through `loadJWK`: `--key` (optionally KMS-backed
  via `cryptoutil.LoadJSONWebKey` and the `--kms` URI) > offline
  `encryptedKey` from `ca.json` > online fetch from the CA with
  `pki.GetProvisionerKey` + password prompt (utils/cautils/token_generator.go:
  380-439).
- Header-auth types (X5C, Nebula, SSHPOP) require paired cert/key flags and
  return `errs.RequiredWithProvisionerTypeFlag` when missing; their audience
  gets the provisioner ID appended (`aud#provisioner-id`, e.g.
  utils/cautils/token_generator.go:235-237).
- Signing algorithm is inferred from the key via `getSigningAlgorithm`
  (ES256/384/512, RSA default, EdDSA) (utils/cautils/token_generator.go:519-539).
- Renew tokens bypass provisioners entirely: `generateRenewToken` requires
  `--x5c-cert/--x5c-key`, sets issuer `step-ca-client/1.0`, and puts the
  base64 cert chain into the `x5cInsecure` header (utils/cautils/token_generator.go:471-517).

## Seam 3: claims and headers via token.Options

`TokenGenerator.Token` composes fixed base options (random 256-bit `jti`,
`kid`, `iss`, `aud`, root SHA) plus validity, then delegates to
`provision.New(sub, opts...)` and `SignedString`
(utils/cautils/token_generator.go:56-94, token/provision/provision.go:24-31).
To add a claim:

1. Add a claim-name constant and `With…` option in `token/options.go`
   (existing ones: `sha`, `sans`, `step`, `user`, `cnf`, SSH block, x5c/nebula/
   sshpop header options — token/token.go:27-42, token/options.go:31-365).
2. Apply it from the generator or flow code.
3. Remember `Claims.Sign` forces a single-element `aud` to a JSON string and
   merges `ExtraClaims`/`ExtraHeaders`, with `kid` defaulted to the key's
   thumbprint (token/token.go:69-103, token/token.go:136-144).

Validity boundaries are enforced centrally by `WithValidity`: 10s–1h validity,
not-before at most 30 minutes in the future, and default 5 minutes from
`DefaultClaims` (token/token.go:11-25, token/options.go:148-169). Do not
bypass these in custom options.

## Seam 4: sharedContext (and its caveats)

A package-level `flowContext` singleton carries cross-command state:
`DisableCustomSANs`, `SSHPublicKey`, `CertificateRequest`,
`ConfirmationFingerprint`, `CustomAttributes` (utils/cautils/certificate_flow.go:42-51).
Options (`WithSSHPublicKey`, `WithCertificateRequest`, …) are applied by both
`NewCertificateFlow` and `NewTokenFlow`, then consumed:

- `DisableCustomSANs` is set from cloud provisioner config and suppresses
  adding the CLI subject to cloud-derived default SANs in
  `CreateSignRequest` (utils/cautils/certificate_flow.go:313-347,
  utils/cautils/token_flow.go:167-175).
- `CertificateRequest`/`ConfirmationFingerprint` bind tokens to a CSR via the
  `cnf` claim in `SignToken` (utils/cautils/token_generator.go:104-109).

Because it is a mutable global, extension code should treat it as
process-scoped state, not per-flow state.

## Audience paths

`parseAudience` maps `tokType` → CA endpoint path (`/1.0/sign`,
`/1.0/renew`, `/1.0/revoke`, `/1.0/ssh/sign`, `/1.0/ssh/revoke|renew|rekey`)
resolved against the https-normalized `--ca-url`
(utils/cautils/token_flow.go:39-76). A new token type needs an entry here,
plus the mirror mapping used offline via `OfflineCA.Audience`
(utils/cautils/offline.go:540-542).

## Tests to update

- `utils/cautils/token_flow_test.go` — `TestProvisionerPromptPrompts` covers
  the prompt/selection matrix (utils/cautils/token_flow_test.go:31).
- `utils/cautils/offline_test.go` — `TestOfflineCA_CaURL`,
  `TestOfflineCA_Audience` pin the offline audience mapping
  (utils/cautils/offline_test.go:9-132).
- `token/options_test.go` / `token/parse_test.go` — claim builder and
  parse/type-detection round-trips (token/options_test.go:26).
- New generators: build the token with a throwaway key and assert with
  `token.ParseInsecure` (the pattern used across cautils tests).
Run the focused subset first (`go test ./utils/cautils/ ./token/`), then
`make test` per [Testing and Validation](/openwiki/testing-and-validation.md).

## Gotchas

- Online JWK flows need the CA to serve the encrypted provisioner key
  (`pki.GetProvisionerKey`); if the provisioner is JWK but the CA has no key
  (e.g. ACME-only setups), expect a flow error rather than a fallback.
- ACME and SCEP intentionally have no token flow: returning
  `ACMETokenError`/`SCEPTokenError` is the contract for those selections
  (utils/cautils/token_flow.go:78-98, 176-179).
- K8sSA is multi-use and its token subject is not tied to the request, so
  `CreateSignRequest` deliberately keeps the CLI-provided subject for it
  (utils/cautils/certificate_flow.go:372-374).

## See also

- [CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)
- [Provisioning Tokens (token package)](/openwiki/core/token-package.md)
