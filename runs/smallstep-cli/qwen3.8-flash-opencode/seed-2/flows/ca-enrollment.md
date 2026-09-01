---
type: flow
title: "CA Enrollment, Token, and Signing Flows"
description: "End-to-end flow by which step requests certificates from step-ca: provisioner discovery and selection, one-time-token generation per provisioner type, key/CSR construction, signing through the online client or in-process OfflineCA, and renew/revoke/rekey semantics."
tags: [ca, tokens, provisioners, signing, offline, renewal]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# CA Enrollment, Token, and Signing Flows

Requesting a certificate from a `step-ca` authority follows one pipeline used by `step ca certificate`, `step ca sign`, `step ca token`, and the SSH equivalents. The shared implementation lives in `utils/cautils/`; commands are thin flag-parsing wrappers.

## Pipeline shape

```
flags (ca-url/root/context) ──► client bootstrap ──► GET /provisioners
        │                                                   │
        │                       provisionerPrompt (filter+select)
        │                                                   │
        │        NewTokenFlow ──► per-type token generator ──┘
        │                     (one-time token, OTT)
        │                                   │
   key + CSR (CreateSignRequest) ──► POST /1.0/sign ──► PEM chain on disk
                          (online ca.Client or in-process OfflineCA)
```

## Step 1 — resolving the CA and its trust anchor

`CertificateFlow.GetClient` parses the `--token` without verification (`token.ParseInsecure`) and uses its claims to choose the trust model: a token carrying the `sha` root-hash claim plus an `http(s)` audience lets the client bootstrap with `ca.WithRootSHA256(sha)` and infer `ca-url` from the audience (trust-on-first-use, no local root needed); otherwise `--ca-url` and an on-disk `--root` (defaulting to `pki.GetRootCAPath()`) are required (`utils/cautils/certificate_flow.go:134-167`). `cautils.NewClient` applies the same `--root` fallback for flows without a token (`utils/cautils/client.go:50-74`), and https enforcement comes from `flags.ParseCaURL` (see [Configuration, STEPPATH, and Contexts](/openwiki/architecture/configuration-and-steppath.md)).

## Step 2 — provisioner discovery and selection

Online token generation fetches the live provisioner list with `pki.GetProvisioners(caURL, root)` (`utils/cautils/token_flow.go:120-124`). `provisionerPrompt` then (a) pre-narrows the candidate set when auth flags are present — `--x5c-cert/--x5c-key`, `--sshpop-cert/--sshpop-key`, `--nebula-*`, or `--k8ssa-token-path` restrict the list to that provisioner family, else all known types are offered; (b) applies `--kid` (matching JWK `KeyID` or OIDC `ClientID`), `--provisioner`/`--issuer`, and `--admin-provisioner` name filters, erroring when a filter empties the list; and (c) auto-selects when one remains or interactively prompts with per-type display metadata (`utils/cautils/token_flow.go:291-409`). Zero provisioners is a hard error (`utils/cautils/token_flow.go:320-323`).

## Step 3 — generating the one-time token

`NewTokenFlow` dispatches on the selected provisioner type (`utils/cautils/token_flow.go:160-185`):

| Provisioner | Token source |
|---|---|
| JWK | `generateJWKToken` — client-signed JWT (see below) |
| OIDC | execs `step oauth --oidc --bare` ([ACME and OAuth Flows](/openwiki/flows/acme-and-oauth.md)) |
| AWS/GCP/Azure | `p.GetIdentityToken(subject, caURL)` — the cloud identity token *is* the OTT |
| K8sSA | reads the cluster service-account token (`--k8ssa-token-path`) |
| X5C / SSHPOP / Nebula | JWT signed by the presented cert/key, with the credential embedded in the `x5c`/`sshpop`/`nebula` header |
| ACME / SCEP | no OTT exists: `ACMETokenError`/`SCEPTokenError` route the caller to those protocols |

For JWK provisioning, `loadJWK` supports two key sources: with `--key <file>` the signing key loads locally (KMS URIs via `cryptoutil.LoadJSONWebKey`), and without it the *provisioner's encrypted private key is fetched from the CA* (`pki.GetProvisionerKey`, or the `encryptedKey` field from `ca.json` in offline mode) and decrypted with a prompted password — this is the "trusted first-party" mode where the CA itself authorizes (`utils/cautils/token_generator.go:380-439`). The kid resolves from the provisioner, `--kid`, or the JWK thumbprint.

**Token shape.** `TokenGenerator.Token` assembles claims through `token/provision` (`provision.New` + `SignedString`): a random 256-bit hex `jti` for replay detection, `kid`, `iss` (provisioner name; default `step-cli`), audience derived from the endpoint — `https://<ca-url>/1.0/sign|/1.0/renew|/1.0/revoke|/1.0/ssh/...` per token type (`utils/cautils/token_flow.go:39-77`) — `sha` = SHA-256 of the root (`token.WithRootCA`), `sans` for sign tokens, optional `cnf` proof-of-possession fingerprint, optional `step.ssh` options for SSH types, and optional `user` custom attributes (`utils/cautils/token_generator.go:56-143`). Validity is clamped by the token package itself: default 5 minutes, minimum 10s, maximum 1h, and a `notBefore` delay capped at 30 minutes (`token/token.go:14-23`, `token/options.go:146-165`).

**Renewal is special.** `tokType == RenewType` bypasses provisioner selection entirely: `generateRenewToken` requires `--x5c-cert`/`--x5c-key`, sets `iss=step-ca-client/1.0`, `sub` = current cert CN (which must match a positional subject), and embeds the base64 certificate chain in the `x5c-insecure` JWT header (`utils/cautils/token_flow.go:113-116`, `utils/cautils/token_generator.go:471-517`).

## Step 4 — key and CSR construction

`CreateSignRequest` re-parses the OTT, generates a fresh keypair honoring `--kty/--curve/--size` (defaults EC P-256; RSA ≥ `keyutil.MinRSAKeyBytes*8` enforced in `utils.GetKeyDetailsFromCLI`), and builds the CSR subject/SANs with *per-token-type defaults*: AWS/GCP/Azure identity tokens synthesize provider-internal DNS names and private IPs when no SANs were requested, OIDC tokens map `sub`/`email` into CN/emails/URI fragments, K8sSA keeps the CLI subject (multi-use tokens), and JWK tokens use `token.sub` as CN; `sharedContext.DisableCustomSANs` (set by cloud provisioners) suppresses adding the user subject (`utils/cautils/certificate_flow.go:297-407`, `utils/cli.go:17-55`).

## Step 5 — signing, online or offline

`CertificateFlow.Sign` posts `api.SignRequest{CsrPEM, OTT, NotBefore, NotAfter, TemplateData}` (times/durations parsed via `flags.ParseTimeDuration`; template data from `--set/--set-file`) and writes the returned chain (leaf-first, falling back to `ServerPEM+CaPEM` when the chain is empty) to a 0600 file (`utils/cautils/certificate_flow.go:250-294`).

With `--offline`, `NewOfflineCA` loads `--ca-config` (default `$(step path)/config/ca.json`), injects `--password-file` into the config, builds a `certificates/authority.Authority` in-process, and *memoizes itself in a package singleton* because re-initializing backends like BadgerDB deadlocks (`utils/cautils/offline.go:36-80`, `flags/flags.go:289-296`). Every `CaClient` method is then answered locally: `Sign` = `authority.Authorize(OTT)` + `SignWithContext`; `Renew`/`Rekey`/`Revoke` extract the peer certificate by type-asserting the supplied `http.RoundTripper`'s TLS client config, or authorize an OTT for `RenewWithToken`/token-based revoke (`utils/cautils/offline.go:196-343`). Offline token generation mirrors `NewTokenFlow` but takes root/audience from `ca.json` and provisioners from the config (`utils/cautils/offline.go:539-601`).

## Renew, revoke, rekey, and admin auth

`step ca renew` wraps both modes: with `--token`/x5c it builds the `x5c-insecure` renew token and calls `RenewWithToken`, otherwise it constructs an mTLS transport from the cert/key pair and calls `Renew(tr)` (`command/ca/renew.go:482-486`, `command/ca/renew.go:621-653`; daemon scheduling is covered in [Renewal Automation and systemd Units](/openwiki/operations/renewal-and-systemd.md)). `step ca revoke` accepts a serial (parsed as big.Int with base prefixes) or derives serial + transport from `--cert/--key`, sending either an OTT or mTLS revoke request, with `--passive` supported offline and online (`command/ca/revoke.go:212-270`, `utils/cautils/offline.go:279-313`).

Admin API commands (`step ca provisioner`, `step ca policy`) use `ca.AdminClient`: credentials come from `--admin-cert/--admin-key`, or the CLI performs an interactive login — prompt subject, generate an OTT via the normal token flow, mint an ephemeral in-memory keypair + CSR, sign an admin certificate through `/1.0/sign`, and attach it via `ca.WithAdminX5C` (`utils/cautils/client.go:98-204`).

## See also

- [Change Guide: Support a New Provisioner Type](/openwiki/guides/adding-a-provisioner-type.md)
- [ACME and OAuth Flows](/openwiki/flows/acme-and-oauth.md)
- [SSH Certificate Workflows](/openwiki/flows/ssh-certificates.md)
