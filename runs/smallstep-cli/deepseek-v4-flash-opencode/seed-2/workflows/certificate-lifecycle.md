---
type: workflow
title: Certificate Renewal, Rekey and Revocation
description: Lifecycle operations for issued certificates — step ca renew (mTLS vs X5C token, daemon loop, pid/signal/exec hooks), step ca rekey, and step ca revoke (token vs mTLS, passive revocation, reason codes).
tags: [workflow, certificates, renewal, revocation]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-5cb498dbff5a2aba7f81df22
    resource: repo://command/ca/rekey.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# Certificate Renewal, Rekey and Revocation

Once a certificate is issued, the CLI provides three lifecycle operations.
Renewal and rekey share the same `renewer` machinery; revocation is a separate
flow.

## step ca renew

`step ca renew <crt-file> <key-file>` (command/ca/renew.go) contacts the CA and
writes a new certificate, overwriting `<crt-file>` or using `--out`.

### Client and transport setup

`newRenewer` (command/ca/renew.go:425-480) loads the cert/key pair, builds an
`http.Transport` with a root pool (`--root` or the default root path) and, while
the certificate is still valid, sets `TLSClientConfig.Certificates` for mTLS. It
then creates the client — `ca.NewClient(caURL, ca.WithTransport(tr))` online, or
`cautils.NewOfflineCA` with `--offline`.

### Authentication mode

`renewer.Renew` (command/ca/renew.go:482-508) chooses the authentication path:

- **mTLS** (`r.client.Renew(r.transport)`): used when `--mtls` is true (the
  default) and the certificate is not yet expired.
- **X5C token** (`r.RenewWithToken`): used when `--mtls=false` or the
  certificate is already expired (renewal after expiry). It builds a JWT with an
  `x5c` header containing the current chain, removes the client cert from the
  transport, and calls `client.RenewWithToken(tok)`.

The renewed chain is serialized and written with mode 0600.

### Scheduling and daemon mode

- Non-daemon: when `--expires-in` is set, renewal is skipped (with a message)
  if the certificate expires later than `expires-in + jitter`, where
  `jitter = expires-in/20` (command/ca/renew.go:336-344).
- `--daemon`: `nextRenewDuration` (command/ca/renew.go:354-380) schedules the
  next attempt. With `--renew-period` it uses that fixed period; otherwise it
  renews `expires-in` (default 1/3 of validity) before expiry, adding jitter of
  up to `validity/20`. `renewer.Daemon` (command/ca/renew.go:586-619) loops on
  a timer and signals: `SIGHUP` triggers an immediate renew
  (`RenewAndPrepareNext`), `SIGINT`/`SIGTERM` stop the daemon. On failure it
  logs to stderr and retries after one minute. `RenewAndPrepareNext` updates the
  in-memory certificate and transport so the next mTLS renewal uses the new cert.
- Hooks: `--pid`/`--pid-file` + `--signal` (default SIGHUP) and `--exec` run
  after each successful renewal (`getAfterRenewFunc`).

## step ca rekey

`step ca rekey <crt-file> <key-file>` (command/ca/rekey.go) issues a new
certificate for a **new key** (a new key pair is generated, or one is supplied
with `--private-key`) via the CA's rekey endpoint, writing `<crt-file>`
(`--out-cert`) and the new key (`--out-key`).

- KMS keys: when `--kms` is set or the key file is a KMS URI, `--private-key`
  is required, and `--out-key`/`--daemon` are rejected because the CLI cannot
  generate or store new KMS keys (command/ca/rekey.go:252-261).
- Validation mirrors renew: `--expires-in` and `--rekey-period` are mutually
  exclusive, `--rekey-period` requires `--daemon`, and the period must be
  shorter than the certificate validity. Expired certificates cannot be rekeyed.
- `renewer.Rekey` (command/ca/renew.go:510-545) builds an empty CSR from the new
  signer and calls `r.client.Rekey(&api.RekeyRequest{CsrPEM}, r.transport)`,
  then writes the new certificate and (when a key was generated or `--out-key`
  was given) the new private key.
- Daemon mode reuses the same `renewer.Daemon` scheduling/signal loop, calling
  `Rekey` instead of `Renew`.

## step ca revoke

`step ca revoke <serial-number>` (command/ca/revoke.go) revokes a certificate.
The code explicitly documents that only **passive revocation** is supported:
the certificate can no longer be renewed but stays valid for its remaining
lifetime (no CRL/OCSP generation).

### Authorization

A revocation request can be authorized in two ways:

- **JWK provisioner token**: with just a serial number, the command
  transparently generates a revoke token (`cautils.NewTokenFlow` with
  `RevokeType`, audience `/1.0/revoke`) via a prompted provisioner. The token
  subject must equal the serial number.
- **mTLS**: with `--cert` and `--key`, the client certificate itself
  authorizes the request; the serial is inferred from the certificate. In
  offline mode the pair is validated against the offline root and intermediate
  (`OfflineCA.VerifyClientCert`).

Certificates issued through an OIDC provisioner cannot be revoked by serial
number (documented in the command help).

### Serial and reason codes

- The serial number is parsed with `big.Int.SetString(sn, 0)`, accepting base 10
  or a prefixed representation, and normalized.
- `--reasonCode` accepts an integer 0-9 (OCSP/RFC 5280 codes) or a case-insensitive
  name (`KeyCompromise`, `CACompromise`, `AffiliationChanged`, `Superseded`,
  `CessationOfOperation`, `CertificateHold`, `RemoveFromCRL`,
  `PrivilegeWithdrawn`, `AACompromise`, `Unspecified`), mapped by
  `ReasonCodeToNum` (command/ca/revoke.go:498-522).
- The request is sent with `Passive: true`; the reason text/code and the token
  (or mTLS transport) are included in the `api.RevokeRequest`.

### Failure handling

`--offline` combined with `--token` is rejected; `--cert`/`--key` requires both
flags and forbids positional serial/token arguments. The reason code is
validated at the very start of the action so invalid input fails fast.
