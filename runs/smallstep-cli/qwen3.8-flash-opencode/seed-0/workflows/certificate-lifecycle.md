---
type: workflow
title: Certificate Issuance and Renewal Workflows
description: End-to-end X.509 lifecycle in step — ca certificate/sign/renew/rekey/revoke, offline ca.json signing, local step certificate create/sign, and the ACME http-01 and device-attest-01 issuance paths with EAB management.
tags: [certificates, lifecycle, acme, renewal, revocation, offline]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-9335ab9a0351c4e07a0bf3d1
    resource: repo://command/ca/acme/eab/add.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-4efb704564fc803c8fbd8399
    resource: repo://command/certificate/sign.go
  - id: openwiki-source-976947cfd6258da1cc5693a8
    resource: repo://utils/cautils/acme_flow.go
  - id: openwiki-source-aecab703e3710c5764638ff5
    resource: repo://utils/cautils/acmeutils.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---

# Certificate Issuance and Renewal Workflows

This page traces the X.509 certificate lifecycle as implemented across
`command/ca`, `command/certificate`, and `utils/cautils`. The shared
client/flow machinery is described in
[CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md);
here we follow the user-visible paths.

## Issue: `step ca certificate <subject> <crt> <key>`

`certificateAction` (command/ca/certificate.go:220-310):

1. Arity: 2–3 args (subject + crt + key; key optional only with
   `--attestation-uri`).
2. Conflict rules: `--offline` with `--token` is rejected ("the token is
   generated before the start of the offline CA"), as are
   `--attestation-uri` + `--kms` (the ACME-DA flow wants all parameters in the
   attestation URI).
3. `cautils.NewCertificateFlow` unifies online/offline. With no `--token`:
   an explicit `--acme` URL goes straight to `ACMECreateCertFlow`; otherwise
   `flow.GenerateToken` runs the provisioner token flow — and when the
   selected provisioner turns out to be ACME, the `ACMETokenError` is caught
   and the flow **automatically pivots to ACME** for that provisioner
   (certificate.go:251-261).
4. `flow.CreateSignRequest` builds key + CSR with token-aware default SANs;
   for JWK tokens the CLI additionally enforces that the subject matches the
   CSR common name and forbids `--token` + `--san` together, while cloud/OIDC
   types defer validation to the server (certificate.go:273-291).
5. `flow.Sign` POSTs the sign request (or signs offline) and writes the chain;
   the private key is serialized separately with `pemutil.ToFile(keyFile,
   0600)` (certificate.go:293-301).

`step ca sign <csr> <crt>` is the variant for existing CSRs, merging CSR and
`--san` values (`mergeSans`, command/ca/sign.go:225) and using the same
flow/token machinery.

## Renew and rekey: `step ca renew`

Renewal authenticates with the certificate itself over mTLS:

- Load cert/key (KMS-aware via `tlsLoadX509KeyPair`, renew.go:656), default
  root to `pki.GetRootCAPath()`, require https `ca-url`
  (renew.go:233-262).
- `--daemon` loops with `nextRenewDuration` scheduling (renew.go:354-380,
  586); `--expires-in` and `--renew-period` are mutually exclusive, and
  `--renew-period` requires `--daemon` (renew.go:264-278).
- Post-renewal hooks: `--pid <n>` sends the configured signal (default
  SIGHUP) to the process owning the cert; `--pid-file` reads the PID from a
  file (mutually exclusive with `--pid`); `--exec <cmd>` runs a command after
  each successful renewal (renew.go:280-300, 382-423) — this is what the
  systemd renewer units rely on (see
  [SSH Certificate Workflows](/openwiki/workflows/ssh-certificates.md)).
- `newRenewer` (renew.go:425-481) transparently uses the token-based renewal
  endpoint (`RenewWithToken`, minted by `generateRenewToken` with
  `--x5c-cert/--x5c-key`) when the CA advertises support, falling back to
  plain mTLS `Renew` (renew.go:482-548, 624). `step ca rekey` follows the
  same shape with `Rekey`, generating a fresh keypair and optionally
  overwriting the key file (renew.go:510-548, command/ca/rekey.go:234).

## Revoke: `step ca revoke`

`revokeCertificateAction` (command/ca/revoke.go:210-286) accepts either a
positional **serial** (any numeric base; normalized to base-10) or a
**`--cert`/`--key` pair** (must be the only arguments; serial is derived from
the leaf; these paths are incompatible with `--token`/serial). With neither a
token nor mTLS credentials, it generates a revoke token first
(`RevokeType`) via the flow. `--reason`/`--reason-code` are validated early
through `ReasonCodeToNum` (revoke.go:216, 502). Offline mode validates the
cert/key pair against the ca.json root and intermediate pools through
`OfflineCA.VerifyClientCert` before signing the revocation in-process
(revoke.go:297-321, utils/cautils/offline.go:96-138).

## Offline issuance

All `step ca` issuance commands accept `--offline` (+ `--ca-config`,
default `$(step path)/config/ca.json`): tokens are generated locally and the
certificates **authority** embedded in `OfflineCA` performs
authorize+sign without any network (utils/cautils/offline.go:196-222). Because
the singleton `OfflineCA` must exist before its tokens can be minted,
`--offline` combined with an externally supplied `--token` is rejected in
`step ca certificate` and `step ca revoke`.

## Local self-service: `step certificate create` / `sign`

Independent of any CA client, `command/certificate/create.go` mints
self-signed roots, intermediates, leaves, and CSRs from x509util profiles
(`--profile root-ca|intermediate-ca|leaf|self-signed|csr`; `self-signed`
requires `--subtle`, create.go:168-240), with `--template`, validity flags,
and KMS-backed keys (`--key 'yubikey:...'`, create.go:340).
`step certificate sign <csr> <ca-crt> <ca-key>` signs locally with the given
issuer using the same profile machinery (`--profile leaf` default,
`--bundle` appends the issuer, `--path-len` for intermediates,
command/certificate/sign.go:77-113, 178-181). These are the offline building
blocks the CA commands replace with remote calls.

## ACME issuance (`--acme` / ACME provisioner pivot)

`cautils.ACMECreateCertFlow`/`ACMESignCSRFlow`
(utils/cautils/acme_flow.go:13-59) drive an RFC 8555 order:

- `newACMEFlow` **forbids `--offline`**; exactly one of `--standalone` or
  `--webroot` must be set, defaulting to standalone (acmeutils.go:625-641).
- The directory URL is `--acme` verbatim, or derived as
  `$(ca-url)/acme/<provisioner-name>/directory` from the token-flow error's
  provisioner name (acmeutils.go:655-662, command/ca/certificate.go:255-260).
- **http-01**: standalone mode serves
  `/.well-known/acme-challenge/<token>` from an embedded HTTP server
  (acmeutils.go:47-58, `standaloneMode.Run` at 94-107); webroot mode writes
  the key-auth file under `<dir>/.well-known/acme-challenge/` and removes it
  in `Cleanup` (acmeutils.go:110-157). Only http-01 and `device-attest-01`
  are implemented; if no challenge validates, the flow errors per identifier
  (acmeutils.go:160-228).
- **Trust handling:** the ACME client prefers an explicit `--root`, else the
  STEPPATH root when present merged into the system pool, else the system
  pool alone (TLS ≥ 1.2) (acmeutils.go:667-708).
- **Order shape:** identifiers are DNS/IP; for non-Let's Encrypt directories
  the order carries `notBefore`/`notAfter` from `--not-before/--not-after`,
  while Let's Encrypt URLs reject those fields and force the subject into the
  SAN list (acmeutils.go:311-345).
- **Attestation:** with `--attestation-uri` (e.g. a TPM key) the flow performs
  the `device-attest-01` challenge using the attestation CA settings, and no
  private key file is written (the key lives in the TPM)
  (acmeutils.go:398-530, acme_flow.go:27-38).

EAB is managed server-side rather than consumed by this flow:
`step ca acme eab add|list|remove` create/bind/delete External Account
Binding keys through the admin API and print `key-id` + base64url raw key +
reference (`CreateExternalAccountKey`,
command/ca/acme/eab/add.go:60-95); the `--eab-key-id/--eab-key-reference`
flags in this repo scope `step ca policy acme ...` actions to an account
(command/ca/policy/actions/dns.go:78-79).

## File-writing conventions

Issued material is written owner-only: certificate chains via
`fileutil.WriteFile(..., 0o600)` and keys via
`pemutil.ToFile(keyFile, 0600)` (utils/cautils/certificate_flow.go:284-292,
command/ca/certificate.go:299-301). The actual CA bootstrap file writes are
performed by the external `certificates/pki` package during `step ca init`.

## Failure behavior summary

| Failure | Observed handling |
| --- | --- |
| No provisioner configured on CA | `cannot create a new token: the CA does not have any provisioner configured` (token_flow.go:320-322) |
| ACME/SCEP selected for token flow | dedicated errors; ACME auto-pivots in `step ca certificate` (token_flow.go:176-179, certificate.go:255-260) |
| Token subject mismatch (JWK) | client-side error before any request (certificate.go:282-284) |
| No challenge validated (ACME) | per-identifier error listing challenge problems (acmeutils.go:225-229) |
| Bad `--offline` + `--token` combo | `errs.IncompatibleFlagWithFlag` (certificate.go:238-240, revoke.go:222-225) |

## See also

- [CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)
- [Provisioning Tokens (token package)](/openwiki/core/token-package.md)
- [CA Administration Commands](/openwiki/workflows/ca-administration.md)
