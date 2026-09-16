---
type: "Reference"
title: "Certificate Command Group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
---

# Certificate Command Group

The `step certificate` group provides offline certificate tooling: CSR creation, self-signed and CA-signed certificate creation via profiles or templates, CSR signing, validation (including OCSP/CRL), inspection, linting, bundling, format conversion, trust-store installation, PKCS#12 packaging, fingerprinting, and renewal checks. Everything in this group works locally or against a TLS endpoint; it does not talk to a Smallstep CA over the ACME or REST APIs (see [CA client and flows](/openwiki/ca-integration/ca-client-and-flows.md) for the online `step ca certificate` path).

## Group registration

`command/certificate/certificate.go` registers the group in `init()` (`certificate.go:10`): `Name: "certificate"`, usage "create, revoke, validate, bundle, and otherwise manage certificates". The group exposes 13 subcommands (`certificate.go:84-98`): `bundle`, `create`, `format`, `inspect`, `fingerprint`, `lint`, `needs-renewal`, `sign`, `verify`, `key`, `install`, `uninstall`, and `p12`.

## `step certificate create`

`createCommand()` (`create.go:41`) creates a certificate or CSR offline.

**Profiles.** Profile constants are defined in `create.go:25-39`: `leaf` (default), `self-signed`, `intermediate-ca`, `root-ca`, and `csr` (used only by `sign`). Default validity periods: leaf and self-signed 24 hours, intermediate CA and root CA 10 years, custom template 24 hours (`create.go:34-38`).

**Profile/template rules** (in `createAction`, `create.go:495-771`):

- `--profile` and `--template` are incompatible (`create.go:538-540`).
- The `self-signed` profile requires `--subtle` (`create.go:647-650`); `--bundle` is only valid with the `leaf` profile (`create.go:642-645`).
- `--csr` mode requires a private key and rejects `--ca`, `--ca-key`, `--ca-password-file`, `--not-before`, `--not-after`, `--bundle`, and any profile other than `leaf` (`create.go:570-594`); the subject is added as the default SAN and `x509util.DefaultCertificateRequestTemplate` is used when no template is given (`create.go:596-612`).
- A public key supplied via `--key` (no private part) requires `--skip-csr-signature` (`create.go:652-656`).

**Template resolution.** When no `--template` is given, each profile maps to a built-in template and validity: `leaf` → `x509util.DefaultLeafTemplate`/24h, `intermediate-ca` → `DefaultIntermediateTemplate`/10y, `root-ca` → `DefaultRootTemplate`/10y, `self-signed` → `DefaultLeafTemplate`/24h; otherwise `defaultTemplatevalidity` applies (`create.go:669-689`). Templates are Go `text/template` files with Sprig functions and expose `.Subject` and `.SANs`. User data comes from `--set`/`--set-file` via `flags.GetTemplateData` (`create.go:556-560`); the flags are `flags.Template`, `flags.TemplateSet`, `flags.TemplateSetFile` (`create.go:422-424`).

**Key handling.** `parseOrCreateKey` (`create.go:773-836`) either generates a key pair from `--kty`/`--curve`/`--size` via `keyutil.GenerateKeyPair` (with `keyutil.Insecure()` allowing short RSA keys when `--insecure`), or loads `--key` through the KMS-aware `cryptoutil.CreateSigner`, falling back to public-key loading when the key cannot sign.

**Issuer handling.** `parseSigner` (`create.go:841-909`) enforces profile-specific requirements: `leaf`/`intermediate-ca` require `--ca` and `--ca-key`; `root-ca`/`self-signed` reject them. With both flags it reads the issuer certificate (`pemutil.ReadCertificate`) and builds a signer from `--ca-key` via `cryptoutil.CreateSigner`, optionally through `--ca-kms` and `--ca-password-file`.

**Sign and write.** `x509util.CreateCertificate` signs with the parent (or the leaf itself for root/self-signed) at `create.go:735`. The private key is written by `savePrivateKey` unless it is a KMS signer (`create.go:754-759`); `--bundle` appends the parent certificate after the leaf in the output file (`create.go:747-752`). Keys are encrypted with a prompted password unless `--no-password` (which requires `--insecure`) or `--password-file` (`create.go:912-934`).

Other notable flags: `--kms`/`--key` (`create.go:463-467`), `--not-before`/`--not-after` accepting RFC 3339 times or durations (`create.go:425-440`), `--san` (`create.go:441-445`), `--subtle`, `--force`, hidden `--insecure` (`create.go:488-490`).

## `step certificate sign`

`signCommand()` (`sign.go:46`) signs a CSR: `step certificate sign <csr-file> <crt-file> <key-file>`.

- Allowed profiles: `leaf` (default), `intermediate-ca`, `csr`; anything else is rejected (`sign.go:285-288`). The `csr` profile signs the certificate without modifying the CSR (uses `x509util.CertificateRequestTemplate`).
- `--profile` and `--template` are incompatible (`sign.go:291-294`). Built-in JSON templates: `customLeafTemplate` (rawSubject, SANs, keyUsage by key type, serverAuth/clientAuth) and `customIntermediateTemplate` (certSign/crlSign, `basicConstraints.isCA` with `maxPathLen`) at `sign.go:26-44`.
- The CSR signature is checked first (`sign.go:248-254`). The issuer must match its key (`validateIssuerKey`, `sign.go:400-431`) and must be a CA with `keyCertSign`; for `intermediate-ca` the issuer's `pathLenConstraint` must allow the requested `--path-len` (default 0, -1 for unlimited) (`validateIssuer`, `sign.go:434-452`).
- `--not-after` defaults to 24h (leaf) or 10 years (intermediate) (`sign.go:351-357`); `--omit-cn-san` skips adding the CSR common name as a SAN (`sign.go:198-205`, data built in `createTemplateData`, `sign.go:457-489`).
- The signed certificate is written to **stdout**; `--bundle` appends the issuer certificate(s) (`sign.go:381-394`). KMS URIs are supported for the issuer key (`sign.go:176`).

## `step certificate verify`

`verifyCommand()` (`verify.go:24`) validates a local certificate file or a remote address (TLS dial via the shared helpers, `verify.go:173-184`). From a file, the first PEM block is the leaf and the rest become intermediates (`verify.go:186-220`). `--roots` builds the root pool (`verify.go:223-229`) and path validation runs with `KeyUsages: [Any]` so any purpose can be verified (`verify.go:231-244`).

Revocation checks are opt-in via `--verify-ocsp` and `--verify-crl` (`verify.go:124-137`). The issuing CA comes from `--issuing-ca` or the `IssuingCertificateURL` AIA extension (`verify.go:269-306`).

- **OCSP** (`VerifyOCSPEndpoint`, `verify.go:380-414`): endpoints from `--ocsp-endpoint` or the `OCSPServer` AIA; a POSTed OCSP response with status `Revoked` or `Unknown` fails verification.
- **CRL** (`VerifyCRLEndpoint`, `verify.go:416-456`): endpoints from `--crl-endpoint` or `CRLDistributionPoints`; the CRL signature is validated against the issuer unless `--insecure`, and the serial number is matched against the revoked list.

## `step certificate inspect`

`inspectCommand()` (`inspect.go:23`) prints certificate or CSR details in human-readable form. Accepts a file or stdin (`inspect.go:199-202`), a remote address with `--insecure` (`inspect.go:211-222`), and detects CSRs via `pemutil.ParseCertificateRequest` (`inspect.go:229-237`). `--format` supports `text`, `json`, `pem` (text-only `--short`) (`inspect.go:204-209`); text output uses `certinfo`, JSON output uses `zcrypto` (`zx509`) (`inspect.go:249-293`).

## `step certificate lint`

`lintCommand()` (`lint.go:18`) checks a certificate for common errors with `zlint` and prints a JSON `ResultSet`; it is intended for Web PKI certificates and "may not be appropriate for internal PKIs" (`lint.go:25`). It lints a single certificate — the first PEM block of a file or the first peer certificate of a remote address (`lint.go:106-128`) — parses it with `zcrypto` and prints the result (`lint.go:130-141`). Flags: `--roots`, `--servername`, `--insecure`.

## Bundle, format, key, fingerprint

- **bundle** (`bundle.go:18`): `step certificate bundle <crt-file> <ca-file> <chain-file>` concatenates the first PEM blocks of the leaf and the intermediate CA into a chain file (`bundle.go:54-87`).
- **format** (`format.go:21`): converts PEM↔DER. PEM input is decoded to raw DER bytes (`decodeCertificatePem`, `format.go:130-156`); DER input is re-encoded as PEM, supporting both `CERTIFICATE` and `CERTIFICATE REQUEST` (`format.go:96-110`). `--out` writes the file, preserving the input file's mode (`format.go:112-125`).
- **key** (`key.go:19`): extracts the public key from a certificate or key file (first block only) and prints it or writes it with `--output-file` (`key.go:62-93`).
- **fingerprint** (`fingerprint.go:22`): prints the SHA-256 fingerprint; `--sha1` switches to SHA-1 and requires `--insecure` (`fingerprint.go:98-100`, `fingerprint.go:126-128`), `--bundle` prints all entries in order, and the output encoding comes from `--format` via `flags.ParseFingerprintFormat` (`fingerprint.go:130-133`, `fingerprint.go:165-183`).

## Trust store install/uninstall

`installCommand()` (`install.go:18`) and `uninstallCommand()` (`install.go:88`) install/remove a root certificate in the system default trust store, with `--java` (Java keystore) and `--firefox` (NSS database) options, `--all` for both, `--no-system` to skip the system store, and `--prefix` for the display name (default: the certificate CN, else "Smallstep Development CA "; `install.go:62-84`, `install.go:226-233`).

`getTruststoreOptions` (`install.go:216-253`) rejects any certificate that is not a self-signed CA (`cert.IsCA` and `CheckSignatureFrom(cert)`). The install action calls `truststore.Install` and surfaces underlying command failures as `CmdError` with the executed arguments (`install.go:158-185`); `uninstallAction` mirrors this with `truststore.Uninstall` (`install.go:187-214`).

## `step certificate p12`

`p12Command()` (`p12.go:22`) packages certificates and keys into PKCS#12. The modern encoder is the default; `--legacy` uses the traditional PBE+SHA1+RC2/3DES algorithms (`p12.go:84-88`, selected at `p12.go:104-107`). Two modes (`p12.go:93-198`):

- **Identity store**: both `<crt-file>` and `<key-file>` given — the first certificate is the server cert, the rest are intermediates, plus any `--ca` bundles (`p12.go:156-176`).
- **Trust store**: only `--ca` bundles (required when cert/key are absent) — each entry gets a `<subject> - <fingerprint>` friendly name (`p12.go:177-190`).

Password comes from `--password-file` or a prompt; `--no-password` requires `--insecure` (`p12.go:121-125`).

## `step certificate needs-renewal`

`needsRenewalCommand()` (`needsRenewal.go:22`) is a scriptable renewal probe (used by systemd renewal units and the like). Exit codes: `0` needs renewal, `1` within lifetime, `2` file not found, `255` other errors (`needsRenewal.go:30-48`). The default threshold is 66% of the allotted lifetime used (`defaultPercentUsedThreshold`, `needsRenewal.go:20`); `--expires-in` accepts a `<percent>%` or a duration (`needsRenewal.go:189-206`). Only the leaf is checked unless `--bundle` (`needsRenewal.go:208-225`). Accepts a local file or a remote address via the shared TLS helpers (`needsRenewal.go:160-167`). `--verbose` prints an affirmation; otherwise the non-renewal exit is silent (`isVerboseExit`, `needsRenewal.go:230-244`).

## Remote certificate retrieval

All subcommands that accept an address share `remote.go`:

- `urlPrefixes` (`remote.go:15-21`) maps scheme prefixes to default ports: `tcp://`, `tls://`, `https://` → 443, `smtps://` → 465, `ldaps://` → 636.
- `getPeerCertificates(addr, serverName, roots, insecure)` (`remote.go:35-64`) loads the `--roots` pool when given, dials TLS (min TLS 1.2) with the given server name and `InsecureSkipVerify` when `insecure`, and returns the full peer chain.
- `trimURL` (`remote.go:79-95`) strips the URL path, applies the default port when absent, and returns `("", false)` for plain file paths, so callers can branch on local file vs remote address.

Consumers: `fingerprint.go:135-139`, `inspect.go:211-222`, `lint.go:106-114`, `needsRenewal.go:160-167` (never insecure), `verify.go:173-184` (never insecure).

## Failure handling

- Flag/argument validation uses `errs` from `smallstep/cli-utils` (`IncompatibleFlagWithFlag`, `RequiredWithFlag`, `InvalidFlagValue`, etc.) throughout, producing structured CLI errors rather than panics (e.g. `create.go:500-544`).
- `needs-renewal` maps failures to stable exit codes via `errs.NewExitError` so scripts can branch (`needsRenewal.go:144-181`).
- `install`/`uninstall` unwrap `truststore.CmdError` to report the exact external command (keytool, `certutil`, etc.) that failed (`install.go:169-176`).
- `verify` distinguishes unreachable revocation endpoints from definitive revocation: a non-received response is reported in `--verbose` mode and the next endpoint is tried (`verify.go:320-338`, `verify.go:353-371`).

## Change guides

### Adding a new certificate subcommand

1. Create `command/certificate/<name>.go` with a `func <name>Command() cli.Command` following the existing pattern (see `bundleCommand()` in `bundle.go:18` or `keyCommand()` in `key.go:19`): set `Name`, `Action` via `command.ActionFunc` or `cli.ActionFunc`, `Usage`, `UsageText`, `Description`, and `Flags`.
2. Append `<name>Command()` to the `Subcommands` slice in `certificate.go:84-98`. The package is already imported by the root command, so the `init()`-driven registration (`certificate.go:10`) picks it up automatically.
3. If the subcommand needs to read remote certificates, accept an address argument and branch on `trimURL` + `getPeerCertificates` (`remote.go:35-95`).

### Changing a `create` profile

1. Profile names and default validity live in the constant block at `create.go:25-39`; update the usage text of `--profile` at `create.go:399-421` to keep documentation in sync.
2. The profile → template/validity mapping is in `createAction` at `create.go:669-689`; issuer-flag requirements for each profile are enforced in `parseSigner` at `create.go:850-870` (leaf/intermediate require `--ca`/`--ca-key`, root/self-signed reject them).
3. For `sign`, profile validation is separate: `sign.go:285-288` (allowed set) and the template selection at `sign.go:311-322`; issuer path-length rules are in `validateIssuer` (`sign.go:434-452`).
