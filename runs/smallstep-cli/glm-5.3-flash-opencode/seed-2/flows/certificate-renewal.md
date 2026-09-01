---
type: flow
title: Certificate Renewal and Lifecycle
description: How step ca renew, rekey, and revoke keep certificates fresh — mTLS vs token authentication, the daemon timing model with jitter, reload hooks, and the systemd cert-renewer units.
tags: [renewal, rekey, revoke, daemon, systemd, lifecycle]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-5cb498dbff5a2aba7f81df22
    resource: repo://command/ca/rekey.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-8df833e7257eb456286e631b
    resource: repo://command/certificate/needsRenewal.go
  - id: openwiki-source-fe5b002eb6bab88c8a9f5a2c
    resource: repo://systemd/cert-renewer%40.service
  - id: openwiki-source-5b8432eb4ee5e7ab8f9f9b3a
    resource: repo://systemd/cert-renewer%40.timer
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# Certificate Renewal and Lifecycle

## `step ca renew`: authentication modes

`step ca renew <crt-file> <key-file>` loads the certificate/key pair (the key
may live in a KMS — `tlsLoadX509KeyPair` routes through
`internal/cryptoutil.CreateSigner`, honoring `--kms` and `--password-file`)
and builds a `renewer` around either the offline CA or an online client whose
HTTP transport carries the certificate as a client certificate (TLS 1.2
minimum, proxy from environment).

Which authentication is used on the wire is decided per attempt in
`renewer.Renew`:

- **mTLS** (default, `--mtls` is a boolean-true flag): the current certificate
  is attached to the transport and `client.Renew(transport)` performs a
  certificate-authenticated renewal. The certificate is attached only while
  it is still valid (`time.Now().Before(NotAfter)`).
- **Token flow** (`--mtls=false`, or automatically when the certificate is
  already expired): `RenewWithToken` builds a JWT with audience
  `<ca-url>/renew`, issuer `step-ca-client/1.0`, subject from the leaf CN,
  and the certificate chain in the `x5cInsecure` header, signed with the
  certificate's private key. The transport's client certificate is cleared
  and idle connections closed before calling `client.RenewWithToken(tok)`,
  so daemon mode never reuses a certificate-less connection incorrectly.

The renewed chain is written with `fileutil.WriteFile` (mode `0600`), to
`--out` or over the input certificate.

## Daemon mode and the timing model

With `--daemon`, force is implied and the command enters `renewer.Daemon`, a
loop that renews on a timer and reacts to signals:

- `SIGHUP` triggers an immediate renewal; `SIGINT`/`SIGTERM` exit cleanly.
- Each cycle runs `RenewAndPrepareNext`, which renews, reloads the new chain
  into the TLS transport for the next cycle, and computes the next delay.

The initial delay comes from `nextRenewDuration`:

- `--renew-period <duration>` (daemon-only, must be shorter than the
  certificate validity): renew when the remaining lifetime drops to the
  period, i.e. at most every `renew-period`.
- Otherwise the default window is the last **third** of the validity period
  (`expiresIn = period/3`): "renew before 2/3 of the validity has elapsed".
  A non-cryptographic random jitter bounded by `period/20` is subtracted so
  multiple instances do not hammer the CA simultaneously; if the remaining
  time is already inside the window, renewal happens immediately (with a
  sub-window random delay when the gap is smaller than `period/20`).
- `--expires-in <duration>` overrides that window (mutually exclusive with
  `--renew-period`; both must be smaller than the certificate's validity).

On errors the daemon waits a fixed 1 minute before retrying; every successful
renewal is logged to stdout (`INFO: ... certificate renewed, next in ...`).

## Reload hooks

After each renewal, `getAfterRenewFunc` runs the side effects (also in
one-shot mode):

- `--pid <pid>` or `--pid-file <file>` (mutually exclusive) signal that PID
  with `--signal` (default `SIGHUP`, must be positive).
- `--exec "<command>"` runs the command (split on spaces) with inherited
  stdio — e.g. `--exec "nginx -s reload"`.

## Non-daemon behavior

Without `--daemon`, renewal is skipped when the remaining lifetime exceeds
`--expires-in` plus a `duration/20` jitter, printing
`certificate not renewed: expires in <duration>` and exiting successfully;
otherwise one renewal runs and the reload hooks execute.

## `step ca rekey` and `step ca revoke`

- **rekey** (`command/ca/rekey.go`) generates a fresh key (or uses
  `--private-key`/KMS sources), creates a CSR, calls `client.Rekey` over the
  mTLS transport, writes the new certificate (and optionally the new key,
  mode `0600`), and shares the daemon/signaling machinery with renew.
- **revoke** (`command/ca/revoke.go`) accepts a serial number with either a
  `--token` (one-time token, possibly created by `step ca token --revoke`),
  or `--cert`/`--key` for certificate-authenticated revocation, and calls
  `client.Revoke`.

## `step certificate needs-renewal`

`needs-renewal` is the exit-code primitive the systemd units build on: it
returns `0` if the certificate (from a file or a live TLS endpoint) expires
within the threshold, `1` if not, `2` if the certificate cannot be read, and
`255` for invalid flags. The `--expires-in` threshold is a duration or a
percentage of the total validity (default `66%`, i.e. the same 2/3 rule),
with `--bundle` to check every certificate in order.

## systemd integration

The repository ships units that operationalize renewal under
`/etc/step-ca`:

- `cert-renewer@.timer` runs every 15 minutes with `RandomizedDelaySec=5m`
  and `Persistent=true`.
- `cert-renewer@.service` is a oneshot: `ExecCondition` runs
  `step certificate needs-renewal ${CERT_LOCATION}` (so renewal only happens
  inside the window), `ExecStart` runs
  `step ca renew --force ${CERT_LOCATION} ${KEY_LOCATION}`, and
  `ExecStartPost` reloads the `%i` service if it is active.
- `ssh-cert-renewer.service`/`.timer` do the same for SSH certificates, and
  `cert-renewer.target` groups the units.
