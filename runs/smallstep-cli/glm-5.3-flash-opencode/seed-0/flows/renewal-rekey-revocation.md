---
type: workflow-page
title: Renewal, Rekey, and Revocation
description: How step ca renew, rekey, and revoke work - mTLS vs renewal-token auth, daemon scheduling, service reload hooks, needs-renewal exit codes, and the systemd units.
tags: [renew, rekey, revoke, daemon, mtls, systemd, needs-renewal]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-5cb498dbff5a2aba7f81df22
    resource: repo://command/ca/rekey.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-8df833e7257eb456286e631b
    resource: repo://command/certificate/needsRenewal.go
  - id: openwiki-source-f678876f04f1fb4fb8461d6a
    resource: repo://command/ssh/needsRenewal.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-fe5b002eb6bab88c8a9f5a2c
    resource: repo://systemd/cert-renewer%40.service
  - id: openwiki-source-5b8432eb4ee5e7ab8f9f9b3a
    resource: repo://systemd/cert-renewer%40.timer
  - id: openwiki-source-c2a1cbcd354ea6d2d5d35e69
    resource: repo://systemd/README.md
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

Certificate lifecycle maintenance in `step` is built around three CA commands and one
local predicate: `step ca renew`, `step ca rekey`, `step ca revoke`, and
`step certificate needs-renewal` (mirrored for SSH). Their scheduling semantics are
the contract behind the shipped systemd units.

## step ca renew

`renewCertificateAction` (command/ca/renew.go:233-352) takes exactly two positional
arguments, `<crt-file> <key-file>`:

- `--out` defaults to overwriting `<crt-file>` (renew.go:247-250); the root defaults
  to `pki.GetRootCAPath()` (renew.go:252-255).
- `--expires-in` and `--renew-period` are mutually exclusive, and
  `--renew-period` requires `--daemon` (renew.go:273-278). Both must be shorter
  than the certificate's own validity period (renew.go:313-321).
- `--pid` and `--pid-file` are mutually exclusive; `--signal` defaults to SIGHUP
  (renew.go:280-306, flag default at renew.go:202-207).
- The pair is loaded KMS-aware by `tlsLoadX509KeyPair` (renew.go:656-679): the
  certificate chain is read from disk, the key via `cryptoutil.CreateSigner`
  (so `--kms` URIs work, e.g. `yubikey:slot-id=9a`), with `--password-file`
  decryption.

### Authentication: mTLS vs renewal token

`newRenewer` (renew.go:425-480) builds an `http.Transport` rooted at `--root`; the
client certificate is attached for mTLS **only if the certificate is still valid**
(renew.go:444-446). Offline mode swaps in the in-process authority client
(renew.go:449-458).

`renewer.Renew` (renew.go:482-508) chooses the authentication mode: the token flow
(`RenewWithToken`) is used when `--mtls=false` **or the certificate is already
expired** (which is how renew-after-expiry works where the CA allows it), otherwise
plain mTLS `client.Renew(transport)`. The command help documents the scenarios that
force `--mtls=false`: step-ca behind an L7 proxy, leaf EKUs without clientAuth, or
a StepCAS RA upstream (renew.go:68-75).

`RenewWithToken` (renew.go:624-654) builds the provisioner-independent renewal JWT:
audience `<caURL>/renew`, issuer `step-ca-client/1.0`, subject = the leaf's common
name, and an `x5cInsecure` header carrying the full chain, signed with the
certificate's own key — the same scheme as `generateRenewToken` described by the
tokens page. It then clears the client cert from the transport and closes idle
connections so a daemon never reuses a connection that lacked a certificate
(renew.go:647-651).

The response chain (`CertChainPEM`, or `ServerPEM`+`CaPEM`) is serialized and
written with `fileutil.WriteFile(..., 0o600)` (renew.go:492-505).

### One-shot semantics

In one-shot mode with `--expires-in`, renewal is skipped when
`notAfter - now > expiresIn + rand(expiresIn/20)` — the jitter prevents thundering
herds — printing "certificate not renewed" (renew.go:336-344). Without a matching
threshold, renewal always proceeds. Overwrite confirmation is the standard
"Would you like to overwrite" prompt unless `--force` (example output at
renew.go:88-91; flag at flags/flags.go:103-106). After a successful renewal the
`--pid`/`--pid-file` target is signaled and `--exec` runs
(renew.go:328, 346-351, 382-413).

### Daemon mode

`--daemon` (renew.go:329-334) **always sets force** (`ctx.Set("force", "true")`), so
the daemon overwrites without prompting, and enters `renewer.Daemon`
(renew.go:586-619): a signal loop where SIGHUP forces an immediate renewal,
SIGINT/SIGTERM exit cleanly, and a timer renews on schedule. Each cycle runs
`RenewAndPrepareNext` (renew.go:549-584): renew, rewrite the file, rebuild the
`tls.Certificate` from the new chain (keeping the same key — renewal never changes
the key), update the transport, and compute the next delay. Renewal failures retry
after 1 minute (`durationOnErrors`, renew.go:550, 555).

`nextRenewDuration` (renew.go:354-380) defines the schedule: with `--renew-period`
it's a fixed interval (renewing immediately if the cert expires within one period);
otherwise the default is to renew after 2/3 of the validity period has elapsed
(`expiresIn = period/3`) minus a random jitter of up to `period/20`. The command
help documents this "before 2/3 of the validity period" default (renew.go:58-63,
212-218).

## step ca rekey

`rekey` mirrors renew but rotates the key. KMS-backed keys require `--private-key`
and forbid `--out-key` and `--daemon`, because new KMS keys cannot be generated
in-place (rekey.go:249-261). Expired certificates are rejected outright —
"cannot rekey an expired certificate" (rekey.go:335). The underlying
`renewer.Rekey` (renew.go:510-545) creates a CSR with an **empty** subject signed by
the new key, calls `client.Rekey`, writes the new chain to `--out-cert` (default
overwriting), and writes the new key unless it was KMS-provided.

## step ca revoke

`revoke` supports two authentications (command/ca/revoke.go:421-477): with
`--token`, the request carries the OTT; without a token, the command builds an mTLS
transport from `--cert`/`--key` (root falling back to `pki.GetRootCAPath()`,
required unless `--token`, revoke.go:447-453). The `api.RevokeRequest` always sets
`Passive: true` — revocation is passive (no CRL generation is triggered by the
client; CRL distribution is a CA-side concern) (revoke.go:470-476). Reason codes
accept RFC 5280 names (`superseded`, `keycompromise`, ...) or numbers, mapped via
`RevocationReasonCodes` (revoke.go:483-496).

## step certificate needs-renewal

`needs-renewal` is a scriptable predicate whose exit codes are its API
(command/certificate/needsRenewal.go):

- **0** — renewal needed; **1** — not needed (silent, or a message with
  `--verbose`); **2** — the certificate file does not exist; **255** — any other
  error (documented at needsRenewal.go:44-48; implemented at 144-243).
- The default threshold is **66% of the lifetime elapsed**
  (`defaultPercentUsedThreshold` at needsRenewal.go:20; percent math at 211-217).
  `--expires-in` accepts either a percent (`75%`, validated 0-100) or a Go
  duration (`1h15m`), compared against remaining validity (needsRenewal.go:184-206,
  218-220).
- `--bundle` checks every certificate in the chain instead of only the leaf
  (needsRenewal.go:222-224). The input may be a file or a URL — remote hosts are
  fetched with the shared TLS dialing helpers (needsRenewal.go:160-167).
- There is no `step ca needs-renewal`; the same command exists as
  `step ssh needs-renewal` for SSH certs.

## systemd integration

The repository ships unit files as operational examples, with a README warning that
files.smallstep.com redirects must be kept in sync (systemd/README.md).
`cert-renewer@.service` wires the predicate and renewer together
(systemd/cert-renewer@.service):

- `ExecCondition=step certificate needs-renewal ${CERT_LOCATION}` — systemd skips
  the unit when the predicate exits nonzero, which is exactly the exit-code contract
  above (systemd/cert-renewer@.service:16-19).
- `ExecStart=step ca renew --force ${CERT_LOCATION} ${KEY_LOCATION}` — force because
  oneshot units cannot answer the overwrite prompt (systemd/cert-renewer@.service:21-22).
- `ExecStartPost` reloads or restarts the `%i` service that depends on the
  certificate, tolerating a nonexistent service (systemd/cert-renewer@.service:24-27).

`cert-renewer@.timer` fires every 15 minutes with `RandomizedDelaySec=5m` for jitter
and `Persistent=true` to catch up after downtime (systemd/cert-renewer@.timer).
`ssh-cert-renewer.service`/`.timer` apply the same pattern to SSH host certificates.
This timer-based design is the systemd alternative to the built-in `--daemon` mode:
both exist because daemons die with their hosts, while timers survive reboots; the
repository does not mandate one over the other.

## Representative tests

The rekey/renew command paths lack dedicated unit tests in this repository;
`--signal`/kill behavior is factored through `utils/sysutils.Kill`
(command/ca/renew.go:391-399). Behavior claims here are source-derived; the exit
codes of `needs-renewal`, being documented API, are also asserted by the command's
own help text.
