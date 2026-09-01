---
type: "Reference"
title: "The step certificate Command Group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-d839343bbce1f3ea4abbd311
    resource: repo://command/certificate/bundle.go
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-d273a7589f0c5b5726260073
    resource: repo://command/certificate/inspect.go
  - id: openwiki-source-2f8947cb371741300d028072
    resource: repo://command/certificate/lint.go
  - id: openwiki-source-8df833e7257eb456286e631b
    resource: repo://command/certificate/needsRenewal.go
  - id: openwiki-source-82fd4fa4e59959a7d48ef2b1
    resource: repo://command/certificate/p12.go
  - id: openwiki-source-4efb704564fc803c8fbd8399
    resource: repo://command/certificate/sign.go
  - id: openwiki-source-d369a2fc6aab1546fc84613b
    resource: repo://command/certificate/verify.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---


# The step certificate Command Group

`step certificate` works with X.509 certificates and certificate signing
requests (CSRs) without requiring a CA server. It registers the subcommands
`bundle`, `create`, `format`, `inspect`, `fingerprint`, `lint`,
`needs-renewal`, `sign`, `verify`, `key`, `install`, `uninstall`, and `p12`.

Key generation is shared across the group through `flags.KTY`, `flags.Curve`,
and `flags.Size` and the `utils.GetKeyDetailsFromCLI` defaults (EC P-256, RSA
min 2048 bits).

## create

`step certificate create <subject> <crt-file> <key-file>` is the core
offline certificate/CSR generator. Profiles set the certificate shape:

- `leaf` (default) — a TLS leaf certificate, default validity 24h.
- `intermediate-ca` — a CA certificate, default validity 10 years; requires
  `--ca`/`--ca-key`.
- `root-ca` — a self-signed root, default validity 10 years.
- `self-signed` — a self-signed leaf; requires the `--subtle` flag.
- `csr` — creates a CSR instead (with `--csr`).

Key behavior:

- A key is generated from `--kty`/`--curve`/`--size` unless `--key` is given
  (which may be a KMS URI; `--kty`/`--curve`/`--size` are then rejected).
- The issuing CA key comes from `--ca`/`--ca-key` (optionally `--ca-kms`); for
  `leaf` and `intermediate-ca` these are required. Templates (`--template`,
  `--set`, `--set-file`) can fully customize the certificate; a custom template
  is incompatible with `--profile`.
- Certificates are produced by building a CSR internally and signing it
  (`--skip-csr-signature` allows using a public key without signing a CSR).
- `--bundle` appends the issuing certificate to the leaf.
- Private keys are encrypted with a prompted password (or `--password-file`);
  `--no-password` writes them unencrypted and requires `--insecure`.
- Files are written with `0600` permissions.

## sign

`step certificate sign <csr-file> <crt-file> <key-file>` signs an existing
CSR. It verifies the CSR signature, validates that the issuer key matches the
issuer certificate, and validates that the issuer is a CA (`IsCA`,
`keyCertSign`, and for the `intermediate-ca` profile the `pathLenConstraint`).
Profiles: `leaf` (default), `intermediate-ca` (with `--path-len`), and `csr`
(signs without modifying the CSR). `--omit-cn-san` prevents adding the CSR CN
as a SAN, `--bundle` appends the issuer chain, and the signed certificate is
printed to stdout.

## inspect

`step certificate inspect <crt-file>` prints certificate or CSR details in a
human-readable or machine-readable format (`--format text|json`). Local
certificates are **never verified** by inspect. It handles a single certificate
or a whole bundle (`--bundle`), and can also inspect remote certificates by URL
(e.g. `https://smallstep.com`), using `--roots`/`--servername`. A hyphen `-`
reads from stdin.

## verify

`step certificate verify <crt-file>` runs RFC 5280 path validation, returning
exit code 0 when valid. It supports `--roots`, `--host`, `--servername`,
`--issuing-ca`, `--verbose`, and optional OCSP (`--verify-ocsp`,
`--ocsp-endpoint`) and CRL (`--verify-crl`, `--crl-endpoint`) checks (the CRL
check uses `internal/crlutil`).

## lint

`step certificate lint <crt-file>` checks a certificate for common errors
using `github.com/smallstep/zlint` and outputs JSON. It is intended for Web PKI
certificates and supports remote certificates via `--roots`/`--servername`.

## needs-renewal

`step certificate needs-renewal <cert-file|hostname>` reports whether a
certificate needs renewal based on remaining lifetime. Exit codes: `0` = needs
renewal, `1` = does not need renewal, `2` = file does not exist, `255` = other
error. The threshold is `--expires-in` as a percent (default 66% of lifetime
used) or a duration; `--bundle` checks every certificate in the chain.

## bundle, fingerprint, format, key

- `bundle <crt-file> <ca> <bundle-file>` appends issuing/intermediate
  certificates to a leaf.
- `fingerprint <crt-file|csr-file|key-file>` computes a certificate
  fingerprint in the requested `--format` (`hex`, `base64`, `base64-url`,
  `base64-raw`, `base64-url-raw`, `emoji`).
- `format` converts between PEM and DER (`--out`).
- `key <crt-file>` extracts the public key of a certificate.

## install, uninstall, p12

- `install <crt-file>` installs a root certificate into the system trust store
  (browser + OS) via `github.com/smallstep/truststore`; `uninstall` removes it.
- `p12 <p12-path> [<crt-path>] [<key-path>]` packages certificates and keys
  into a PKCS#12 (`.p12`) file for import into Windows/Firefox/Java, with
  `--ca`, `--legacy`, and password options.

## Relationship to other pages

- CA-backed issuance lives in
  [The step ca Command Group](ca-group.md); the shared flows are described in
  [CA Client and Certificate Flows](../ca/ca-client-and-flows.md).
- Templates use `go.step.sm/crypto/x509util`; the `--set`/`--set-file` parsing
  is documented in [Architecture Overview](../architecture/overview.md).
