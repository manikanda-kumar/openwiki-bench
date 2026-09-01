---
type: toolkit-page
title: Local X.509 Utilities and Trust Stores
description: Certificate utility commands that work without a CA - bundle, inspect, fingerprint, lint, verify with OCSP/CRL, format, key, p12, trust-store install/uninstall, and crl inspect.
tags: [x509, inspect, lint, verify, ocsp, crl, truststore, p12]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-d839343bbce1f3ea4abbd311
    resource: repo://command/certificate/bundle.go
  - id: openwiki-source-dd2083e3bfe29218ac712f40
    resource: repo://command/certificate/fingerprint.go
  - id: openwiki-source-27a92ebe69417095504cdcb2
    resource: repo://command/certificate/format.go
  - id: openwiki-source-d273a7589f0c5b5726260073
    resource: repo://command/certificate/inspect.go
  - id: openwiki-source-455e13fae8bb72a40c8b6ba6
    resource: repo://command/certificate/install.go
  - id: openwiki-source-57ba7dd4edc714f2c5e1dc81
    resource: repo://command/certificate/key.go
  - id: openwiki-source-2f8947cb371741300d028072
    resource: repo://command/certificate/lint.go
  - id: openwiki-source-82fd4fa4e59959a7d48ef2b1
    resource: repo://command/certificate/p12.go
  - id: openwiki-source-e91e5966889eb4feb80e760a
    resource: repo://command/certificate/remote.go
  - id: openwiki-source-d369a2fc6aab1546fc84613b
    resource: repo://command/certificate/verify.go
  - id: openwiki-source-c71b7b872620efd20398171b
    resource: repo://command/crl/crl.go
  - id: openwiki-source-722bacb6403539bdaf6c7a35
    resource: repo://command/crl/inspect.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-02cba02a31978f84a900def3
    resource: repo://internal/crlutil/crlutil.go
  - id: openwiki-source-df2d16b29c2bbf9191277bfd
    resource: repo://utils/read.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

The `step certificate` and `step crl` families operate on certificate material
directly, with no CA round-trip. They share two infrastructure pieces: the
remote-inspection helpers (`trimURL`/`getPeerCertificates` in
command/certificate/remote.go) that let file-oriented commands also take
`https://`/`tls://`/`host:port` targets, and the `utils.ReadFile` stdin
convention (`-` reads STDIN, BOMs stripped).

## bundle

`step certificate bundle <crt> <ca> <bundle-file>` is deliberately minimal
concatenation: it reads each input, PEM-decodes only the first block, and writes
leaf-then-issuer with mode 0600 (command/certificate/bundle.go:54-83). There is
no chain building and no relationship validation — the order is the caller's
responsibility. The only flag is `--force` (bundle.go:50).

## inspect

`step certificate inspect` (command/certificate/inspect.go:195-247) accepts a
file, STDIN (`-` is the default when no argument is given), or a remote URL. With
`--format text` (default) it prints `certinfo.CertificateText` (or `ShortText`
with `--short`, which is rejected for json/pem); with `--format json` it re-parses
the raw bytes with zcrypto's `zx509.ParseCertificate` and JSON-encodes; `--format
pem` re-encodes. By default only the first certificate is shown; `--bundle` shows
all in file order (inspect.go:219-222, 241-244). A file containing a CSR instead
of certificates falls through to CSR inspection (inspect.go:229-237). Remote
fetching honors `--roots`, `--servername`, and `--insecure`.

## fingerprint

`step certificate fingerprint` defaults to SHA-256; `--sha1` exists but requires
`--insecure`. `--format` selects hex (default), base64 variants, or emoji via
`flags.ParseFingerprintFormat` (command/certificate/fingerprint.go:126-183).
It hashes the raw certificate bytes (`crt.Raw`), works on CSRs, supports remote
URLs, and prints indexed `i: fp` lines with `--bundle`.

## lint

`step certificate lint` runs the certificate through zlint using zcrypto's
parser: `zx509.ParseCertificate` then `zlint.LintCertificate`, printing the
`ResultSet` as indented JSON (command/certificate/lint.go:130-141). Input is a
local file (first PEM block only) or a remote URL with the shared
`--roots`/`--servername`/`--insecure` flags (lint.go:100-128).

## verify

`step certificate verify` is local RFC 5280 path validation with `crypto/x509`
(command/certificate/verify.go):

- The first `CERTIFICATE` block is the leaf; every subsequent one feeds the
  **intermediates pool** — so a bundled file works even though there is no
  `--bundle` flag (verify.go:195-220).
- `--roots` loads the root pool from a file, comma-separated list, or directory
  (verify.go:223-229); `--host` adds DNS name checking; `KeyUsages` is
  `ExtKeyUsageAny` (verify.go:231-244).
- **Optional revocation checks**: `--verify-ocsp` (with `--ocsp-endpoint`) posts
  OCSP requests via `golang.org/x/crypto/ocsp`; `--verify-crl` downloads the CRL
  (from `--crl-endpoint` or the certificate's CRLDistributionPoints), verifies its
  signature via `crlutil.ParseCRL` (skipped under `--insecure`), and checks serial
  revocation (verify.go:308-339 and the OCSP branch at 341+). The issuer comes
  from `--issuing-ca` or is downloaded from the certificate's first
  IssuingCertificateURL (AIA) when revocation checks are requested
  (verify.go:269-306).

## format and key

`certificate format` converts PEM↔DER for certificates or CSRs (detection by
`-----BEGIN ` prefix, then parse attempts), writing to stdout or `--out` with the
input file's mode preserved (command/certificate/format.go:90-125).
`certificate key` extracts the embedded public key from a cert/CSR (first block
only) — or prints a private key if the file contains only one — serializing to
PEM, with `--out` writing mode 0600 (command/certificate/key.go:73-92).

## p12

`step certificate p12` builds PKCS#12 files via `software.sslmate.com/src/go-pkcs12`
(command/certificate/p12.go:9). Default encoder is `pkcs12.Modern`; `--legacy`
switches to `pkcs12.LegacyRC2` (PBE+SHA1+RC2/3DES) (p12.go:104-107). With `<crt>
<key>` arguments it builds an identity store — the first certificate in the input
becomes the leaf, remaining ones join the `--ca` intermediates; with only
`--ca` entries it builds a trust store whose FriendlyName is
`"<subject> - <fingerprint>"` (p12.go:156-190). Passwords come from
`--password-file` or a prompt; `--no-password` requires `--insecure`; output is
written 0600 (p12.go:120-125, 138-153, 192).

## install / uninstall (trust stores)

`step certificate install|uninstall` delegate entirely to
`github.com/smallstep/truststore` (command/certificate/install.go:169, 198).
The command enforces one invariant first: the input must be a **self-signed root
CA** — `cert.IsCA && cert.CheckSignatureFrom(cert) == nil` (install.go:222-224).
Options map directly: `--prefix` (defaulting to the CommonName or
"Smallstep Development CA"), `--all` (Java + Firefox), individual `--java`/
`--firefox`, and `--no-system` (install.go:226-251). Failures from the underlying
library's `*truststore.CmdError` are unwrapped to show the failed system command
(install.go:170-174). Platform coverage (system stores, Java keystore, Firefox
NSS) is implemented in the external library. Success prints the short certificate
text via `certinfo` (install.go:180-182).

## crl inspect

`step crl inspect` (the only `crl` subcommand, command/crl/crl.go:24-26) reads a
CRL from a file, STDIN, or HTTP(S) URL. `--from <cert-or-url>` bootstraps from a
certificate: it dials (adding port 443 when missing), takes the peer chain, uses
its first CRLDistributionPoints entry as the CRL location, and treats the rest of
the chain as candidate CAs (command/crl/inspect.go:161-196). The command refuses
to run without `--insecure` when no CA is available to verify against
(inspect.go:193-195). Signature verification matches the CRL's AuthorityKeyID to
candidate CAs' SubjectKeyId and requires the KeyUsageCRLSign bit
(inspect.go:227-238); `internal/crlutil` implements parsing (PEM or DER), the
`CRL.Verify` checks (nextUpdate freshness, CA validity, signature over ECDSA,
RSA PKCS1v15/PSS, Ed25519), and the human-readable printer
(internal/crlutil/crlutil.go:22-139). Output formats: `text` (default), `json`,
`pem` (inspect.go:240-254).

## Representative tests

The integration suite covers sign, verify (valid and bad-PEM variants), and
fingerprint for this family (integration/testdata/certificate/*.txtar, wired in
integration/certificate_test.go:20-122). The remaining commands' behavior is
source-derived; several (install/uninstall, p12, crl) depend on platform state
and have no automated tests here.
