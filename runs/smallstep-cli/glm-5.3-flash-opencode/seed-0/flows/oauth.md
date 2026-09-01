---
type: workflow-page
title: OAuth and OIDC Sign-On
description: How step oauth obtains OAuth 2.0 and OIDC tokens - loopback PKCE, device, out-of-band, and service-account flows - and how CA OIDC provisioning reuses it.
tags: [oauth, oidc, pkce, device-flow, sso, providers]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

`step oauth` is a self-contained OAuth 2.0 / OIDC client that adds single sign-on to
any CLI workflow. It is also a building block: CA OIDC provisioners obtain their
tokens by re-executing `step` itself with oauth arguments. This page documents both
sides.

## Flow selection

`oauthAction` builds an `oauth` client object and selects exactly one of four flows
(command/oauth/cmd.go:495-509):

| Condition | Flow |
|---|---|
| `--account` + `--jwt` | `DoJWTAuthorization` |
| `--account` (service account) | `DoTwoLeggedAuthorization` |
| `--console` or `--console-flow device` | `DoDeviceAuthorization` |
| `--console-flow oob` | `DoManualAuthorization` |
| default | `DoLoopbackAuthorization` |

## Providers and discovery

Two providers are hardcoded with their authorization, device-authorization, token,
and userinfo endpoints: `google` and `github` (command/oauth/cmd.go:573-586). Any
other `--provider` value is treated as an OIDC discovery URL: `disco()` fetches
`<provider>/.well-known/openid-configuration` and extracts the
`authorization_endpoint`, `device_authorization_endpoint` (device flow only), and
`token_endpoint` (cmd.go:684-709, requirement checks at 635-656).

The default Google "installed app" client ID/secret pair is baked into the source
with a comment explaining why: the app has no APIs enabled and cannot keep the
secret confidential, mirroring how Google ships the same values in its Cloud SDK
(cmd.go:35-56). A separate client pair is used for the device flow.

## Loopback authorization-code flow (default)

`DoLoopbackAuthorization` (command/oauth/cmd.go:765-814) is the full browser dance:

1. **Local callback server.** `NewServer` (cmd.go:728-763) starts an
   `httptest.NewServer` — a random port bound to 127.0.0.1 — unless `--listen` is
   given, in which case it listens on that address (defaulting the host to
   127.0.0.1) and rewrites the server URL accordingly. `--listen-url` overrides
   the redirect URI sent to the provider while keeping the local listener.
2. **Authorization URL.** `Auth()` (cmd.go:1198-1231) builds the redirect with
   `response_type=code`, PKCE S256 (`code_challenge_method=S256` with the SHA-256
   of a random 64-character verifier), a random 32-character `state`, a 256-bit
   `nonce`, `scope` (default `openid email`, cmd.go:463-466), optional `prompt`,
   `login_hint` (from `--email`), and any `--auth-param` extras.
3. **Browser.** The URL is opened with `exec.OpenInBrowser(authURL, o.browser)`
   unless `STEP_OPEN_BROWSER=0`, in which case it is printed; if opening fails the
   URL is printed with instructions (cmd.go:787-803).
4. **Callback handling.** `ServeHTTP` (cmd.go:1090-1150) serves only the callback
   path (default `/`), passes `OPTIONS` through, rejects an `error` query
   parameter, validates `code`+`state` against the generated state, exchanges the
   code, then 302-redirects to `--redirect-url` or serves the SVG success page and
   ships the token over an internal channel. Requests missing code/state print a
   hint that a browser extension or app may be interfering (cmd.go:1116-1122).
5. **Code exchange.** `Exchange` (cmd.go:1233-1255) posts
   `grant_type=authorization_code` with the PKCE `code_verifier`. All POSTs go
   through `postForm`, which adds `Accept: application/json` — without it GitHub
   answers `application/x-www-form-urlencoded` (cmd.go:711-714).
6. **Timeout.** The command waits on token/error channels for at most 2 minutes
   (cmd.go:806-813).

The hidden implicit flow (`--implicit`, requires `--insecure` and `--client-id`)
serves a JavaScript page that copies the URL hash fragment back to the server as
query parameters (`urlhash=true`) so the implicit token can be captured
(cmd.go:1152-1195).

## Device authorization grant (RFC 8628)

`DoDeviceAuthorization` (cmd.go:861-952) posts the client identity to the
device-authorization endpoint, prefers `verification_uri_complete` (suppressing the
user-code prompt), tolerates Google's spec-violating `verification_url` key
(cmd.go:852-855, 902-905), then polls the token endpoint every `interval` seconds
(default 5, cmd.go:58) until a token arrives or the grant expires (default cap 5
minutes, cmd.go:59; an `expires_in` shorter than the cap shortens polling, cmd.go:928-934).
HTTP 4xx from the token endpoint is interpreted as "authorization pending" and keeps
polling (`errHTTPToken`, cmd.go:954, 967-978).

## Out-of-band flow

`DoManualAuthorization` (cmd.go:816-846) sets the redirect URI to the
`urn:ietf:wg:oauth:2.0:oob` URN (cmd.go:62), prints the authorization URL for a
browser on another machine, reads the pasted verification code from stdin, and
exchanges it.

## Service-account flows

`--account` takes an `installed`-type or `service_account` JSON key. 
`DoTwoLeggedAuthorization` (cmd.go:981-1042) parses the PKCS#8 private key embedded
in the account's secret, signs an RS256 JWT with `aud` = token endpoint, `iss` = the
account issuer, and `scope`, then posts it as `assertion` with
`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` (cmd.go:65).
`DoJWTAuthorization` (`--jwt`, cmd.go:1044-1088) instead returns the signed JWT
itself (with `sub` = issuer) as the token without contacting any endpoint — only
useful against APIs that accept JWT bearer authentication directly.

## Token output modes

Output is one of three forms (cmd.go:515-535): `--header` prints
`Authorization: Bearer <token>`; `--bare` prints just the token (`--oidc` selects
the ID token instead of the access token in both); default prints the full token
JSON, which includes access, ID, and refresh tokens plus expiry (the `token` struct
at cmd.go:68-77). Refresh tokens are parsed and surfaced but no refresh grant is
implemented — the struct field is carried through parsing and the implicit handler
only (cmd.go:71, 1176).

## Reuse by CA OIDC provisioning

When an OIDC provisioner signs a CA token, `generateOIDCToken`
(utils/cautils/token_generator.go:142-168) executes the step binary against itself
via `exec.Step` (exec/exec.go:130-146, which re-runs `os.Args[0]` and captures
stdout) with `oauth --oidc --bare`, the provisioner's configuration endpoint as
`--provider`, its client credentials, scopes, and auth params, `--console` when the
user asked for it, and `--listen` from the provisioner's `ListenAddress` unless the
`STEP_LISTEN` environment variable overrides it. The trimmed stdout line is the
OIDC identity token embedded in the CA provisioning token. This is why an OIDC
`step ca` flow can pop a browser even though the outer command never mentions OAuth.

`exec.OpenInBrowser` (exec/exec.go:102-127) abstracts platform browser launching:
`open` (with optional `-a <browser>`) on darwin, `xdg-open` on linux/android with
WSL detected via `/proc/sys/kernel/osrelease` and routed through
`rundll32.exe url.dll,FileProtocolHandler`, and `rundll32` on windows; other
platforms error.

## Failure behavior

Errors surface through the standard error contract. Flow-specific failure modes:
loopback timeouts after 2 minutes; state mismatches fail closed in both the code
and implicit handlers; device flow reports grant expiry; and exchange errors are
propagated from the provider's `error`/`error_description` fields (cmd.go:842-844,
1139-1142).

## Representative tests

This package has no unit tests in the repository; the OAuth surface is exercised
indirectly through integration scenarios that shell out to `step oauth` for OIDC
provisioner tokens and through manual use. Claims here are source-derived.
