---
type: integration
title: OAuth Flows
description: How step oauth implements OAuth 2.0 and OIDC authorization (loopback, out-of-band, device grant, and service-account flows) and how token flows invoke it to mint OIDC provisioning tokens.
tags: [integration, oauth, oidc, tokens]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# OAuth Flows

`step oauth` (command/oauth/cmd.go) is the CLI's OAuth 2.0 / OIDC client. Its
main job inside the PKI workflow is to mint an **OIDC identity token** that an
OIDC provisioner accepts as a provisioning token. The token flows call it
programmatically: `generateOIDCToken`
(utils/cautils/token_generator.go:144-169) re-invokes
`step oauth --oidc --bare` with the provisioner's configuration endpoint,
client id/secret, scopes, auth params, listen address, and console flag, and
returns the token's stdout as the OTT.

## Modes of operation

The command supports four authorization flows, selected by flags:

| Flow | Selection | Mechanism |
| --- | --- | --- |
| Loopback (default) | no console flags | `DoLoopbackAuthorization` starts a local HTTP server, opens the browser, and waits on a loopback `redirect_uri` |
| Out-of-band (OOB) | `--console-flow oob` | `DoManualAuthorization` uses the `urn:ietf:wg:oauth:2.0:oob` redirect URI and reads the code from stdin |
| Device grant | `--console` or `--console-flow device` | `DoDeviceAuthorization` implements the RFC 8628 device authorization grant for input-constrained clients |
| Service account | `--account <file>` | `DoTwoLeggedAuthorization` (jwt-bearer grant) or `DoJWTAuthorization` (`--jwt`) |

When neither `--console` nor `--console-flow` is set, `--oidc` requests the
OpenID scope and the flow returns the `id_token` instead of the access token.

## Client identity and endpoints

- Default client: a preconfigured Google installed-app client
  (`defaultClientID`/`defaultClientNotSoSecret`), with a separate default pair
  for the device flow (`defaultDeviceAuthzClientID`). These are public test
  clients with no API access.
- `--client-id`/`--client-secret` override the client, and `--provider` names
  the OIDC provider. Known providers `google` and `github` map to hardcoded
  endpoints; other providers are resolved through the OIDC discovery document
  (`/.well-known/openid-configuration`, appended to the provider URL).
- `--authorization-endpoint`/`--token-endpoint`/`--device-authorization-endpoint`
  allow fully manual endpoint configuration (`--authorization-endpoint` requires
  `--token-endpoint`).
- `--account` loads a Google account JSON: `installed` apps supply
  auth/token endpoints and client credentials; `service_account` accounts switch
  to the two-legged flows using `private_key`/`private_key_id`/`client_email`.

`newOauth` generates a random `state` (32 chars), a PKCE `code_challenge`
(64 chars), and a `nonce` (64 hex chars) for every run.

## Loopback flow

`DoLoopbackAuthorization` (command/oauth/cmd.go:768-814):

1. Starts an `httptest` server (`o.NewServer`), honoring `--listen`
   (default random port, host defaults to `127.0.0.1`) and `--listen-url`
   (custom `redirect_uri`).
2. Builds the authorization URL via `o.Auth()` and opens it in the browser
   (`exec.OpenInBrowser`). With `STEP_OPEN_BROWSER=0` the URL is printed to
   stderr instead.
3. Waits on `o.tokCh`/`o.errCh` for the callback handler (`ServeHTTP`) to
   exchange the code, timing out after 2 minutes.

The callback handler validates the path and `state` parameter, exchanges the
authorization code at the token endpoint (`o.Exchange`), and delivers the
result through channels. An implicit-flow variant
(`--implicit`, requiring `--insecure`) is also implemented but hidden.

## OOB and device flows

- `DoManualAuthorization` (command/oauth/cmd.go:819-846) sets the redirect URI
  to `oobCallbackUrn`, prints the authorization URL, reads the verification code
  from stdin, and exchanges it.
- `DoDeviceAuthorization` (command/oauth/cmd.go:863-952) POSTs
  `client_id`/`client_secret`/`scope` to the device authorization endpoint,
  prints the verification URI and code (preferring `verification_uri_complete`,
  tolerating Google's non-standard `verification_url`), then polls the token
  endpoint every `interval` seconds (default 5s) until the grant succeeds,
  times out (min of server `expires_in` and default 5 minutes), or fails.

## Service-account (two-legged) flows

For `service_account` accounts, `DoTwoLeggedAuthorization` and
`DoJWTAuthorization` parse the account's PKCS8 private key, sign a JWT with
`RS256` (claims `aud`, `nbf`, `iat`, `exp`, `iss`, optional `sub`/`scope`,
`kid` header = client ID), and either exchange it at the token endpoint using
the `urn:ietf:params:oauth:grant-type:jwt-bearer` grant or return it directly
as the token (`--jwt`).

## Output

- `--bare`: prints only the token (the OIDC `id_token` with `--oidc`, otherwise
  the access token). This is the mode the token flows rely on.
- `--header`: prints `Authorization: Bearer <token>`.
- default: prints the full token struct as JSON.

## Integration with certificate issuance

Because OIDC provisioning tokens are minted by `step oauth`, using an OIDC
provisioner requires no secret handling in the certificate command: the token
carries the identity (email/claims) that the CA validates, and the resulting
certificate is issued with the subject derived from it. The `--console` flag on
certificate commands propagates to `step oauth --console`, enabling a
terminal-only flow when a browser is not available.
