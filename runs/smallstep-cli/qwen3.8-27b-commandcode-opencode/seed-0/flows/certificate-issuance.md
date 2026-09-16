---
type: flows
title: "Certificate Issuance Flow (Token + Sign)"
description: "End-to-end online issuance: step ca token (provisioner discovery, per-provisioner token generation, audiences), step ca certificate (CSR creation, per-token-type SAN handling, subject validation, sign, file writes), and the ACME and offline branch points."
tags: [certificate, token, provisioner, csr, acme, offline, sans]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-976947cfd6258da1cc5693a8
    resource: repo://utils/cautils/acme_flow.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

## End-to-end path of `step ca certificate`

`step ca certificate <subject> <crt-file> <key-file>` (2 arguments are allowed only with `--attestation-uri`), `command/ca/certificate.go:220-307`:

1. **Validation**: `--offline` and `--token` are incompatible (the token is generated *before* the offline CA starts); `--attestation-uri` and `--kms` are incompatible (ACME-DA params live in the URI).
2. **Flow setup**: `cautils.NewCertificateFlow(ctx)` builds an `OfflineCA` when `--offline` (which requires `--ca-config`); otherwise the flow is online (`utils/cautils/certificate_flow.go:106-131`).
3. **Token acquisition** (`command/ca/certificate.go:256-268`):
   - `--token` present → use it verbatim.
   - `--acme <directory-url>` present → `cautils.ACMECreateCertFlow(ctx, "")` — the ACME branch bypasses tokens entirely (works with any ACME server, e.g. Let's Encrypt).
   - Otherwise `flow.GenerateToken(...)` runs the token flow below. If the selected provisioner is ACME, `ACMETokenError` is returned and the action re-routes to `ACMECreateCertFlow(ctx, provisionerName)` against the step CA's ACME endpoint. SCEP provisioners have no such branch — they error with `SCEPTokenError`.
4. **CSR construction**: `flow.CreateSignRequest(ctx, tok, subject, sans)` (below).
5. **Subject validation by token type** (`command/ca/certificate.go:280-293`): for JWK tokens, `--token` and `--san` are mutually exclusive and the positional subject must case-insensitively match the CSR common name; for OIDC/AWS/GCP/Azure/K8sSA tokens the CN is deliberately left to server-side validation; any other token type is rejected as unsupported.
6. **Sign and write**: `flow.Sign` posts `api.SignRequest{CsrPEM, OTT, NotBefore, NotAfter, TemplateData}` to the CA and writes the PEM-serialized chain to `<crt-file>` at **0600**; the freshly generated private key goes to `<key-file>` at **0600** (`utils/cautils/certificate_flow.go:249-293`, `command/ca/certificate.go:295-302`).

## `step ca token` — provisioner discovery and generation

The command takes one positional argument (the subject) and flags that select the token kind (`command/ca/token.go:303-346`): `--revoke` → `RevokeType`, `--renew` → `RenewType`, and under `--ssh` the matrix is `--rekey`→`SSHRekeyType`, `--renew`→`SSHRenewType`, `--revoke`→`SSHRevokeType`, `--host`→`SSHHostSignType`, default `SSHUserSignType` (principals become the SAN list). `--host` and `--principal` require `--ssh`; `--san` is incompatible with SSH tokens; `--cnf-file`/`--cnf` are mutually exclusive and feed a proof-of-possession `cnf` claim (CSR fingerprint or confirmation fingerprint via `WithCertificateRequest`/`WithSSHPublicKey`).

**Audience** is derived from `--ca-url` per token type (`utils/cautils/token_flow.go:38-76`): `/1.0/sign`, `/1.0/renew`, `/1.0/revoke`, `/1.0/ssh/sign`, `/1.0/ssh/revoke`, `/1.0/ssh/renew`, `/1.0/ssh/rekey` (scheme forced to https).

**Provisioner discovery** (`utils/cautils/token_flow.go:100-183,291-408`): `pki.GetProvisioners(caURL, root)` fetches the server's provisioner list (over the TLS connection pinned to the root); candidates are filtered by the matching flags (`--x5c-cert`/`--x5c-key`, `--sshpop-*`, `--nebula-*`, `--k8ssa-token-path`), then by `--kid` (JWK `Key.KeyID` / OIDC `ClientID`), `--admin-provisioner`, and `--provisioner`/`--issuer`. A single survivor is auto-selected; otherwise an interactive `ui.Select` prompt lists names like `name (type) [kid: ...]`. Renew tokens skip discovery entirely — all provisioners renew the same way.

**Per-provisioner token generation** (`utils/cautils/token_flow.go:154-182`, `utils/cautils/token_generator.go`):

| Provisioner | How the token is produced |
|---|---|
| **JWK** | `loadJWK` (`token_generator.go:373-439`): with `--key`, the JWK loads KMS-aware via `cryptoutil.LoadJSONWebKey` (password from `--provisioner-password-file`/`--admin-password-file`/`--password-file`); without `--key`, the *encrypted* provisioning key is fetched from the CA (`pki.GetProvisionerKey`) or from the offline provisioner's `encryptedKey` property, decrypted with a password prompt, and the kid is the provisioner key ID, `--kid`, or the JWK thumbprint fallback. |
| **OIDC** | Runs `step oauth --oidc --bare --provider <configEndpoint> --client-id ... --client-secret ...` as a **subprocess** (`exec.Step`), adding scopes, auth-params, `--console` if set, and `--listen <listenAddress>` when `STEP_LISTEN` is unset; the token comes back on stdout (`token_generator.go:142-169`). |
| **X5C** | Requires `--x5c-cert`/`--x5c-key`; signer via `cryptoutil.CreateSigner` (KMS-aware, YubiKey URIs supported); kid = the cert file path; `x5c` header built from the cert plus `--x5c-chain` (with `--x5c-insecure` to allow insecure certs). Algorithm is ECDSA P-256/P-384/P-521→ES256/384/512, RSA→`jose.DefaultRSASigAlgorithm`, Ed25519→EdDSA (`token_generator.go:195-273,519-539`). |
| **Nebula** | Requires `--nebula-cert`/`--nebula-key`; key via `jose.ReadKey`, cert embedded as the `nebula` header (`token_generator.go:275-311`). |
| **SSHPOP** | Requires `--sshpop-cert`/`--sshpop-key`; supports only SSH renew/revoke/rekey token types — an SSH *sign* request errors with `unexpected requested token type for SSHPOP` (`token_generator.go:313-345`). |
| **K8sSA** | Reads the service-account token file (`--k8ssa-token-path`, default `/var/run/secrets/kubernetes.io/serviceaccount/token`) and returns it unchanged (`token_generator.go:183-193`). |
| **GCP / AWS / Azure** | `p.GetIdentityToken(subject, caURL)` — instance-identity token obtained from the cloud's metadata service; the provisioner's `DisableCustomSANs` setting is propagated into the shared flow context (`token_flow.go:167-175`). |
| **ACME / SCEP** | Return `&ACMETokenError`/`&SCEPTokenError` (`"step ACME provisioners do not support token auth flows"` / SCEP equivalent) (`token_flow.go:78-98,176-179`). |

**Token construction** (`token_generator.go:55-140`): a random 256-bit `jti` identifies duplicates; kid/iss/aud come from the provisioner; the root is embedded as the `sha` claim when known; validity is set only when `--not-before`/`--not-after` (or durations) are given, defaulting to now→now+5m (`token.DefaultValidity`). Claim names are `sha`, `sans`, `step` (custom template data), `user` (custom attributes), `cnf` (confirmation) (`token/token.go:22-37`); validity bounds are 10s min / 1h max / 30m clock-skew tolerance (`token/token.go:9-20`). `SignToken` sets the `sans` claim (falling back to the subject) and the `cnf` fingerprint; `SignSSHToken` embeds `certType`, `keyID`, principals, and validity durations.

**Renew tokens** (`token_generator.go:471-517`): require `--x5c-cert`/`--x5c-key`; the positional subject must equal the certificate CN; issuer is `step-ca-client/1.0`; the whole chain goes into the `x5c` header (base64 DER) and the token is signed with the leaf key.

## Where the SANs come from (CreateSignRequest)

`CreateSignRequest` (`utils/cautils/certificate_flow.go:295-405`) generates the private key from `--kty/--curve/--size` (default ECDSA P-256), unifies `--san` values with the token's `sans` claim through `splitSANs` (dedupe + split into DNS/IP/email/URI via `x509util.SplitSANs`, `certificate_flow.go:407-421`), then applies per-token-type rules:

- **AWS**: with no SANs, defaults to the instance private IP plus `ip-<x.x.x.x>.<region>.compute.internal`, plus the subject unless `DisableCustomSANs` (`certificate_flow.go:314-325`).
- **GCP**: with no SANs, defaults to `<instance>.c.<project>.internal` and `<instance>.<zone>.c.<project>.internal`, plus the subject unless disabled (`certificate_flow.go:326-337`).
- **Azure**: with no SANs, defaults to the Azure `resourceName` claim, plus the subject unless disabled (`certificate_flow.go:338-347`).
- **OIDC**: if no `--san` and no token `sans` — when the subject equals the email (case-insensitive), CN becomes the token subject and the SANs are the email plus an `iss#sub` URI; otherwise the subject is split into SANs. With `--san`, CN=subject and SANs come from the flag (`certificate_flow.go:348-371`).
- **K8sSA**: the CLI subject is used as-is — K8sSA tokens are multi-use, so the token subject is intentionally ignored (`certificate_flow.go:372-375`).
- **Default (JWK/X5C/Nebula/SSHPOP)**: the token subject becomes the CN, and SANs are the unified flag+token list (`certificate_flow.go:376-378`).

The CSR carries only a CN in its subject; it is signed with the new key and re-verified locally (`CheckSignature`) before the sign request is returned.

## ACME branch

`cautils.ACMECreateCertFlow(ctx, provisionerName)` (`utils/cautils/acme_flow.go:15-37`) builds an ACME flow from the subject + `--san` list (standalone or webroot challenge serving, controlled by the `--acme*` flags), retrieves the certificate, writes it 0600, and writes the private key 0600 — except when `--attestation-uri` is used, where the key never leaves the attestation store and only its URI is printed. `ACMESignCSRFlow` does the same with an existing CSR. The help text notes Let's Encrypt requires the CN itself to be a validated ACME identifier, which the step CA does not require.

## Offline branch point

With `--offline`, every step above runs against the local `OfflineCA` instead of the CA API: `GetClient` returns the offline CA directly, `GenerateToken` calls `offlineCA.GenerateToken` (provisioner from `ca.json`, see `OfflineTokenFlow`, `token_flow.go:207-273`), and `Sign` signs locally. CSR creation, SAN rules, and subject validation are shared between the two paths. See the offline CA page for the `ca.json` mechanics.

## Token type detection

`token.ParseInsecure` (used client-side; the CA verifies signatures) parses payloads into `token.Payload`, and `Payload.Type()` classifies by precedence: `google` claim → GCP; `amazon` claim → AWS; Azure issuer prefixes (`sts.windows.net`, `login.microsoftonline[.us]`, ...) → Azure; issuer `kubernetes/serviceaccount` → K8sSA; `sha` or `sans` claim → JWK (X5C/Nebula tokens carry these too); otherwise aud+iss+sub+exp+iat → OIDC (`token/parse.go:60-85,153-205`). Azure `xms_mirid` values are decomposed into subscription/resource-group/resource via a case-insensitive regex (`token/parse.go:131-185`).
