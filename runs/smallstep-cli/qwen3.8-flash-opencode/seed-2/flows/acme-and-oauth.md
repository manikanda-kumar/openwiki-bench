---
type: flow
title: "ACME and OAuth Flows"
description: "How step obtains certificates over ACME (standalone/webroot http-01, device attestation, trust configuration) and how the step oauth client gets OAuth2/OIDC tokens that feed OIDC provisioners in the CA token flow."
tags: [acme, oauth, oidc, challenges, enrollment]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-ff8a7fe9f3a4815e9b6b5c30
    resource: repo://command/ca/sign.go
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-976947cfd6258da1cc5693a8
    resource: repo://utils/cautils/acme_flow.go
  - id: openwiki-source-aecab703e3710c5764638ff5
    resource: repo://utils/cautils/acmeutils.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# ACME and OAuth Flows

ACME and OAuth are the two protocol-based enrollment paths outside step's native token flow. ACME lets `step` enroll against any RFC 8555 CA (including Let's Encrypt), and `step oauth` turns identity providers into one-time tokens for OIDC provisioners.

## Entering the ACME path

ACME enrollment is reachable from the normal certificate commands, not a dedicated command: `step ca certificate` calls `cautils.ACMECreateCertFlow` when `--acme <directory-url>` is set explicitly, or automatically when token generation discovers that the selected CA provisioner is an ACME provisioner — `NewTokenFlow` returns a typed `ACMETokenError` carrying the provisioner name, and the caller converts it into an ACME flow against `<ca-url>/acme/<provisioner>/directory` (`command/ca/certificate.go:257-266`, `utils/cautils/token_flow.go:101-180`, `utils/cautils/token_flow.go:79-94`, `utils/cautils/acmeutils.go:654-662`). `step ca sign` mirrors this with `ACMESignCSRFlow` (`command/ca/sign.go:188-195`). The `step ca acme` command group is a different concern: it manages ACME settings (external account binding keys) through the admin API (`command/ca/acme/acme.go:9-20`, `command/ca/acme/eab/add.go`).

`newACMEFlow` enforces entry invariants: `--offline` and ACME are mutually exclusive, `--standalone` and `--webroot` conflict, and standalone is implicitly chosen when neither flag is given (`utils/cautils/acmeutils.go:625-641`).

## The order lifecycle in `acmeFlow.GetCertificate`

`GetCertificate` drives the RFC 8555 transaction: build an order request (dns/ip identifiers from subject + SANs; `--not-before/--not-after` supported except for Let's Encrypt, which is rejected for validity windows and additionally requires the CN to appear in the SAN list), create an ACME client, `NewOrder`, `authorizeOrder`, generate a key + CSR when one wasn't supplied, `finalizeOrder`, then fetch and write the PEM chain (`utils/cautils/acmeutils.go:710-865`, `utils/cautils/acmeutils.go:299-340`).

Client transport trust is resolved per request: an explicit `--root` is required to exist, otherwise a bootstrapped local root at `pki.GetRootCAPath()` is used; when a custom `--acme` directory was set, the local root (if any) is *merged* with the system certificate pool with TLS ≥ 1.2, and with no local material at all the system store alone is used (`utils/cautils/acmeutils.go:668-707`). Account creation/keys are handled inside `ca.NewACMEClient` from the external `certificates` module; this repository does not show that logic.

## Challenge solving

`authorizeOrder` walks each authorization and only attempts `http-01` — or `device-attest-01` when `--attestation-uri` is set — failing with "unable to validate any challenges" if neither matches (`utils/cautils/acmeutils.go:196-232`).

For `http-01`, `serveAndValidateHTTPChallenge` picks an `issueMode`:

- **Standalone**: step starts an in-process HTTP server (default `:80`, overridable with `--http-listen`) serving `/.well-known/acme-challenge/<token>` with the JWK key authorization, and shuts it down after validation (`utils/cautils/acmeutils.go:47-113`, `command/ca/ca.go:107-132`).
- **Webroot**: step writes the key authorization file into `<webroot>/.well-known/acme-challenge/` — deliberately 0755/0644 because the web server may run as a different user — and removes it in `Cleanup` (`utils/cautils/acmeutils.go:115-157`).

After posting the challenge (`ValidateChallenge`), both modes poll status at 5-second intervals, treat an early `invalid` as terminal, and surface the challenge error detail (`utils/cautils/acmeutils.go:159-192`, `utils/cautils/acmeutils.go:518-583`).

With `--attestation-uri`, the order instead identifies the subject as a `permanent-identifier`, the challenge is answered by a TPM-backed `device-attest-01` attestation (go-attestation attor+claim, CBOR-encoded; `utils/cautils/acmeutils.go:403-474`, `utils/cautils/tpm.go`), and the issued chain is written back into the TPM key's storage rather than a key file — the flow has no private key material in memory in that case (`utils/cautils/acmeutils.go:744-760`, `utils/cautils/acmeutils.go:835-862`, `utils/cautils/acme_flow.go:30-38`).

## The `step oauth` client

`step oauth` is a self-contained OAuth 2.0/OIDC client. Endpoint resolution has three tiers: built-in provider defaults (Google, GitHub — including hardcoded device-authorization endpoints), OIDC discovery against `<provider>/.well-known/openid-configuration`, or fully manual `--authorization-endpoint`/`--token-endpoint`/`--device-authorization-endpoint` triples (`command/oauth/cmd.go:550-680`, `command/oauth/cmd.go:684-708`). `--client-id` is required unless the built-in Google defaults apply (`command/oauth/cmd.go:367-369`).

Flow selection in `oauthCmd` (`command/oauth/cmd.go:371-517`):

- **Loopback authorization code** (default): an `httptest`-based local callback server binds `127.0.0.1` on an ephemeral port unless `--listen` overrides; the browser is opened and the code exchanged via `Exchange` (`command/oauth/cmd.go:729-817`).
- **Device flow** (`--console` or `--console-flow=device`): posts to the device authorization endpoint, polls the token endpoint with `urn:ietf:params:oauth:grant-type:device_code`, and errors when the code expires (`command/oauth/cmd.go:863-979`).
- **OOB** (`--console-flow=oob`): the user pastes the redirected URL manually (`command/oauth/cmd.go:819-847`).
- **Two-legged / JWT bearer** (`--account` pointing at a Google service-account JSON): signs an assertion and redeems it with `urn:ietf:params:oauth:grant-type:jwt-bearer` (`command/oauth/cmd.go:437-517`, `command/oauth/cmd.go:981-1090`).

Notable guards: `--implicit` requires `--insecure` (`command/oauth/cmd.go:394-398`), and token POSTs send `Accept: application/json` with `Connection: close` semantics specifically so GitHub returns JSON (`command/oauth/cmd.go:714-727`). Output is either the full JSON token object, a bare access/id token with `--bare`, an `Authorization: Bearer` header line with `--header`, or a JWT with `--jwt`; `--oidc` switches the selection from `access_token` to `id_token` (`command/oauth/cmd.go:517-541`).

## OAuth feeding OIDC provisioners

When the CA offers an OIDC provisioner, `generateOIDCToken` runs the token flow by *re-invoking the step binary*: `exec.Step` spawns `os.Args[0] oauth --oidc --bare --provider <configuration-endpoint> --client-id ... [--scope ...] [--auth-param ...] [--listen <provisioner-address>]`, and stdout becomes the one-time token submitted to the CA (`utils/cautils/token_generator.go:144-169`, `exec/exec.go:129-146`). Because OIDC provisioners derive the subject from the ID token's email, `NewTokenFlow` skips the SAN prompt for them (`utils/cautils/token_flow.go:127-141`), and custom SANs from the CLI are ignored for identity-provisioned types (`sharedContext.DisableCustomSANs`, `utils/cautils/token_flow.go:170-178`).

## See also

- The native token/signing pipeline that falls back into ACME: [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md)
- Flag definitions for `--acme`, `--standalone`, `--webroot`, `--contact`, `--http-listen`: [Command Framework and Registration](/openwiki/architecture/command-framework.md)
