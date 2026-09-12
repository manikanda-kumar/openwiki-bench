---
type: command
title: OAuth Device and Authorization Flows
description: The step oauth command implementing OAuth 2.0 / OIDC authorization, including the preconfigured Google client, authorization-code/OOB/device/JWT-bearer/two-legged flows, and output modes.
tags: [oauth, oidc, authorization-code, device-grant, jose]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---

## Responsibility

[`command/oauth/cmd.go`](../../command/oauth/cmd.go) implements `step oauth`, an
OAuth 2.0 authorization flow usable to add single sign-on to any CLI application
and to obtain OAuth access tokens and OIDC identity tokens at the command line.
It is used by the CA integration's OIDC provisioner flow to generate identity
tokens.

## Preconfigured Google client

The OAuth 2.0 flow for installed applications uses a preconfigured Google client
by default. The constants in `cmd.go` bundle:

- `defaultClientID` — an open-source-testing OAuth client ID.
- `defaultClientNotSoSecret` — the matching (public, non-confidential) client
  secret.
- `defaultDeviceAuthzClientID` / `defaultDeviceAuthzClientNotSoSecret` —
  credentials for the device authorization flow.
- `defaultDeviceAuthzInterval = 5` seconds and `defaultDeviceAuthzExpiresIn =
  5 minutes` for device polling.

These are non-confidential and safe for open-source client use (annotated with
`nolint:gosec`). The default `--provider`/`--idp` value is `"google"`, and
users can override the endpoints with `--provider`(the OIDC discovery
`.well-known/openid-configuration` URL), `--authorization-endpoint`,
`--device-authorization-endpoint`, and `--token-endpoint`, combined with
`--client-id`/`--client-secret`.

## Supported OAuth flows

`oauthAction` dispatches among several authorization flows depending on flags:

- **Authorization code (loopback)** — `DoLoopbackAuthorization` runs a local
  `httptest` server on `--listen` (default random loopback port) and completes
  the redirect, exchanging the `code` for a token via `Exchange` (POST with
  `grant_type=authorization_code`). Redirect URL defaults to loopback
  (configurable with `--listen-url`).
- **Manual (OOB)** — `DoManualAuthorization` prints the authorization URL and
  prompts for the returned code, using the `oobCallbackUrn`
  (`urn:ietf:wg:oauth:2.0:oob`) redirect URI for input-constrained/out-of-band
  flows (`--console-flow oob`).
- **Device authorization grant** — `DoDeviceAuthorization` posts to the device
  authorization endpoint, prints the verification URL/device code
  (`defaultDeviceAuthzInterval` polling), and polls the token endpoint via
  `deviceAuthzTokenPoll` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`.
  Selected via `--console` (default for console flows) or `--console-flow device`.
- **Two-legged / JWT bearer** — `DoTwoLeggedAuthorization` signs a JWT (RS256)
  with the client's private key (parsed from `--client-secret` as a PEM PKCS#8
  key), includes claims for `aud`,`nbf`,`iat`,`exp`,`iss` (issuer) and `scope`,
  and exchanges it at the token endpoint with
  `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`. Invoked via
  `--account` with a JSON account file.
- **Refresh token** — after an initial authorization, a `refresh_token` can be
  used to obtain a new access token. The `token` struct models
  `access_token`/`id_token`/`refresh_token`/`expires_in`/`token_type`
  (see `cmd.go`).

## Output modes

- `--bare` — output only the token.
- `--oidc` — output the OIDC identity token instead of the OAuth access token
  (usually combined with `--bare`).
- `--header` — output an HTTP `Authorization: Bearer ...` header suitable for
  use with curl.

By default `step oauth` prints all the relevant token information.

## Additional features

- `--scope` may be repeated for multiple OAuth scopes.
- `--auth-param` passes additional URL query authentication parameters (e.g.
  `access_type=offline`).
- An `implicitHandler` exists for the implicit grant, receiving `access_token`
  and `refresh_token` (see `cmd.go`), and a `ServeHTTP` router handles the
  authorization-response endpoints.

## Relationships

`step oauth` provides the OIDC identity token used by the CA integration's OIDC
provisioner flow ([ca-integration.md](ca-integration.md)); the produced tokens
are JWTs verifiable with the crypto group's `step crypto jwt verify`
([crypto-command-group.md](crypto-command-group.md)).
