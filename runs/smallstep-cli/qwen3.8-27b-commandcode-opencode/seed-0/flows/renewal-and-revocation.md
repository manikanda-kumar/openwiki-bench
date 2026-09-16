---
type: flows
title: "Renewal, Revocation, and Rekey"
description: "step ca renew (mTLS vs token auth, expires-in jitter, daemon scheduling, pid/signal/exec hooks, offline mode), step ca revoke and rekey, the SSH equivalents (step ssh renew/rekey/revoke), and the needs-renewal checks."
tags: [renew, revoke, rekey, daemon, mtls, jitter, ssh, needs-renewal]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
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
  - id: openwiki-source-f08b96254275e2843dc7771d
    resource: repo://command/ssh/rekey.go
  - id: openwiki-source-b433bca309b52304b4f1d008
    resource: repo://command/ssh/renew.go
  - id: openwiki-source-329944bca250b823b36298c4
    resource: repo://command/ssh/revoke.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

## `step ca renew`

Takes `<crt-file> <key-file>`; the key pair is loaded KMS-aware via `tlsLoadX509KeyPair` (`cryptoutil.CreateSigner` for `--kms`, optional `--password-file`) (`command/ca/renew.go:656-678`).

### One-shot mode with jitter

If `--expires-in` is set, the certificate is renewed **only** when the remaining lifetime is within `expiresIn + jitter`, where `jitter = rand.Int63n(expiresIn/20)` (explicitly non-cryptographic random); otherwise it prints `certificate not renewed: expires in ...` and exits successfully (`command/ca/renew.go:336-344`). The renewal itself goes through the `renewer`:

- **mTLS path (default)**: the client certificate is attached to the shared `http.Transport`'s `TLSClientConfig` whenever it is not yet expired (`renew.go:445`), and `client.Renew(transport)` is called. In offline mode the same transport is passed to `OfflineCA.Renew`, which reads the certificate out of `tr.TLSClientConfig.Certificates[0]` (the mTLS carrier trick documented on the offline CA page, `utils/cautils/offline.go:226-250`).
- **Token path**: forced with `--mtls=false`, or automatically when the certificate is already expired. `RenewWithToken` builds an x5c renewal token inline (audience `<caURL>/renew`, issuer `step-ca-client/1.0`, subject = CN, chain in the `x5c` insecure-key header, signed with the leaf key), clears the transport's certificates, and closes idle keep-alive connections before calling `client.RenewWithToken` (`renew.go:621-654`).

Both write the resulting chain (PEM) to `--out` (default: overwrite `<crt-file>`) at **0600**.

### After-renew hooks

`--pid` / `--pid-file` (mutually exclusive; pid-file content is parsed as an integer, must be > 0) and `--signal` (default `SIGHUP`) plus `--exec <command>` run via `getAfterRenewFunc` after each successful renewal: `sysutils.Kill(pid, signal)` (pid 0 is a no-op) then the exec command, which is split on whitespace and run with inherited stdio (`command/ca/renew.go:382-413`).

### Daemon mode

`--daemon` forces `force=true` and loops in `renewer.Daemon`: a `select` on a signal channel (SIGINT/SIGTERM exit; **SIGHUP triggers an immediate renewal**) and `time.After(next)` (`renew.go:586-619`). The next-renewal schedule comes from `nextRenewDuration` (`renew.go:354-380`):

- With `--renew-period` (requires `--daemon`, must be shorter than the certificate validity period): renew now if expiry is within `renewPeriod`, else wait `renewPeriod`.
- Otherwise, with `--expires-in E`: wait `time.Until(NotAfter) - E`, with a random jitter of up to `period/20` subtracted (when that value is large), or a fully random time in `[0, d)` when `d < period/20`.
- With neither: `E` defaults to **one third of the certificate validity period**, i.e. the daemon renews **before 2/3 of the validity period has elapsed** — this default is stated both in the help text (`renew.go:59,215`) and in the code (`expiresIn = period / 3`).

After each renewal, `RenewAndPrepareNext` reloads the just-written chain back into the transport so the next mTLS renewal uses the fresh certificate, and logs `certificate renewed, next in ...`; errors reschedule after 1 minute (`renew.go:549-584`).

## `step ca rekey`

Same skeleton as renew but generates a **new private key** and posts `client.Rekey` (`command/ca/rekey.go:242-398`):

- Rejects expired certificates (`cannot rekey an expired certificate`); `--rekey-period` (daemon) and `--expires-in` have the same semantics and jitter as renew, and the 2/3 daemon default is stated in the help (`rekey.go:47,209`).
- New key comes from `--kty/--curve/--size` (default ECDSA P-256) via `keyutil.GenerateSigner`, or from an existing `--private-key` file loaded KMS-aware.
- **`--kms`** rekeys an existing KMS key with another key *from the same KMS*; the help states it does not support generating new keys, `--daemon`, or rekeying across different KMS instances (`rekey.go:54-57`).
- The private key is written (0600) only when no `--private-key` was given or when `--out-key` is set; the certificate always goes to `--out-cert` (default `<crt-file>`) at 0600. Offline mode is supported via the same `OfflineCA.Rekey` transport trick.

## `step ca revoke`

`step ca revoke <serial>` or `step ca revoke --cert <crt> --key <key>` (`command/ca/revoke.go:209-279`):

- `--offline` is incompatible with `--token` (same reason as certificate: the token is generated before the offline CA starts).
- With `--cert`/`--key` (mTLS revoke), no positional serial is allowed and the serial is inferred from the certificate bundle's first certificate; offline mode additionally validates the pair with `OfflineCA.VerifyClientCert` against the offline root/intermediate.
- With a serial, the value is parsed as a big.Int (any base, e.g. `0x...`) and normalized; without `--token`, a revoke token is generated through the normal token flow (subject = serial).
- `revokeFlow.getClient` checks that a supplied `--token`'s subject equals the serial (case-insensitive), pins the root by the token's `sha` claim when present, otherwise requires `--ca-url` and a root file (`revoke.go:322-376`).
- The request carries `--reason` / `--reasonCode` (mapped to OCSP codes via `ReasonCodeToNum`); offline `OfflineCA.Revoke` uses the OTT when present, otherwise the transport-certificate mTLS path (`utils/cautils/offline.go:279-313`).

## SSH equivalents

All three use the shared `CertificateFlow` and the **SSHPOP** token path: the commands set `--sshpop-cert`/`--sshpop-key` in the context (pointing at the existing SSH cert/key), which makes the token flow select an SSHPOP provisioner, and the token subject is the certificate's serial number.

- **`step ssh renew <ssh-cert> <ssh-key> [--out]`** (`command/ssh/renew.go:81-145`): host certificates only (cannot renew user certificates). Parses the SSH certificate for its serial, generates an `SSHRenewType` token, calls `client.SSHRenew`, and writes the new certificate in OpenSSH public-key format at **0644** (plus any returned identity certificate via `identity.WriteIdentityCertificate`).
- **`step ssh rekey <ssh-cert> <ssh-key>`** (`command/ssh/rekey.go:80-198`): generates a fresh default key pair (`keyutil.GenerateDefaultKeyPair`), posts `SSHRekey` with the new public key, and writes the private key (OpenSSH format, 0600, encrypted with a prompted password unless `--no-password --insecure` or `--password-file`), the public key and the rekeyed certificate (0644). With `--out X` the outputs are `X`, `X.pub`, `X-cert.pub`; otherwise they overwrite in place.
- **`step ssh revoke [serial]`** (`command/ssh/revoke.go:119-199`): zero arguments require `--sshpop-cert`/`--sshpop-key` (serial inferred from the certificate); one argument is the serial. The reason code is mapped through the same OCSP `ReasonCodeToNum` (the help documents `CertificateHold`, `RemoveFromCRL` for unrevoking, etc.). The request is sent with `Passive: true`, and the client is created with a retry function from `loginOnUnauthorized` so a 401 can trigger an `ssh login` re-authentication before retrying (see the SSH page).

## `needs-renewal` checks

- **`step certificate needs-renewal <cert-file or hostname> [--expires-in <percent|duration>] [--bundle] [--roots ...] [--servername ...]`** (`command/certificate/needsRenewal.go:148-240`): a certificate *needs renewal* when it has passed a threshold of its lifetime — **66% by default** (`defaultPercentUsedThreshold`), or when it expires within a duration (e.g. `--expires-in 1h15m`; `0s` = already expired). By default only the leaf is checked; `--bundle` checks every certificate in the chain. A URL positional argument fetches the peer chain (verified against `--roots` when given).
- **Exit codes**: `0` needs renewal, `1` does not (printed only with `--verbose`), `2` certificate file does not exist, `255` any other error (`command/certificate/needsRenewal.go:30-40,150-240`).
- **`step ssh needs-renewal <crt-file>`** (`command/ssh/needsRenewal.go:76-150`): same 66% default and exit-code contract for SSH certificates; with no argument it reads the certificate from STDIN.

The 66% default here matches the `period/3` renewal point of the daemon (`renew.go:363-366`), so a certificate renewed by `step ca renew --daemon` will report needing renewal right around the time the daemon renews it.
