---
type: oauth-sso-workflow
title: OAuth and SSO
description: The step oauth command — OAuth 2.0/OIDC flows (loopback, device, OOB, JWT bearer) — and its role as the OIDC provisioner backend for CA commands.
tags: [oauth, oidc, sso, authentication, provisioner]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# OAuth and SSO

## Purpose and ownership

`step oauth` (in `command/oauth/cmd.go`) implements OAuth 2.0 authorization
flows at the command line and prints the resulting access or OIDC token. It is
also the *backend* for OIDC provisioners: when a CA command needs an OIDC
token, the token-generation layer re-enters the CLI and runs `step oauth`
(repo://command/oauth/cmd.go#L79-L307, repo://utils/cautils/token_generator.go#L144-L169).

## Flow selection

`oauthCmd` validates options and picks one of four flows
(repo://command/oauth/cmd.go#L351-L513):

- **Loopback authorization** (default): opens the browser and receives the
  redirect on a local HTTP server. `--listen` fixes the address/port (e.g.
  `:10000`), `--listen-url` overrides the advertised `redirect_uri`
  (repo://command/oauth/cmd.go#L729-L814).
- **Device Authorization Grant** (`--console` or `--console-flow device`):
  polls the token endpoint at the provider-given interval until the user
  completes the flow or the grant expires (default poll window 5 minutes,
  default interval 5 seconds) (repo://command/oauth/cmd.go#L861-L952).
- **Out-of-band / manual** (`--console-flow oob`): prints the auth URL, reads
  the verification code from stdin, and exchanges it
  (repo://command/oauth/cmd.go#L816-L846).
- **JWT bearer / two-legged** (`--account` with a `service_account` JSON):
  signs an RS256 JWT assertion with the account's private key and exchanges it
  via the `urn:ietf:params:oauth:grant-type:jwt-bearer` grant; `--jwt` instead
  returns the self-generated JWT directly
  (repo://command/oauth/cmd.go#L981-L1088).

A hidden **implicit** flow exists and requires `--insecure` plus
`--client-id` (repo://command/oauth/cmd.go#L290-L294, repo://command/oauth/cmd.go#L390-L396).

## Providers and discovery

Google and GitHub are hardcoded `knownProviders` with authorization, device,
token, and userinfo endpoints; any other provider must be an HTTPS OIDC
discovery URL (`.well-known/openid-configuration`) unless explicit
`--authorization-endpoint`/`--device-authorization-endpoint` and
`--token-endpoint` flags are provided (each requires its token endpoint
companion) (repo://command/oauth/cmd.go#L573-L586, repo://command/oauth/cmd.go#L632-L656,
repo://command/oauth/cmd.go#L410-L428). Default client credentials are the
published Google installed-app client ID/secret (documented in-source as
public, no security access), with a separate pair for the device flow
(repo://command/oauth/cmd.go#L35-L66).

The authorization request uses PKCE S256 (`code_challenge_method` +
SHA-256 of a 64-char alphanumeric challenge), a random `state`, a 256-bit
`nonce`, `login_hint` from `--email`, plus `--prompt` and `--auth-param`
extensions (repo://command/oauth/cmd.go#L1197-L1231). The loopback callback
server validates `state` before exchanging the code, supports a terminal
redirect page via `--redirect-url`, and times out after 2 minutes
(repo://command/oauth/cmd.go#L1092-L1150, repo://command/oauth/cmd.go#L806-L813).

## Output modes

With `--header` the command prints an `Authorization: Bearer <token>` line;
with `--bare` it prints only the token (ID token when `--oidc` is set,
otherwise access token); otherwise it prints the full token JSON
(repo://command/oauth/cmd.go#L515-L537). `STEP_OPEN_BROWSER=0` suppresses
browser opening and prints the URL instead (repo://command/oauth/cmd.go#L787-L789).

## The re-entry pattern: CA commands → step oauth

For OIDC provisioners, `generateOIDCToken` in `utils/cautils` does not link
the OAuth code; it **executes `step oauth` as a subprocess** via `exec.Step`
with `--oidc --bare --provider <configuration-endpoint> --client-id ...
--client-secret ...`, plus `--scope`/`--auth-param` from the provisioner
configuration, `--console` when the CA command had `--console`, and
`--listen <provisioner listen address>` unless `STEP_LISTEN` is set in the
environment. The trimmed stdout becomes the OIDC token embedded in the CA
request (repo://utils/cautils/token_generator.go#L144-L169, repo://exec/exec.go#L130-L149).

The same pattern is exposed directly to users: `step ca certificate --token
$(step oauth --oidc --bare) joe@example.com ...` (documented in the command's
examples, repo://command/ca/certificate.go#L88-L92).

Both flows are wired to the provisioner's configured listen address: the
provisioner may pin `ListenAddress`, which is honored unless the user sets
`STEP_LISTEN` (repo://utils/cautils/token_generator.go#L161-L163).

## Invariants and failure behavior

- Provider validation: only `google`, `github`, or `https://`-prefixed
  discovery URLs are accepted; `--provider` requires `--client-id` unless the
  provider is google and no custom authorization endpoint was set
  (repo://command/oauth/cmd.go#L330-L349, repo://command/oauth/cmd.go#L366-L368).
- The loopback handler rejects requests with error parameters or mismatched
  state, returning the failure page and pushing the error into `errCh`
  (repo://command/oauth/cmd.go#L1104-L1131, repo://command/oauth/cmd.go#L1292-L1324).
- Device polling stops after `expires_in` (or the 5-minute default) with
  "device authorization grant expired" (repo://command/oauth/cmd.go#L928-L951).
- Token verification of the returned OIDC token happens in `step crypto jwt
  verify` (using the provider JWKS) — the oauth command itself only obtains
  tokens; it does not verify them (repo://command/oauth/cmd.go#L68-L77).

## Uncertainty

Refresh-token usage is modeled in the token struct (`refresh_token` field) but
this repository contains no dedicated `step oauth --refresh` refresh flow; the
README mentions refresh token flows as a feature, and the implementation
surface for them is not established in `command/oauth/cmd.go` beyond the
response field (repo://command/oauth/cmd.go#L68-L77, repo://README.md#L60-L63).
