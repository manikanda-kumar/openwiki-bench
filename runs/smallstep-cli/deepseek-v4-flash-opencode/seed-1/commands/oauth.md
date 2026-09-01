---
type: "Reference"
title: "step oauth command"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# step oauth command

`step oauth` implements the OAuth 2.0 authorization flow at the command line,
returning an access token (or OIDC ID token) for use by other commands and
scripts (`command/oauth/cmd.go:104-120`). It defaults to a preconfigured Google
application — the public client IDs/secret constants live in
`command/oauth/cmd.go:47-56` — but supports any provider via discovery or
explicit endpoints.

## Supported flows

The flow is selected in `oauthCmd` (`command/oauth/cmd.go:495-509`):

- **Loopback (authorization code + PKCE-like redirect)** — the default. The
  CLI runs a local HTTP listener (`--listen`, default `127.0.0.1:0`) and the
  provider redirects the browser to it.
- **Device Authorization Grant** — for input-constrained clients, selected by
  `--console` or `--console-flow device`. Uses the `--device-authorization-endpoint`
  and a polling token endpoint.
- **Out-of-Band (OOB)** — selected by `--console-flow oob`; the user manually
  pastes a verification code (`DoManualAuthorization`).
- **Service-account / two-legged** — with `--account <json>`, supports Google
  "installed" and "service_account" JSON files. Service accounts can run the
  two-legged flow or, with `--jwt`, mint a JWT-bearer grant token
  (`command/oauth/cmd.go:430-461`, `495-509`).
- **Implicit** (hidden) — requires `--insecure` and `--client-id`
  (`command/oauth/cmd.go:290-294`, `390-396`).

## Provider configuration

- `--provider`/`--idp` accepts `google`, `github`, or an `https://` discovery
  URL; anything else is rejected by `options.Validate`
  (`command/oauth/cmd.go:330-349`).
- Custom endpoints can be supplied directly: `--authorization-endpoint` and
  `--token-endpoint` (both required together), and
  `--device-authorization-endpoint` with `--token-endpoint`
  (`command/oauth/cmd.go:410-428`).
- `--client-id`/`--client-secret` override the defaults; a non-default provider
  requires `--client-id` (`command/oauth/cmd.go:366-368`, `405-408`).
- `--scope` (default `openid email`), `--prompt`, and repeated
  `--auth-param key=value` customize the authorization request
  (`command/oauth/cmd.go:463-488`).

## Output modes

After a successful exchange (`command/oauth/cmd.go:515-535`):

- **Default**: prints the full token object as indented JSON (access, ID, and
  refresh tokens plus expiry and scope).
- **`--bare`**: prints only the token; combined with `--oidc` it prints the ID
  token instead of the access token.
- **`--header`**: prints `Authorization: Bearer <token>` (with `--oidc`, the ID
  token), suitable for piping into `curl`.

The OIDC token flow used by CA enrollment re-invokes this command
(`step oauth --oidc --bare`) via `exec.Step`; see
[CA client and enrollment flows](../architecture/ca-client-flows.md).

## Interactive behavior

Without a console flow, a successful browser flow opens the system browser
(`exec.OpenInBrowser`) and the local listener captures the redirect; `--listen`
and `--listen-url` control the bound address and the `redirect_uri`. The
`--console` flag keeps everything in the terminal and defaults to the device
flow (`command/oauth/cmd.go:191-193`, `383-386`).
