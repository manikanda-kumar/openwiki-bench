---
type: "Reference"
title: "CA Clients and Certificate Request Flows"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
sources:
  - id: openwiki-source-567b7cca98d1eb42c96305c8
    resource: repo://command/ca/admin/admin.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-09-14T13:44:47.469Z" }
---

# CA Clients and Certificate Request Flows

`utils/cautils` is the core client library that every command which talks to a Step CA is built on. It defines one interface, `CaClient`, with two implementations: an online client (the `smallstep/certificates` API client) and the embedded `OfflineCA`, plus an option-based `CertificateFlow` that builds sign requests and an `admin client` constructor for the management API. A separate bootstrap flow installs the root and default context so later commands work without flags.

## CaClient interface

`CaClient` (utils/cautils/client.go:29-48) is the single surface commands use for CA operations:

- X.509: `Sign`, `Renew`, `RenewWithToken`, `Revoke`, `Rekey`, `Version`, `GetRootCAs`, `GetCaURL`
- SSH: `SSHSign`, `SSHRenew`, `SSHRekey`, `SSHRevoke`, `SSHRoots`, `SSHFederation`, `SSHConfig`, `SSHCheckHost`, `SSHGetHosts`, `SSHBastion`

The online implementation is the `*ca.Client` returned by `ca.NewClient` from `smallstep/certificates`; the offline implementation is `*OfflineCA` below.

### Client construction (client.go:50-204)

- `NewClient(ctx, opts...)` (client.go:52-74) selects the mode from flags:
  - `--offline` requires `--ca-config` and returns `NewOfflineCA(ctx, caConfig)`.
  - Otherwise it resolves the CA URL via `flags.ParseCaURL`, defaults the root to `pki.GetRootCAPath()` (erroring with a required-flag message if missing), prepends `ca.WithRootFile(root)`, and returns `ca.NewClient(caURL, opts...)`.
- `NewUnauthenticatedAdminClient(ctx, opts...)` (client.go:77-96) builds an unauthenticated `*ca.AdminClient` for the management API, requiring `--ca-url` (via `flags.ParseCaURLIfExists`) and the same root resolution.
- `NewAdminClient(ctx, opts...)` (client.go:99-204) builds an authenticated admin client:
  - If `--admin-cert` and `--admin-key` are given (both required together via `errs.RequiredWithFlag`), it loads the cert bundle and key from disk.
  - Otherwise it prints "No admin credentials found. You must login to execute admin commands.", generates a default key, prompts for an admin name/subject unless `--admin-subject` is set, creates a sign token through `NewTokenFlow` (`SignType`), builds a CSR from the subject SANs, signs it with an online client (`ca.NewClient` with the root file), and uses the resulting chain as the admin credentials.
  - In both cases the final client is `ca.NewAdminClient(caURL, ca.WithRootFile(root), ca.WithAdminX5C(adminCert, adminKey, password-file))`.

The `smallstep/certificates` admin API is the linkedca-backed management API; `step ca admin` subcommands additionally use `linkedca` types (e.g. `linkedca.Admin`, `Admin_SUPER_ADMIN`) for admin objects (command/ca/admin/admin.go:69-82).

## CertificateFlow (certificate_flow.go)

`CertificateFlow` (certificate_flow.go:37-40) holds an optional `*OfflineCA` and the `offline` flag. `NewCertificateFlow(ctx, opts...)` (certificate_flow.go:106-131) applies the options and, in offline mode, requires `--ca-config` and constructs the `OfflineCA`.

### Options and flowContext

- `flowContext` (certificate_flow.go:42-48) carries `DisableCustomSANs`, `SSHPublicKey`, `CertificateRequest`, `ConfirmationFingerprint`, and `CustomAttributes`.
- A package-level `sharedContext` (certificate_flow.go:51) is the shared state: all `Option`s are applied to this single struct per process, which is how one command (e.g. `step ca sign` with `--csr`/`--confirm`) passes data to another flow in the same invocation.
- The `Option` interface (certificate_flow.go:67-69) has one method, `apply(fo *flowContext)`. Built-ins, all via `newFuncFlowOption` (certificate_flow.go:53-65): `WithSSHPublicKey` (72-76), `WithCertificateRequest` (79-83), `WithConfirmationFingerprint` (87-91), `WithCustomAttributes` (94-103, merges into the `user` claim map).

### Client selection for a token: `GetClient` (certificate_flow.go:134-171)

- Offline: returns the embedded `OfflineCA` directly.
- Online: parses the OTT with `token.ParseInsecure`.
  - **Bootstrap/provisioning tokens** (payload has a `SHA` claim and an `http(s)` audience): the audience becomes the CA URL when `--ca-url` is unset, and the client trusts the root by fingerprint via `ca.WithRootSHA256(sha)` — no local root file needed.
  - **All other tokens**: `--ca-url` is required, the root defaults to `pki.GetRootCAPath()`, and the client is built with `ca.WithRootFile(root)`.
- Prints the selected CA with `ui.PrintSelected("CA", caURL)`.

### Token generation

- `GenerateToken(ctx, subject, sans)` (certificate_flow.go:176-205): offline → `OfflineCA.GenerateToken` with `SignType`; online → requires `--ca-url` (unless `--token`), resolves the root, prompts "What DNS names or IP addresses would you like to use?" when the subject is empty, then delegates to `NewTokenFlow` (token_flow.go:101).
- `GenerateSSHToken(ctx, subject, typ, principals, validAfter, validBefore)` (certificate_flow.go:209-231): same split, delegating to `NewTokenFlow` with the SSH token type and validity.
- `GenerateIdentityToken(ctx)` (certificate_flow.go:234-247): always online, resolves CA URL/root, and delegates to `NewIdentityTokenFlow` (token_flow.go:187), which builds a token from an OIDC provisioner only.

### Signing a CSR

- `Sign(ctx, tok, csr, crtFile)` (certificate_flow.go:250-293): gets the client via `GetClient`, parses `--not-before`/`--not-after` (`flags.ParseTimeDuration`) and `--template-data` (`flags.ParseTemplateData`), builds `api.SignRequest{CsrPEM, OTT, NotBefore, NotAfter, TemplateData}`, calls `client.Sign`, falls back to `ServerPEM`+`CaPEM` when `CertChainPEM` is empty, serializes the chain, and writes the PEM to `crtFile` with mode `0o600`.
- `CreateSignRequest(ctx, tok, subject, sans)` (certificate_flow.go:297-405) is the helper that produces the `SignRequest` plus the private key:
  - Parses the OTT (`token.ParseInsecure`), derives key details from `--kty`/`--curve`/`--size` (`utils.GetKeyDetailsFromCLI`), and generates the key with `keyutil.GenerateKey`.
  - Merges `--san` values with the token's `sans` claim via `splitSANs` (certificate_flow.go:409-421, deduplicates and classifies with `x509util.SplitSANs`), then applies per-token-type defaults:
    - **AWS**: private IP plus EC2-style internal DNS names.
    - **GCP**: `name.project.c.` and `name.zone.project.c.` internal names.
    - **Azure**: the instance resource name.
    - **OIDC**: if subject equals the token email, CN = token subject, email SAN, and an issuer#subject URI; otherwise CN/SANs from the subject.
    - **K8sSA**: uses the command-line subject (tokens are multi-use).
    - **default**: subject comes from the token.
    - `sharedContext.DisableCustomSANs` suppresses appending the subject to the default cloud SAN lists.
  - Builds the CSR template (`pkix.Name{CommonName: subject}` + SANs), signs and parses it, verifies the signature with `cr.CheckSignature()`, and returns `&api.SignRequest{CsrPEM, OTT}` and the key.

## OfflineCA (offline.go)

`OfflineCA` (offline.go:28-34) wraps a `*authority.Authority` and its `config.Config` from `smallstep/certificates`, letting the CLI perform CA operations with no network.

- **Singleton**: `offlineInstance` (offline.go:36-39) guards `NewOfflineCA` (offline.go:42-81) — double initialization is impossible because the authority backend (badgerDB) holds locks. `NewOfflineCA` reads and unmarshals the `--ca-config` JSON, rejects configs without provisioners, applies `--password-file` to the config password, and calls `authority.New(&cfg)`.
- **Accessors**: `GetCaURL` (84-86, `https://<first DNSName>`), `GetRootCAs` (90-92, always nil), `CaURL` (161-163), `Root` (166-168, first root cert file), `Provisioners` (171-173), `Audience` (141-158, maps token types to `https://<host>/<endpoint>` audiences such as `/sign`, `/renew`, `/revoke`, `/ssh/sign`, ...).
- `VerifyClientCert(certFile, keyFile)` (offline.go:96-138) checks cert/key match via `tls.X509KeyPair` and verifies the cert against the configured root and intermediate pools.
- **Operation wrappers** mirror the `CaClient` interface against `authority.Authority`:
  - `Sign` (offline.go:196-222): authorizes the OTT (`authority.Authorize` with the `provisioner.SignMethod` context), signs with `SignWithContext` (passing `NotBefore`/`NotAfter`/`TemplateData`), and returns the chain (leaf, intermediate) plus the authority's TLS options.
  - `Renew` (226-250): extracts the leaf of the TLS client certificate from the passed `http.Transport` and renews it; `RenewWithToken` (255-275) authorizes a one-time token instead.
  - `Revoke` (279+), `Rekey` (316+), `SSHSign` (345+), `SSHRevoke` (376+), `SSHRenew` (399+), `SSHRekey` (419+), `SSHRoots` (444+), `SSHFederation` (462+) follow the same pattern, and `Version` (185-191) reports the authority version.

## Bootstrap (bootstrap.go)

`bootstrap(ctx, caURL, fingerprint, opts...)` (bootstrap.go:98-222) turns a CA URL + root fingerprint into a working local configuration:

1. Builds an insecure `ca.NewClient` and calls `client.Root(fingerprint)` — the fingerprint check is the trust anchor validation.
2. **Contexts**: when `UseContext` (bootstrap.go:37-42; contexts enabled in config or `--context`/`--authority`/`--profile` set), it adds a context via `step.Contexts().Add` (name defaults to the option's default context, authority/profile default to the name), saves it as current, and sets it. Otherwise it calls `WarnContext` (bootstrap.go:46-54), which prints a hint if a legacy `config/ca.json` exists.
3. Writes the root PEM to `pki.GetRootCAPath()` (typically `$STEPPATH/certs/root_ca.crt`) with mode `0o600`, creating parent dirs with `0o700`.
4. Completes the URL (`utils.CompleteURL`, forcing https) and writes `bootstrapConfig` (ca-url, fingerprint, root, optional redirect-url/provisioner/min-password-length) to `step.DefaultsFile()` (`$STEPPATH/configs/defaults.json`) with mode `0o644`.
5. Sets `ca-url`, `fingerprint`, and `root` back onto the CLI context so the rest of the command can use them.
6. When contexts are enabled, creates an empty profile defaults file (`{}`) if missing.
7. With `--install`, installs the root into the OS truststore via `truststore.InstallFile`.

Two public entry points:

- `BootstrapTeamAuthority(ctx, team, teamAuthority)` (bootstrap.go:226-294): GETs `https://api.smallstep.com/v1/teams/<team>/authorities/<teamAuthority>` (or a custom `--team-url` endpoint with `<team>` substituted for `<>`), parses the `bootstrapAPIResponse` (url, fingerprint, redirect-url, provisioner, min-password-length), defaults the redirect to `https://smallstep.com/app/teams/sso/success`, and runs `bootstrap` with default context name `<teamAuthority>.<team>`. HTTP errors are surfaced through `readError` (bootstrap.go:348-355).
- `BootstrapAuthority(ctx, caURL, fingerprint)` (bootstrap.go:297-317): the plain flow used by `step ca bootstrap`, deriving the default context name from the CA host (`getHost`, bootstrap.go:319-331) or `--authority`, with an optional `--redirect-url`.

## Change guides

### Adding a new CertificateFlow option

1. Add any new state to `flowContext` (utils/cautils/certificate_flow.go:42-48) if the option must carry data.
2. Add a `With...` constructor returning `newFuncFlowOption` (certificate_flow.go:61-65) — the `Option` interface only requires `apply(fo *flowContext)` (certificate_flow.go:67-69).
3. Pass it from the command via `NewCertificateFlow(ctx, With...(...))` or `NewTokenFlow(ctx, ..., With...(...))` (both accept variadic options).
4. Remember options are applied to the package-level `sharedContext` (certificate_flow.go:51), so they are process-global: a value set by one command in the same invocation is visible to later flows (this is the intended mechanism for `--csr`/`--confirm`-style hand-offs).

### Adding a new CA API call to the client

1. Add the method to the `CaClient` interface (utils/cautils/client.go:29-48) — this forces both implementations to provide it.
2. Implement the offline path on `OfflineCA` (utils/cautils/offline.go) by wrapping the corresponding `authority.Authority` method (see `Sign`, offline.go:196-222, as the template: build `provisioner` options, call the authority, map the result into an `api.*Response`).
3. The online path is satisfied by `*ca.Client` from `smallstep/certificates` (returned by `NewClient`, client.go:73); if the method doesn't exist there, either extend usage with a `ca.ClientOption` or add a helper in `utils/cautils` that builds the request and calls the underlying client directly.
4. If the call needs a token, route through `CertificateFlow.GetClient` (certificate_flow.go:134-171) so bootstrap/provisioning tokens (root by SHA-256) and ordinary tokens (root by file) are handled uniformly.
5. For management-API work, extend `NewAdminClient`/`NewUnauthenticatedAdminClient` (client.go:77-204) or the `step ca admin` package (command/ca/admin), which already uses `linkedca` types for admin objects.
