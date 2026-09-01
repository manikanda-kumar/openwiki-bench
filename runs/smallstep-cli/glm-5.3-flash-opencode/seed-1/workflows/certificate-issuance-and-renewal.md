---
type: certificate-issuance-and-renewal-workflows
title: Certificate Issuance and Renewal
description: End-to-end X.509 flows — token-based issuance, ACME, offline signing, renew/rekey/revoke semantics, needs-renewal checks, and systemd automation.
tags: [certificates, x509, issuance, renewal, acme, systemd, revocation]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-c76b6b630fc34fd28a7b9612
    resource: repo://command/ca/revoke.go
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-2f8947cb371741300d028072
    resource: repo://command/certificate/lint.go
  - id: openwiki-source-8df833e7257eb456286e631b
    resource: repo://command/certificate/needsRenewal.go
  - id: openwiki-source-d369a2fc6aab1546fc84613b
    resource: repo://command/certificate/verify.go
  - id: openwiki-source-fe5b002eb6bab88c8a9f5a2c
    resource: repo://systemd/cert-renewer%40.service
  - id: openwiki-source-5b8432eb4ee5e7ab8f9f9b3a
    resource: repo://systemd/cert-renewer%40.timer
  - id: openwiki-source-c2a1cbcd354ea6d2d5d35e69
    resource: repo://systemd/README.md
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# Certificate Issuance and Renewal

## The unified issuance flow

`step ca certificate <subject> <crt-file> <key-file>` unifies online and
offline issuance through `cautils.CertificateFlow` (repo://command/ca/certificate.go#L220-L287):

1. Validate flags: `--offline` and `--token` are incompatible (the token is
   generated before the offline CA starts); `--attestation-uri` and `--kms` are
   incompatible (the ACME-DA flow expects all parameters in the attestation
   URI) (repo://command/ca/certificate.go#L232-L244).
2. `NewCertificateFlow` builds the flow struct (offline flag/CA resolved); if no
   `--token` is given it either runs the ACME flow (when `--acme` is set) or
   generates a token — and an `ACMETokenError` from the provisioner dispatch
   transparently falls back to `ACMECreateCertFlow`
   (repo://utils/cautils/certificate_flow.go#L106-L133, repo://command/ca/certificate.go#L246-L258).
3. `CreateSignRequest` generates the key pair and CSR, and binds the CSR into
   the shared flow context so the token's fingerprint claim ties the request to
   the token (repo://utils/cautils/certificate_flow.go#L297-L310,
   repo://utils/cautils/token_generator.go#L104-L109).
4. The token is parsed insecurely to branch on its type: for `JWK` tokens the
   subject must match the CSR common name (and `--token` + `--san` are mutually
   exclusive); for OIDC/AWS/GCP/Azure/K8sSA the server validates the common
   name; other token types are rejected (repo://command/ca/certificate.go#L264-L277).
5. `flow.Sign` posts the CSR and writes the certificate chain; the private key
   is serialized `0600` (repo://utils/cautils/certificate_flow.go#L250-L295,
   repo://command/ca/certificate.go#L279-L283).

The `sharedContext` (`flowContext`) carries per-command state between token
generation and signing: SSH public key, certificate request, confirmation
fingerprint, custom attributes, and `DisableCustomSANs` for cloud provisioners
(repo://utils/cautils/certificate_flow.go#L35-L54).

## ACME

`ACMECreateCertFlow` (in `utils/cautils/acme_flow.go`) implements the RFC8555
client: it can target a non-step CA via `--acme <url>`, and serves `http-01`
challenge validation either standalone (built-in HTTP server, default `:80`,
`--http-listen`) or from a `--webroot` (repo://command/ca/ca.go#L93-L140,
repo://utils/cautils/acme_flow.go). TPM device attestation (ACME-DA) is reached
from the same command via `--attestation-uri` (see
[KMS and Plugin Integrations](/openwiki/integrations/kms-and-plugins.md)).

## Offline signing

With `--offline --ca-config ca.json`, the same `CertificateFlow` uses the
embedded `OfflineCA`: the sign request is authorized and signed in-process by
`authority.Authority` (no network), with audiences and provisioners taken from
`ca.json` (repo://utils/cautils/offline.go#L196-L222, repo://utils/cautils/offline.go#L538-L599).

## Renewal semantics

`step ca renew <crt> <key>` (repo://command/ca/renew.go#L48-L170):

- Default authentication is **mTLS with the renewing certificate**; renewal
  after expiry (allowed by the CA) or `--mtls=false` switches to X5C
  token-based authentication.
- `--daemon` renews periodically — by default before 2/3 of the validity has
  elapsed — with a random jitter (duration/20) so multiple instances do not
  collide; `--expires-in` and `--renew-period` override the schedule.
- Service reload hooks: `--exec <cmd>` runs a command after renewal, and
  `--pid`/`--pid-file`/`--signal` deliver a signal to a running process.
- `--out` writes the renewed certificate to a new file instead of overwriting.
- KMS-backed keys work via `--kms` (through `cryptoutil`).

`step ca rekey` follows the same shape but supplies a new public key
(CSR) so the CA issues a certificate for a fresh key pair
(repo://utils/cautils/client.go#L35).

## Revocation

`step ca revoke <serial-number>` currently supports **passive revocation only**:
the CA prevents renewal and lets the certificate expire; CRL/OCSP (active
revocation) is not performed by this command, per the source note
(repo://command/ca/revoke.go#L31-L34). Revocation authenticates either with an
OTT token or via mTLS with the certificate/key pair (repo://command/ca/revoke.go).

## needs-renewal checks

`step certificate needs-renewal <cert|hostname>` returns exit code **0** when
the certificate needs renewal and **1** when it does not (**2** if the file is
missing, **255** for other errors). The default threshold is 66% of lifetime
elapsed (`defaultPercentUsedThreshold = 66`); `--expires-in` accepts a percent
or duration, and `--bundle` checks every certificate in the chain. The
argument can be a file or an `https://` hostname for remote checks
(repo://command/certificate/needsRenewal.go#L13-L60).

## The systemd automation contract

The shipped units compose the above commands (repo://systemd/cert-renewer@.service,
repo://systemd/cert-renewer@.timer):

- `cert-renewer@.timer` fires every 15 minutes (`OnCalendar=*:1/15`,
  `Persistent=true`, `AccuracySec=1us`) with `RandomizedDelaySec=5m` to avoid
  thundering-herd renewals.
- `cert-renewer@.service` is `Type=oneshot`: `ExecCondition` runs
  `step certificate needs-renewal ${CERT_LOCATION}` (so the service only
  renews when needed), `ExecStart` runs `step ca renew --force`, and
  `ExecStartPost` reloads or restarts the `%i` service if it exists.
- Environment is `STEPPATH=/etc/step-ca`, with cert/key paths under
  `/etc/step/certs/`. `ssh-cert-renewer` units cover SSH certificates.
- The systemd README notes these unit files are redirect targets in an S3
  bucket, so moving them requires updating those redirects
  (repo://systemd/README.md).

## Standalone certificate tooling

The `step certificate` group operates without a CA: `create` (self-signed or
CA-signed from a CSR/CA files), `sign`, `verify`, `lint`, `inspect`,
`fingerprint`, `bundle`, `format`, `p12`, `install`/`uninstall` (trust stores),
and `needs-renewal` (repo://command/certificate/certificate.go). `verify`
validates chains against `--roots`/`--intermediates`, and `lint` applies
zlint checks via the `smallstep/zlint` library (repo://command/certificate/verify.go,
repo://command/certificate/lint.go).

## Uncertainty

Server-side issuance policy (validity clamps, SAN allow-lists, template
enforcement) lives in step-ca (`smallstep/certificates`) and is not
established by this repository; the CLI only requests and receives.
