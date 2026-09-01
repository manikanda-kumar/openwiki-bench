---
type: guide
title: "Change Guide: Modifying Certificate Flows"
description: Focused, code-grounded guide for changing certificate issuance and renewal behavior in the step CLI, including where the online and offline paths diverge and which tests exercise them.
tags: [guide, certificates, flows, offline]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-27d1d3b8dd01d4218df95de4
    resource: repo://command/ca/sign_test.go
  - id: openwiki-source-ff8a7fe9f3a4815e9b6b5c30
    resource: repo://command/ca/sign.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-eac4c6d87c1234945c50c143
    resource: repo://utils/cautils/offline_test.go
  - id: openwiki-source-d65498dad1900ee9e4309461
    resource: repo://utils/cautils/token_flow_test.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# Change Guide: Modifying Certificate Flows

This guide maps the certificate issuance and renewal pipeline so you can make a
change without breaking the offline path. The central idea: **one flow, two
backends**. `CertificateFlow` unifies the online HTTP client and the in-process
`OfflineCA` behind the same command actions.

## Flow entry points

Two commands drive issuance:

- `step ca certificate <subject> <crt-file> <key-file>` — `certificateAction`
  (command/ca/certificate.go:220-307). It generates the token (or routes to the
  ACME flow), builds a sign request, and writes the certificate + key.
- `step ca sign <csr-file> <crt-file>` — `signCertificateAction`
  (command/ca/sign.go:150-223). It signs an existing CSR.

Both call `cautils.NewCertificateFlow(ctx)` and then
`flow.GenerateToken(...)`, `flow.CreateSignRequest(...)` (certificate only),
and `flow.Sign(...)`. The flow type (utils/cautils/certificate_flow.go) carries
`offline bool` and an `*OfflineCA`.

## Where online and offline diverge

`NewCertificateFlow` (utils/cautils/certificate_flow.go:106-131) checks
`ctx.Bool("offline")` and, when set, requires `--ca-config` and constructs the
`OfflineCA`. Every subsequent method branches on that flag:

- `GenerateToken` → `f.offlineCA.GenerateToken(...)` vs the online
  `NewTokenFlow` (utils/cautils/certificate_flow.go:176-205).
- `GetClient` → returns `f.offlineCA` vs building the online client, including
  the token-driven trust path (`ca.WithRootSHA256`) described in the
  "CA Client Abstraction" page (utils/cautils/certificate_flow.go:134-171).
- `Sign` → calls `client.Sign(req)` on whichever client and writes the PEM chain
  (utils/cautils/certificate_flow.go:250-293). The offline client wraps
  `authority.Authorize` + `authority.SignWithContext`
  (utils/cautils/offline.go:196-222).

Rule of thumb: put shared request-construction logic in the flow (runs on both
paths), and only touch `offline.go` when the in-process authority's behavior
differs from the server API.

## Changing the CSR / SAN construction

`CreateSignRequest` (utils/cautils/certificate_flow.go:297-405) is where a
token + subject + SANs become a `*api.SignRequest`:

1. It parses the token with `token.ParseInsecure` and derives the key type from
   `utils.GetKeyDetailsFromCLI` (kty/curve/size), generating the key with
   `keyutil.GenerateKey`.
2. `splitSANs` merges `--san` values with the token's `sans` claim and splits
   into DNS/IP/email/URI via `x509util.SplitSANs`.
3. Per-token-type default SANs are injected for **AWS**, **GCP**, and **Azure**
   tokens (instance identity defaults), and OIDC tokens get email/issuer-derived
   SANs when the subject matches the token email.

If you change SAN handling, update the per-type cases here; the JWK-token
subject/CN consistency check lives in `certificateAction`
(command/ca/certificate.go:280-293).

## Changing renewal behavior

`step ca renew` (command/ca/renew.go) has its own `renewer` type:

- `newRenewer` builds an `http.Transport` with the root pool and, while the
  certificate is valid, an mTLS client cert, then creates the client
  (command/ca/renew.go:425-480).
- `renewer.Renew` (command/ca/renew.go:482-508) chooses between `r.client.Renew(r.transport)`
  (mTLS) and `r.RenewWithToken(...)` (X5C token) based on `r.mtls` and whether
  the certificate is already expired.
- `RenewWithToken` (command/ca/renew.go:624-654) builds a JWT with an `x5c`
  header of the current chain, clears the transport client cert, and calls
  `client.RenewWithToken`.
- Daemon mode (`renewer.Daemon`) loops on a timer and handles `SIGHUP` (renew
  now), `SIGINT`/`SIGTERM` (stop); scheduling uses `nextRenewDuration` with
  jitter.

Renewal request fields and the serialized chain writing are shared between the
two paths via `Renew`/`Rekey` on the client interface.

## What to test and where

- Command-level validation: `command/ca/sign_test.go`, `command/ca/init_test.go`,
  `command/ca/health_test.go` construct `cli.Context`s and assert flag/argument
  handling.
- Token/provisioner logic: `utils/cautils/token_flow_test.go` covers the flow
  that `GenerateToken` calls.
- Offline behavior: `utils/cautils/offline_test.go` exercises the `OfflineCA`.
- Certificate inspection of emitted artifacts: `command/certificate/inspect_test.go`,
  `command/certificate/remote_test.go`.

Because the flow branches on `--offline`, add test cases for **both** values
when you change request construction or signing. Prefer asserting on the
resulting `api.SignRequest`/token/claims (pure data) rather than on network
behavior; the online server interaction itself is covered by the
smallstep/certificates module's tests, not this repo's.
