---
type: operations
title: "Renewal Automation and systemd Units"
description: "How step ca renew works as a one-shot and daemon with jittered scheduling, mTLS vs token auth, post-renewal signals and exec hooks, the needs-renewal 66% gate, and the shipped systemd timer/service units for certificate and SSH host renewal."
tags: [renewal, daemon, systemd, certificates, operations]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-8df833e7257eb456286e631b
    resource: repo://command/certificate/needsRenewal.go
  - id: openwiki-source-f678876f04f1fb4fb8461d6a
    resource: repo://command/ssh/needsRenewal.go
  - id: openwiki-source-fe5b002eb6bab88c8a9f5a2c
    resource: repo://systemd/cert-renewer%40.service
  - id: openwiki-source-5b8432eb4ee5e7ab8f9f9b3a
    resource: repo://systemd/cert-renewer%40.timer
  - id: openwiki-source-c2a1cbcd354ea6d2d5d35e69
    resource: repo://systemd/README.md
  - id: openwiki-source-9020540fb27726d612ddfbad
    resource: repo://systemd/ssh-cert-renewer.service
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# Renewal Automation and systemd Units

Long-lived deployments keep certificates fresh either with `step ca renew --daemon` (a built-in scheduler) or with the shipped systemd timers that poll `needs-renewal` and renew on the 15-minute mark. Both paths share the same timing math and the same auth fallback.

## One-shot vs daemon scheduling semantics

`step ca renew` computes a schedule from the leaf certificate's validity period `period = notAfter - notBefore`, defaulting `--expires-in` to `period / 3` — i.e. renew once two-thirds of the lifetime has elapsed (`command/ca/renew.go:363-366`). `--renew-period` (fixed interval) and `--expires-in` are mutually exclusive, and `--renew-period` only makes sense with `--daemon`; both must be smaller than the certificate's validity window or validation errors (`command/ca/renew.go:262-321`).

`nextRenewDuration` turns that into a delay before the next attempt (`command/ca/renew.go:355-380`):

- `--renew-period`: return it verbatim, or `0` when the certificate would expire inside that window.
- otherwise, with `d = remaining - expiresIn`: renew immediately if `d <= 0`; if `d < period/20`, return a *uniform random* delay in `[0, d)`; else return `d` minus random jitter up to `period/20`. The jitter exists so fleets don't stampede the CA (README of the timer units uses the same thundering-herd rationale).

In non-daemon mode, `--expires-in` instead acts as a skip gate: renewal is silently skipped (exit 0) when the remaining lifetime exceeds `expiresIn` plus random jitter of `expiresIn/20` (`command/ca/renew.go:340-347`).

The daemon loop logs `first renewal in …`, then blocks on a timer or signals: `SIGINT`/`SIGTERM` exit cleanly, `SIGHUP` forces an immediate renew-and-reschedule cycle, and any renew error is retried after a fixed one minute while the loop keeps running (`command/ca/renew.go:586-618`, `command/ca/renew.go:549-556`). After a successful renewal the daemon re-reads the written chain, swaps it into the live TLS transport, and recomputes the next delay from the *new* leaf (`command/ca/renew.go:549-583`). Daemon mode also force-enables `--force` so output files are overwritten (`command/ca/renew.go:371-374`).

## Post-renewal hooks

`getAfterRenewFunc` composes two actions run after each successful renewal: `runKillPid` sends `--signal` (default `SIGHUP`) to the PID from `--pid` or read from `--pid-file` (the two are mutually exclusive, values must be > 0), then `runExecCmd` runs the `--exec` string as a whitespace-split command wired to step's stdio — the documented pattern for reloading nginx etc. (`command/ca/renew.go:382-408`). A failed `--exec` (e.g. the format-conversion example in the help text) is logged by the daemon but doesn't stop it (`command/ca/renew.go:148-157`).

## Authentication: mTLS first, token fallback

The renewer builds an `http.Transport` with the cert/key pair (TLS ≥ 1.2, proxy from environment), attaching the client certificate only while the current one is still valid, and creates either the online `ca.Client` or an `OfflineCA` (`command/ca/renew.go:425-480`). Per attempt it calls `client.Renew(transport)` when the `BoolT --mtls` flag is on, or `RenewWithToken(cert)` otherwise — the latter minting the `x5c-insecure` renewal token described in [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md), so an expired-but-renewable path still works if the CA accepts it (`command/ca/renew.go:482-487`, `command/ca/renew.go:621-653`, `command/ca/renew.go:166-169`). `--kms` supports keys that can't be read as files.

## The needs-renewal gate

`step certificate needs-renewal` (and `step ssh needs-renewal`) exit nonzero when a certificate has passed **66%** of its lifetime by default, tunable via `--expires-in` as a percentage or duration, with `--bundle` checking every element and remote-URL inputs supported (`command/certificate/needsRenewal.go:20-68`, `command/ssh/needsRenewal.go:20-49`). These commands are what the systemd units use as cheap `ExecCondition` gates, and what automation can poll without renewal side effects (`step ca needs-renewal` also exists under `certificate`).

## Shipped systemd units

`systemd/README.md` warns that these files are **redirect targets in the files.smallstep.com S3 bucket** — relocating them requires updating the bucket redirects — and that renewal documentation lives in the step-ca docs, not here (`systemd/README.md`).

The X.509 path is a *templated pair* + grouping target:

- `cert-renewer@.timer`: `OnCalendar=*:1/15` (every hour at :01/:16/:31/:46), `Persistent=true` (catch-up after downtime), `AccuracySec=1us`, and `RandomizedDelaySec=5m` jitter, `PartOf=cert-renewer.target` (`systemd/cert-renewer@.timer`).
- `cert-renewer@.service`: `Type=oneshot` as root with `STEPPATH=/etc/step-ca` and `CERT_LOCATION=/etc/step/certs/%i.crt`, `ExecCondition=step certificate needs-renewal` gates the run, `ExecStart=step ca renew --force`, and `ExecStartPost` issues `systemctl try-reload-or-restart %i` only if a service named after the instance is active — the instance name `%i` is simultaneously the cert basename and the dependent service (`systemd/cert-renewer@.service`).

The SSH path (`ssh-cert-renewer.service`/`.timer`) is a fixed (non-templated) equivalent: `step ssh needs-renewal` / `step ssh renew --force` over `/etc/ssh/ssh_host_ed25519_key-cert.pub`, then `try-reload-or-restart sshd` with a comment that some distros name the unit `ssh.service` (`systemd/ssh-cert-renewer.service`). The SSH `renew` itself authenticates with the certificate via an SSHPOP token (see [SSH Certificate Workflows](/openwiki/flows/ssh-certificates.md)).

## Choosing a mode

Use `--daemon` (or `exec.RunWithPid`-style PID files via `--pid-file` interplay) when the certificate must be renewed at precise, jittered points without a unit per cert; use the timers when systemd is available, since the units add persistence across reboots (`Persistent=true`), crash isolation, and the `ExecCondition` cheap-poll — and note the daemon's one-minute retry interval means transient CA outages never kill the loop (`command/ca/renew.go:549-556`).

## See also

- [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md)
- [SSH Certificate Workflows](/openwiki/flows/ssh-certificates.md)
- [Build, Packaging, and Release Pipeline](/openwiki/operations/build-and-packaging.md) — how these units reach hosts
