---
type: commands
title: "OAuth 2.0 and OIDC Client"
description: "The step oauth command: provider discovery, loopback (default), manual/OOB, device, jwt-bearer (two-legged) and service-account JWT flows, the local callback server with PKCE, console mode, --bare/--oidc output, and how it feeds OIDC provisioner tokens to CA commands."
tags: [oauth, oidc, pkce, loopback, device-flow, oob, jwt-bearer, service-account]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

`step oauth` (all logic in `command/oauth/cmd.go`) performs OAuth 2.0 authorization-code flows and prints the resulting token — primarily as a building block for step CA's OIDC provisioners.

## Providers, clients, and discovery

- **Built-in providers**: `google` and `github` have static endpoint tables (authorization, device authorization, token, userinfo) (`command/oauth/cmd.go:573-586`). Any other `--provider` must be an `https://` URL and is resolved via OIDC discovery: `GET <provider>/.well-known/openid-configuration` (the OIDC path form, with a TODO noting RFC 8414's different construction) (`command/oauth/cmd.go:684-709`).
- **Default Google client**: with no `--client-id`, the command uses the CLI's built-in Google installed-app client ID/secret (`command/oauth/cmd.go:47-66`; the comments note these are public, access-free test credentials). The device flow has its own separate default client credentials.
- **`--account`** accepts a JSON account file: the `installed` format (auth_uri/token_uri/client_id/client_secret) or a Google `service_account` (auth_uri, token_uri, `private_key_id` as client ID, `private_key` PEM as client secret, `client_email` as issuer — this selects the two-legged flows) (`command/oauth/cmd.go:433-461`).
- **Explicit endpoints**: `--authorization-endpoint` (requires `--token-endpoint`) and `--device-authorization-endpoint` (requires `--token-endpoint`) skip discovery entirely.
- **PKCE and anti-CSRF material** (`command/oauth/cmd.go:588-630`): a 32-char alphanumeric `state`, a 64-char alphanumeric PKCE verifier (`codeChallenge`), and a 256-bit hex `nonce`; the `--email` flag becomes `login_hint`.

## Authorization modes (the `Do*` methods)

Dispatch in `oauthCmd` (`command/oauth/cmd.go:496-509`): service account → two-legged; `--console`/`--console-flow device` → device; `--console-flow oob` → manual; default → loopback.

### Loopback (default) — `DoLoopbackAuthorization`

Starts a local HTTP server: `httptest.NewServer` on a random 127.0.0.1 port by default, or `net.Listen` on `--listen` (empty host defaults to 127.0.0.1; `ReadHeaderTimeout` 15s), with the `redirect_uri` taken from `--listen-url` when set (`command/oauth/cmd.go:728-763,765-779`). It builds the authorization URL, opens the browser (`exec.OpenInBrowser`; `--browser` selects the binary on macOS; `STEP_OPEN_BROWSER=0` prints the URL to stderr instead), then blocks on the token/error channels with a **2-minute timeout** (`oauth command timed out, please try again`) (`command/oauth/cmd.go:781-813`).

### Manual / OOB — `DoManualAuthorization`

Sets `redirect_uri` to the OOB URN `urn:ietf:wg:oauth:2.0:oob`, prints the authorization URL, prompts `Enter verification code:` on STDIN, and exchanges the code (`command/oauth/cmd.go:816-846`).

### Device (RFC 8628) — `DoDeviceAuthorization`

POSTs client credentials + scope to the device authorization endpoint and parses `device_code`, `user_code`, `verification_uri` (accepting Google's non-spec `verification_url`, preferring `verification_uri_complete` and omitting the code prompt when present), `expires_in`, and `interval` (default 5s) (`command/oauth/cmd.go:848-920`). It then polls the token endpoint with `grant_type=urn:ietf:params:oauth:grant-type:device_code` every interval; HTTP 4xx responses are treated as "not yet authorized" (`errHTTPToken`) and polling continues until the `expires_in` deadline (default 5 minutes) → `device authorization grant expired` (`command/oauth/cmd.go:921-979`).

### Two-legged / service accounts

- **`DoTwoLeggedAuthorization`**: signs an RS256 JWT (`kid` = private key ID, claims `aud`=token endpoint, `iss`/sub = client_email, `exp` = now+3600, `scope`) with the account's PKCS8 key and exchanges it with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` at the token endpoint (`command/oauth/cmd.go:981-1042`).
- **`DoJWTAuthorization`** (`--jwt`): same RS256 JWT but `aud` is the scope string and **no HTTP exchange happens** — the JWT itself is returned as the access token (3600s, Bearer) for direct API use (`command/oauth/cmd.go:1044-1088`).

## The authorization URL and exchange

`Auth()` builds the request URL with `client_id`, `redirect_uri`, `response_type=code` + **PKCE S256** (`code_challenge` = base64url(sha256(verifier))), `scope` (default `openid email`), `prompt`, `state`, `nonce`, `login_hint`, and any `--auth-param` pairs (`command/oauth/cmd.go:1197-1231`). `Exchange` POSTs the code with `code_verifier` (the original verifier string), client credentials, and `grant_type=authorization_code`; token-endpoint POSTs set `Accept: application/json` (noted as required by GitHub) (`command/oauth/cmd.go:711-726,1233-1255`).

The callback handler (`ServeHTTP`) only serves the configured path (default `/`), answers OPTIONS, rejects `error` params, requires **both `code` and `state`** and validates the state against the generated value, exchanges the code, honors `--redirect-url` (302 to the operator's URL after success — the mechanism team bootstrap uses for the SSO redirect) and otherwise renders a success page, then delivers the token over the channel (`command/oauth/cmd.go:1090-1150`).

The **implicit flow** is available behind the hidden `--implicit` flag, which requires `--insecure` and `--client-id` (`command/oauth/cmd.go:290-294,390-396`): `response_type=id_token token` (no PKCE), and `implicitHandler` performs a two-step dance — the first callback returns an HTML page whose JavaScript moves the `window.location.hash` back to `<redirect_uri>?urlhash=true&...`, and the second request reads `access_token`/`id_token`/`refresh_token` from the query string, validates state, and delivers the token (`command/oauth/cmd.go:1152-1195`).

## Output and feeding CA commands

- `--bare` prints only the token (the ID token with `--oidc`, otherwise the access token); `--header` prints `Authorization: Bearer <token>` (curl-friendly); otherwise the full token struct is printed as indented JSON (access token, ID token, refresh token, expiry, type, scope) (`command/oauth/cmd.go:515-535`).
- **CA integration**: when a step CA has an OIDC provisioner, `step ca token` / `step ca certificate` do not implement OIDC themselves — they run this command as a subprocess: `step oauth --oidc --bare --provider <provisioner.ConfigurationEndpoint> --client-id ... --client-secret ...` (plus scopes, auth-params, optional `--console`, and `--listen <provisioner.ListenAddress>` when `STEP_LISTEN` is unset), and use the printed ID token as the CA token (`utils/cautils/token_generator.go:142-169`). That is how the SSO redirect configured by `step ca bootstrap` and the provisioner's client credentials meet the OIDC user.
