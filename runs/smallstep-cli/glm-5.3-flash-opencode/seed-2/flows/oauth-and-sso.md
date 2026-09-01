---
type: flow
title: OAuth and Single Sign-On
description: How step oauth performs the OAuth2/OIDC flows (loopback authorization code with PKCE, out-of-band, device grant, JWT bearer, and self-signed JWT), including provider discovery and output modes.
tags: [oauth, oidc, sso, flows]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# OAuth and Single Sign-On

`step oauth` (implemented almost entirely in `command/oauth/cmd.go`) obtains
OAuth 2.0 access tokens and OIDC identity tokens from an identity provider at
the command line. It is also the engine behind OIDC provisioners: the CA token
flow shells out to `step oauth --oidc --bare` (via `exec.Step`) with the
provisioner's configuration endpoint, client credentials, scopes, auth
parameters, and listen address
(`utils/cautils/token_generator.go:generateOIDCToken`).

## Flow selection

`oauthCmd` picks exactly one of five grant implementations:

| Condition | Flow |
| --- | --- |
| `--account` file of type `service_account` and `--jwt` | `DoJWTAuthorization` — returns the signed RS256 JWT itself (exp now+3600) instead of an OAuth token |
| `--account` file of type `service_account` | `DoTwoLeggedAuthorization` — JWT-bearer grant (`urn:ietf:params:oauth:grant-type:jwt-bearer`) |
| `--console-flow device` or `--console` (default device) | `DoDeviceAuthorization` — RFC 8628 device grant |
| `--console-flow oob` | `DoManualAuthorization` — out-of-band code entry |
| default | `DoLoopbackAuthorization` — authorization code with PKCE via a local HTTP server |

Account JSON supports both `installed` (desktop client credentials) and
`service_account` (private key used to sign the JWT; `client_id` becomes the
JWT `kid`, `client_email` the issuer).

## Providers and endpoints

Known providers `google` and `github` have hard-coded authorization, device
authorization, token, and userinfo endpoints. Any other provider must be an
`https://` URL: `newOauth` fetches `/.well-known/openid-configuration` (OIDC
discovery) to learn the `authorization_endpoint`, `device_authorization_endpoint`,
and `token_endpoint`, or the caller supplies endpoints explicitly
(`--authorization-endpoint` requires `--token-endpoint`;
`--device-authorization-endpoint` likewise). A `--client-id` is required
whenever a provider other than the Google default is in play.

Default Google client IDs are compiled in: one for the standard
authorization-code flow and one for the device flow (both documented in
source as open-source testing clients with no security access). `--client-id`
/`--client-secret` override them.

## Loopback authorization code flow (default)

1. A local `httptest`-based server listens on `127.0.0.1:0` by default, or on
   `--listen` (host defaults to `127.0.0.1`; `--listen-url` overrides the
   `redirect_uri` advertised to the provider, and its path becomes the
   callback path).
2. `Auth()` builds the authorize URL with `response_type=code`, a random
   `state`, a random `nonce`, `login_hint` from `--email`, the `--scope`
   list (default `openid email`), `--prompt`, `--auth-param` extras, and
   PKCE S256 (`code_challenge` = SHA-256 of a random 64-char verifier).
3. The browser is opened via `exec.OpenInBrowser` (skipped and the URL
   printed to stderr when `STEP_OPEN_BROWSER=0`; a failure also just prints
   the URL).
4. The callback handler validates `state`, exchanges the code with
   `code_verifier` and client credentials, redirects the browser to
   `--redirect-url` if set (otherwise shows a success page), and delivers the
   token over a channel.
5. The CLI waits up to 2 minutes before timing out.

The hidden `--implicit` variant (requires `--insecure` and `--client-id`)
uses `response_type=id_token token` and a JS page that forwards the URL
fragment back to the callback.

## Device and OOB flows

- **Device grant**: posts the client credentials to the device authorization
  endpoint, prefers `verification_uri_complete` (printing no user code in
  that case), tolerates Google's non-spec `verification_url`, then polls the
  token endpoint every `interval` seconds (default 5) until the token
  arrives or the grant expires (`expires_in`, capped at 5 minutes).
- **OOB** (`--console-flow oob`): sets `redirect_uri` to
  `urn:ietf:wg:oauth:2.0:oob`, prints the authorize URL, reads the
  verification code from stdin, and exchanges it at the token endpoint.

## Output modes

The final token is printed as `Authorization: Bearer <token>` (`--header`),
the bare token (`--bare`), or pretty-printed JSON (default). `--oidc`
selects the OIDC ID token instead of the access token in every mode.

## Failure behavior

Provider validation rejects anything that is not `google`, `github`, or an
`https://` URL; missing endpoints surface as discovery errors; callback
errors and failed exchanges render a failure page and propagate to the CLI
through the error channel; the loopback flow enforces a 2-minute timeout.
