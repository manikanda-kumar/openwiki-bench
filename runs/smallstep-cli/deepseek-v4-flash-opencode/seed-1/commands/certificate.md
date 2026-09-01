---
type: "Reference"
title: "step certificate command group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-d273a7589f0c5b5726260073
    resource: repo://command/certificate/inspect.go
  - id: openwiki-source-4efb704564fc803c8fbd8399
    resource: repo://command/certificate/sign.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# step certificate command group

`step certificate` provides local, offline X.509 operations that do not
require a CA server: creating keys, CSRs, and certificates, signing CSRs,
inspecting/verifying/linting certificates, bundling, formatting, key
extraction, system trust-store installation, and PKCS#12 conversion
(`command/certificate/certificate.go:84-98`).

## create: certificates, CSRs, and profiles

`step certificate create` (`command/certificate/create.go:41-493`) generates a
certificate or CSR. The `--profile` flag selects a template preset:

| Profile | Default template | Default validity |
|---|---|---|
| `leaf` | `x509util.DefaultLeafTemplate` | 24h |
| `self-signed` | `x509util.DefaultLeafTemplate` | 24h |
| `intermediate-ca` | `x509util.DefaultIntermediateTemplate` | 10 years |
| `root-ca` | `x509util.DefaultRootTemplate` | 10 years |
| template (`--template`) | user-supplied | 24h |

(`command/certificate/create.go:669-689`, `33-39`).

Key points of the create flow:

- **Key generation**: by default a key pair is generated from `--kty`/`--curve`/
  `--size` (default EC P-256) via `keyutil`; `--insecure` allows sub-2048-bit
  RSA; an existing key can be supplied with `--key`
  (`command/certificate/create.go:773-836`).
- **KMS-backed keys**: `--key` and `--ca-key` may be KMS URIs (e.g. a
  `yubikey:` slot or `pkcs11:`) resolved through `cryptoutil.CreateSigner`; a
  matching `--kms` URI supplies the KMS configuration
  (`command/certificate/create.go:820-833`).
- **CSR mode** (`--csr`): builds a certificate signing request from the subject
  and SANs (default SAN = subject) using `x509util.NewCertificateRequest`; the
  key is written with the requested password handling
  (`command/certificate/create.go:570-640`).
- **Templates**: `--template` overrides the profile and must not be combined
  with `--profile`; `--set`/`--set-file` provide template data (`--template`
  user data accessed via `.Insecure.User`) (`command/certificate/create.go:538-558`).
- **Issuer signing**: `--ca`/`--ca-key` (and `--ca-kms`) supply the parent for
  leaf and intermediate profiles; root/self-signed reject them. The issuer key
  is validated to be an X.509 signer (`command/certificate/create.go:841-909`).
- **`--bundle`** appends the parent certificate to the output
  (`command/certificate/create.go:747-752`); `--no-password` requires
  `--insecure` and writes keys unencrypted (`command/certificate/create.go:504-508`).
- Guardrails: self-signed requires `--subtle`; `not-before` must not exceed
  `not-after` (`command/certificate/create.go:525-527`, `647-650`).

## sign: sign a CSR

`step certificate sign` (`command/certificate/sign.go:46-235`) signs a CSR with
an issuer certificate/key. It:

- Parses and signature-checks the CSR, loads the issuer (file or KMS) and its
  key, and verifies the key matches the issuer certificate
  (`validateIssuerKey`) (`command/certificate/sign.go:247-282`).
- Selects a template by profile (`leaf`, `intermediate-ca`, `csr`) or uses a
  custom `--template`; `--profile` and `--template` are mutually exclusive
  (`command/certificate/sign.go:284-322`).
- Validates the issuer can sign the profile: it must be a CA with the
  `keyCertSign` usage, and intermediate signing is limited by the issuer's
  pathLenConstraint (checked against `--path-len`)
  (`command/certificate/sign.go:434-452`).
- Applies `--not-before`/`--not-after` (default leaf 24h, intermediate 10
  years), optionally adds the CSR Common Name as a SAN unless `--omit-cn-san`,
  and prints the signed certificate (with `--bundle` appending the issuers) to
  stdout (`command/certificate/sign.go:335-397`).

## inspect

`step certificate inspect` (`command/certificate/inspect.go:23-182`) prints a
local certificate/CSR or a remote server's peer certificate. Local files are
never verified; remote inspection uses the TLS peer chain
(`command/certificate/inspect.go:31-38`). Formats are `text`, `json`, and
`pem`; `--bundle` prints the whole chain, `--short` prints a compact summary,
`--roots`/`--servername`/`--insecure` tune remote verification
(`command/certificate/inspect.go:204-247`). The `remote.go` variant performs
the same against a remote TLS server.

## verify, lint, and fingerprint

- `verify` validates a certificate chain against `--roots`.
- `lint` checks a certificate for common errors and missing fields.
- `fingerprint` computes a certificate fingerprint in configurable encodings
  (hex, base64, emoji, etc.) via `flags.ParseFingerprintFormat`.

## Other subcommands

- **`bundle`** appends an issuing certificate to an end-entity certificate.
- **`format`** converts between PEM and DER.
- **`key`** extracts the public key from a certificate.
- **`install`** / **`uninstall`** add or remove a root certificate from the
  system (and browser) trust store via `smallstep/truststore`.
- **`p12`** converts between PEM bundles and PKCS#12 `.p12` files.
- **`needsRenewal`** reports whether a certificate needs renewal (used by
  automation and the systemd renewal units).
