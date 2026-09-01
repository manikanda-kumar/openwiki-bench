---
type: "Reference"
title: "CA Integration: Online and Offline Flows"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
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
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---


# CA Integration: Online and Offline Flows

`utils/cautils` is the business-logic layer between command implementations
and a certificate authority. Every `step ca` and most `step ssh`/`step
certificate` flows route through it. It exposes one interface for CA
operations with two implementations selected by the `--offline` flag: an HTTP
client to a running `step-ca` server, and an in-process authority loaded from
`ca.json`.

## CaClient interface

`CaClient` (utils/cautils/client.go:29-48) unifies the operations the CLI
needs: `Sign`, `Renew`, `RenewWithToken`, `Revoke`, `Rekey`, the SSH variants
(`SSHSign`, `SSHRenew`, `SSHRekey`, `SSHRevoke`, `SSHRoots`, `SSHFederation`,
`SSHConfig`, `SSHCheckHost`, `SSHGetHosts`, `SSHBastion`), `Version`,
`GetRootCAs`, and `GetCaURL`. Two implementations satisfy it:

1. `ca.NewClient(caURL, opts…)` from `smallstep/certificates/ca` (online).
2. `*OfflineCA`, whose methods are thin wrappers over `authority.Authority`
   calls (utils/cautils/offline.go:183-536).

### Construction rules (`NewClient`)

`NewClient` (utils/cautils/client.go:52-74):

- `--offline`: requires a non-empty `--ca-config`, otherwise
  `errs.InvalidFlagValue`; builds `OfflineCA`.
- Online: `ca-url` goes through `flags.ParseCaURL` (https-only enforcement);
  `--root` falls back to `pki.GetRootCAPath()` (the STEPPATH root cert) and
  **errors with `errs.RequiredFlag("root")` if that file does not exist**.

### OfflineCA specifics

`NewOfflineCA` memoizes a package-level singleton (`offlineInstance`) to avoid
double-initializing locked resources such as BadgerDB; it parses the config
into `certificates/authority/config`, requires at least one provisioner in
`AuthorityConfig`, and applies `--password-file` to the config password
(utils/cautils/offline.go:28-81). Its derived values come from the config
rather than the network: `CaURL()` is `https://` + the first DNS name, and
`Audience(tokType)` maps token types to paths **without the `/1.0/` prefix**
used by the online flow — e.g. `https://<host>/sign`, `/ssh/sign`, `/renew`
(utils/cautils/offline.go:140-163). `GetRootCAs()` always returns nil.
Signing methods authorize the OTT through `authority.Authorize` with a
method-scoped context (`provisioner.SignMethod`, `RevokeMethod`,
`SSHSignMethod`, …), so offline token validation uses the exact server-side
rules (utils/cautils/offline.go:196-222). `Renew`/`Rekey` extract the leaf
certificate from the mTLS `http.Transport` client config rather than a token
(utils/cautils/offline.go:226-341).

## Admin clients

`NewAdminClient` (utils/cautils/client.go:99-204) builds a
`ca.AdminClient` for the CA management API (provisioners, admins, ACME EAB):

- If `--admin-cert`/`--admin-key` are supplied (both required together), they
  authenticate the client via x5c.
- Otherwise it performs an interactive login: prompts for an admin subject,
  runs `NewTokenFlow(ctx, SignType, …)`, generates a throwaway key
  (`keyutil.GenerateDefaultKey`), creates and self-verifies a CSR with
  DNS/IP/email/URI SANs split from the subject, signs it with a bootstrap CA
  client, and passes the resulting chain + key to
  `ca.WithAdminX5C(...)` in memory — nothing is written to disk at this step.
- `caURL` resolution differs here: `flags.ParseCaURLIfExists` plus an explicit
  `errs.RequiredFlag("ca-url")` when empty.

`NewUnauthenticatedAdminClient` is the same minus credentials
(utils/cautils/client.go:77-96).

## CertificateFlow

`CertificateFlow` (utils/cautils/certificate_flow.go:36-131) decides
online/offline at construction from `--offline`/`--ca-config` and provides:

- `GetClient` (certificate_flow.go:134-171): parses the supplied `--token`
  **insecurely** (`token.ParseInsecure`) only to shape the client: if the JWT
  carries a `sha` claim and an http(s) audience, the CA URL is taken from the
  token and the root is pinned via `ca.WithRootSHA256`; otherwise the usual
  `--ca-url`/`--root` rules apply.
- `GenerateToken` / `GenerateSSHToken` / `GenerateIdentityToken`: offline
  short-circuit to `OfflineCA.GenerateToken`; online path requires `ca-url`
  and root unless a `--token` is provided (`errs.RequiredUnlessFlag`), then
  delegates to `NewTokenFlow`.
- `Sign` (certificate_flow.go:250-293): builds `api.SignRequest` with
  `--not-before`/`--not-after` (via `flags.ParseTimeDuration`) and
  `--set`/`--set-file` template data, calls `client.Sign`, then writes the
  full chain to the cert file with `fileutil.WriteFile(..., 0o600)`; empty
  `CertChainPEM` responses fall back to `[ServerPEM, CaPEM]`.
- `CreateSignRequest` (certificate_flow.go:297-405): for token-authenticated
  flows without an explicit CSR, generates a key (`--kty/--crv/--size` via
  `utils.GetKeyDetailsFromCLI`) and builds the CSR, deriving default SANs per
  token type: AWS private-IP + `ip-<dashed>.<region>.compute.internal`, GCP
  `<instance>.c.<project>.internal` variants, Azure resource name, OIDC
  email/URI special-casing, K8sSA keeping the CLI subject, and all others
  using the token subject. Cloud-derived defaults drop the CLI subject when
  `sharedContext.DisableCustomSANs` is set. SANs from all sources are merged,
  deduplicated, and split by `x509util.SplitSANs`
  (certificate_flow.go:407-421).

## TokenFlow and provisioner selection

`NewTokenFlow` (utils/cautils/token_flow.go:101-183) is the online token
factory:

1. `parseAudience` maps the token type constant (`SignType`, `RevokeType`,
   `RenewType`, `SSHUserSignType`, `SSHHostSignType`, `SSHRevokeType`,
   `SSHRenewType`, `SSHRekeyType`, token_flow.go:27-36) to an endpoint path
   under the https ca-url (`/1.0/sign`, `/1.0/ssh/sign`, …)
   (token_flow.go:39-76).
2. `RenewType` never consults provisioners: `generateRenewToken` builds an
   x5cInsecure renewal JWT from `--x5c-cert/--x5c-key` (token_flow.go:114-116,
   token_generator.go:471-517).
3. Provisioners are fetched with `pki.GetProvisioners(caURL, root)` and
   narrowed/prompted by `provisionerPrompt` (token_flow.go:118-125, 291-408):
   credential flags force a single type; `--kid` matches JWK key IDs and OIDC
   client IDs; `--provisioner`/`--issuer` and `--admin-provisioner` match by
   name; a single match auto-selects (printed via `ui.PrintSelected`),
   otherwise `ui.Select` prompts.
4. The type switch dispatches to generators in `token_generator.go`; GCP/AWS/
   Azure fetch identity tokens through the provisioner object itself, OIDC
   re-executes `step oauth --oidc --bare`, K8sSA reads the in-cluster service
   account file (`--k8ssa-token-path`, default
   `/var/run/secrets/kubernetes.io/serviceaccount/token`), and ACME/SCEP
   return dedicated "not supported in token flows" errors
   (token_flow.go:154-182, token_generator.go:144-193).

`OfflineTokenFlow` (token_flow.go:212-273) is the entry used by
`step ca token --offline`: if `ca-config` names an existing file it becomes an
`OfflineCA` token request; otherwise token signing falls back to fully
flag-driven JWK/X5C generation requiring `--provisioner`/`--issuer` and
`--key`.

## Failure handling and security posture

- Root-of-trust is never optional online: an online flow with no `--root`,
  no `--token`-embedded SHA, and no STEPPATH root file fails with a required
  flag error before any request leaves the process
  (client.go:65-71, certificate_flow.go:160-167).
- `--ca-url` is rejected unless it can be represented as an `https` URL
  (see [Shared Flags and Parsing Contracts](/openwiki/core/flags-and-configuration.md)).
- Tokens are always generated or passed explicitly; `ParseInsecure` is used
  solely for shaping the client and default SANs, never as an authorization
  decision — the CA (or offline authority) re-verifies the OTT on the request.
- Written material defaults to owner-only modes (`0o600` for cert output,
  password-protected key handling via `pemutil`/`ui.PromptPassword`).

## See also

- [Provisioning Tokens (token package)](/openwiki/core/token-package.md)
- [Certificate Issuance and Renewal Workflows](/openwiki/workflows/certificate-lifecycle.md)
- [CA Administration Commands](/openwiki/workflows/ca-administration.md)
- [STEPPATH, Contexts, and Local State](/openwiki/architecture/steppath-and-contexts.md)
