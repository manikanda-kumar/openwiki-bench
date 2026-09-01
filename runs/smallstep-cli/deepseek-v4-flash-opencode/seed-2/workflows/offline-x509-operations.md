---
type: workflow
title: Offline X.509 Operations
description: The step certificate command group for creating, signing, verifying, inspecting, and fingerprinting X.509 certificates and CSRs without a CA, including profiles and templates.
tags: [workflow, x509, certificates, templates]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-dd2083e3bfe29218ac712f40
    resource: repo://command/certificate/fingerprint.go
  - id: openwiki-source-d273a7589f0c5b5726260073
    resource: repo://command/certificate/inspect.go
  - id: openwiki-source-4efb704564fc803c8fbd8399
    resource: repo://command/certificate/sign.go
  - id: openwiki-source-d369a2fc6aab1546fc84613b
    resource: repo://command/certificate/verify.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# Offline X.509 Operations

The `step certificate` command group (command/certificate/certificate.go)
performs local, standalone X.509 work — no CA involved. It covers creating
certificates and CSRs, signing CSRs with a local issuer, verifying, inspecting,
fingerprinting, linting, installing, and bundling certificates.

## Command surface

Subcommands: `create`, `sign`, `verify`, `inspect`, `fingerprint`, `lint`,
`bundle`, `format`, `key`, `install`/`uninstall`, `needs-renewal`, `p12`, and
`remote`. Two of these are the "big" generators:

- `step certificate create <subject> <crt-file> <key-file>` — generates a key
  and a certificate **or** CSR.
- `step certificate sign <csr-file> <crt-file> <key-file>` — signs an existing
  CSR with a local issuer certificate/key.

## Profiles and defaults (create)

`createAction` (command/certificate/create.go:495-771) selects behavior by
`--profile` (default `leaf`). Supported profiles are `leaf`, `self-signed`,
`intermediate-ca`, `root-ca`, and `csr` (command/certificate/create.go:25-39):

| Profile | Default template | Default validity |
| --- | --- | --- |
| `leaf` | `x509util.DefaultLeafTemplate` | 24h |
| `self-signed` | `x509util.DefaultLeafTemplate` | 24h (requires `--subtle`) |
| `intermediate-ca` | `x509util.DefaultIntermediateTemplate` | 10 years |
| `root-ca` | `x509util.DefaultRootTemplate` | 10 years |
| `csr` | `x509util.DefaultCertificateRequestTemplate` | n/a |

Key generation defaults to EC P-256 (kty/curve/size flags, with RSA enforcing a
2048-bit minimum unless `--insecure`). With `--key` an existing key is loaded
via `cryptoutil.CreateSigner` (or just its public part when it is a public key,
in which case `--skip-csr-signature` is required).

`parseSigner` resolves the issuing certificate/`--ca`/`--ca-key`/`--ca-kms`:
for `leaf` and `intermediate-ca` the `--ca`/`--ca-key` flags are required; for
`root-ca` and `self-signed` they are rejected. Templates make `--ca` optional.

`--bundle` appends the parent certificate to the output (leaf only).

### CSR mode

With `--csr`, the command creates a CSR instead: the subject is used as the
default SAN, `--bundle`/`--ca`/`--ca-key`/`--not-before`/`--not-after` and
non-leaf profiles are rejected, and the CSR is written via
`x509util.NewCertificateRequest`.

### Templates and template data

A `--template` file (Go `text/template` + Sprig, over an x509util certificate
or certificate request JSON model) replaces the profile defaults; `--profile`
and `--template` are mutually exclusive. `.Subject` and `.SANs` are the built-in
template variables; `--set key=value` and `--set-file file.json` populate
`.Insecure.User` via `flags.GetTemplateData`.

## Signing a CSR (sign)

`signAction` (command/certificate/sign.go:237-397) validates the CSR signature,
loads the issuer chain and signer (`cryptoutil.LoadCertificate`/`CreateSigner`),
and checks that the issuer is a CA with `keyCertSign` usage
(`validateIssuer`), plus path-length constraints for `intermediate-ca`
profiles. Profiles are `leaf` (default), `intermediate-ca`, and `csr` (signs
the CSR as-is without injecting usages). `--path-len` sets the
pathLenConstraint (-1 = unlimited). `--omit-cn-san` prevents the CSR common
name from being added as a SAN when the CSR has no SANs.

Validity defaults: `--not-after` defaults to `not-before + 24h` for leaf/CSR
and `+ 10 years` for intermediate. `--bundle` appends the issuer chain. Output
is printed to stdout; use `--out`/shell redirection to capture it.

## Verification (verify)

`verifyAction` (command/certificate/verify.go:149-378) runs the RFC 5280 path
validation algorithm and exits non-zero on failure. It accepts a local file or
a URL (fetching the peer certificate over TLS, `--servername`, `--roots`).

- Path validation uses `--roots` (file, comma-separated list, or directory) or
  the OS default trust store, and treats extra certificates in the bundle as
  intermediates.
- `--host` also validates the certificate's hostname.
- **CRL verification** (`--verify-crl`): downloads the CRL from
  `--crl-endpoint` or the certificate's CRL distribution points, parses it,
  verifies its signature against the issuing CA (unless `--insecure`), and
  rejects the certificate if its serial is listed.
- **OCSP verification** (`--verify-ocsp`): posts an OCSP request to
  `--ocsp-endpoint` or the certificate's AIA OCSP servers and rejects on a
  `revoked` status.
- The issuing CA comes from `--issuing-ca` or the certificate's
  `IssuingCertificateURL` AIA extension when either revocation check is enabled.

## Inspect and fingerprint

- `inspect` prints human-readable text (via `smallstep/certinfo`) or JSON
  (via `smallstep/zcrypto/x509`), with `--bundle`, `--short`, and remote URL
  support. Local certificates are **never verified** by inspect — the help text
  instructs users to run `step certificate verify` first.
- `fingerprint` prints the SHA-256 (or SHA-1 with `--insecure`) hash of the raw
  certificate bytes in the requested `--format` (hex/base64/base64-url/emoji).
  It handles bundles (`--bundle`), CSRs, and remote certificates, and can
  consume stdin (`-`).

## Other subcommands

- `lint` checks certificates for common errors and missing fields.
- `bundle` appends the issuing certificate(s) to an end-entity certificate.
- `install`/`uninstall` manage root certificates in the system trust store.
- `needs-renewal` checks whether a certificate should be renewed before a
  threshold.
- `format` converts between PEM/DER; `key` extracts a public key; `p12` converts
  to/from PKCS#12.
- `remote` fetches a remote peer certificate.
