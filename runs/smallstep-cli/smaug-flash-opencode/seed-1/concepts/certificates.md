---
type: concept
title: X.509 Certificate Creation and Profile System
description: How step creates, signs, inspects, lints, bundles, formats, and installs X.509 certificates via profiles, templates, and KMS-backed keys.
tags: [x509, certificate, pki, profiles, templates, step-cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:42:28.757Z
sources:
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-455e13fae8bb72a40c8b6ba6
    resource: repo://command/certificate/install.go
  - id: openwiki-source-e91e5966889eb4feb80e760a
    resource: repo://command/certificate/remote.go
  - id: openwiki-source-4efb704564fc803c8fbd8399
    resource: repo://command/certificate/sign.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-09-12T20:42:28.757Z" }
---

# X.509 Certificate Creation and Profile System

The `step certificate` command group handles building and managing X.509
certificates: creating keys + certs/CSRs, signing CSRs, inspecting, linting,
verifying, bundling, fingerprinting, key extraction, format conversion, and
installing/uninstalling roots from trust stores
(`command/certificate/certificate.go`).

## Profiles

`step certificate create` supports several named profiles that set defaults
for certificate purpose and validity (`command/certificate/create.go`):

- **leaf** (default): a TLS leaf certificate, valid 24h by default.
- **self-signed**: a self-signed leaf, valid 24h; requires `--subtle`.
- **intermediate-ca**: can sign leaf certs; default validity 10 years.
- **root-ca**: self-signed root; default validity 10 years.

For `create`, the profile (`leaf`, `intermediate-ca`, `root-ca`,
`self-signed`) selects a default x509util template
(`x509util.DefaultLeafTemplate`, `DefaultIntermediateTemplate`,
`DefaultRootTemplate`, `DefaultLeafTemplate`), and `--csr` produces a
certificate signing request instead. `sign` additionally supports a `csr`
profile that copies the CSR without modification.

`step certificate sign` signs an existing CSR and writes nothing to a file;
it prints the PEM bundle to stdout. It validates that:

- The CSR signature is valid.
- The issuer key matches the issuer certificate public key
  (`validateIssuerKey`).
- The issuer is a CA with the keyCertSign usage, and an intermediate-ca cannot
  be issued when the issuer has pathLenConstraint 0 or too small
  (`validateIssuer`).

## Templates

Templates let users customize the resulting certificate or CSR. They are JSON
files rendered by Go `text/template` plus Sprig functions, representing
`x509util.Certificate` or `x509util.CertificateRequest`. `--profile` and
`--template` are mutually exclusive (`command/certificate/create.go`).

Template variables available: `.Subject` (with `.Subject.CommonName`), `.SANs`,
`.Insecure.CR`, and `.Insecure.User` for `--set`/`--set-file` data. Users pass
custom data via `--set key=value` and `--set-file file.json`
(`command/certificate/create.go`, `command/certificate/sign.go`,
`flags/flags.go`).

## Keys and KMS

Key parameters (`--kty`, `--curve`, `--size`) are validated centrally:
RSA requires at least 2048 bits, EC supports P-256/P-384/P-521, and OKP
supports Ed25519; `--insecure` relaxes the RSA minimum
(`utils/cli.go`). Keys can live on disk or in a KMS specified by a `--kms`
URI or a `--key`/`--ca-key` KMS-style name; `cryptoutil.CreateSigner(kms, key,
…)` resolves both, and KMS-backed signing is done via the step-kms-plugin
(`internal/cryptoutil/cryptoutil.go`, `command/certificate/create.go`).

For CA-signed leaf/intermediate creation, `--ca` and `--ca-key` (and optional
`--ca-kms`, `--ca-password-file`) point at the issuer.

## Validity and Common Name handling

`--not-before`/`--not-after` accept RFC 3339 times or Go durations
(`flags.ParseTimeOrDuration`). For `sign`, when `--omit-cn-san` is passed the
CSR Common Name is not added to SANs; otherwise it is added only if the CSR has
no SANs (`command/certificate/sign.go`).

## Bundling, format, inspect, lint, verify

- `--bundle` appends the issuer(s) after the leaf so the file is a full chain
  (`command/certificate/create.go`, `sign.go`).
- `step certificate format` converts between PEM and DER.
- `step certificate inspect` prints certificate contents; `--remote`
  fetches peer certificates from a server (`getPeerCertificates`,
  `command/certificate/remote.go`).
- `step certificate lint` checks certificates, `verify` checks signatures
  against a trust root, `fingerprint` computes fingerprints (also used for
  token `cnf` claims), and `key` extracts the public key
  (`command/certificate/certificate.go`).

## Trust store install

`step certificate install` installs a root certificate into the supported
trust stores, including Java and Firefox via the respective flags; `uninstall`
removes it (`command/certificate/install.go`). Installation uses the
`smallstep/truststore` package.
