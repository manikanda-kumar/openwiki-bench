---
type: integration-page
title: KMS and Plugin Integration
description: How keys in HSMs, KMSs, and TPMs are used via KMS URIs that shell out to step-kms-plugin, and how unknown step subcommands resolve to plugin executables.
tags: [kms, hsm, plugins, step-kms-plugin, cryptoutil]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-5cb498dbff5a2aba7f81df22
    resource: repo://command/ca/rekey.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

`step` supports keys held in hardware and cloud KMSs without linking any vendor
SDK: everything goes through KMS URIs and an external plugin binary,
`step-kms-plugin`. This page documents both the URI-based key integration and the
plugin dispatch that backs it.

## The `--kms` URI scheme

The shared `flags.KMSUri` flag (flags/flags.go:471-508) documents the URI grammar
`kmstype:[key=value;...]?[key=value&...]` — semicolon-separated parameters identify
the KMS, `&`-separated ones carry credentials — and the supported types:

- `yubikey:` (YubiKey PIV): serial, pin-value, pin-source, management-key
- `pkcs11:` (PKCS #11): module-path, token, id, object, pin-value/source
- `tpmkms:` (TPM 2.0): name, device, attestation-ca-url
- `cloudkms:` (Google Cloud KMS), `awskms:` (AWS KMS), `azurekms:` (Azure Key
  Vault)

## File-or-KMS resolution in internal/cryptoutil

`internal/cryptoutil` is the adapter layer. Its convention is that every accessor
takes `(kmsURI, name)` and **a file that exists always wins over a URI-shaped
name**: `IsKMS` explicitly returns false when a file exists at the given path, even
if it matches a KMS URI pattern, and otherwise requires `kms.TypeOf` to identify a
non-default KMS (internal/cryptoutil/cryptoutil.go:26-38). The accessors are:

- `PublicKey(kmsURI, name)` — `pemutil.Read` for files, `newKMSPublicKey` for KMS
  (cryptoutil.go:52-70).
- `CreateSigner(kmsURI, name)` — the central primitive used by renewal
  (`tlsLoadX509KeyPair`), X5C/SSHPOP token generation, and `step certificate
  create` (cryptoutil.go:74-87). Files must actually contain a `crypto.Signer`.
- `LoadCertificate(kmsURI, certPath)` — file or `step-kms-plugin certificate`
  (cryptoutil.go:90-123).
- `LoadJSONWebKey(kmsURI, name)` — `jose.ReadKey` for files; for KMS keys it
  wraps the signer in `jose.NewOpaqueSigner`, derives the JWK algorithm per key
  type/curve (ES256/384/512, RS256, EdDSA), and sets `kid` from the JOSE
  thumbprint (cryptoutil.go:126-168). This is what lets JWK and X5C tokens be
  signed with HSM-held keys.
- `CreateAttestor` — returns the attestor interface (a `crypto.Signer` plus
  `Attest() ([]byte, error)`) for TPM/device attestation
  (cryptoutil.go:45-50, 171-175).
- Predicates: `IsKMSSigner` type-asserts the internal signer wrapper
  (cryptoutil.go:177-181); `IsX509Signer` answers whether Go's crypto/x509 can use
  the signer for certificates — true for ECDSA/RSA/Ed25519, but for
  `sshagentkms:` URIs only Ed25519 keys qualify (cryptoutil.go:183-205). Callers
  use these to decide whether a private key must be written to disk (KMS signers
  are never serialized — e.g. command/certificate/create.go:755-759).

## The step-kms-plugin bridge

The KMS side of every accessor shells out to the `step-kms-plugin` binary located
via `plugin.LookPath("kms")` (cryptoutil.go:99, 231, 264):

- `step-kms-plugin key [--kms <uri>] <name>` retrieves the public key PEM, parsed
  with `pemutil.Parse` (cryptoutil.go:229-260).
- `step-kms-plugin sign --format base64 [--kms <uri>] [--alg ...] <key>` signs:
  the digest is written to the child's stdin, the base64 signature is decoded from
  stdout. RSA keys get explicit `--alg SHA256/384/512` mapping and RSA-PSS
  (`--pss --salt-length`, noted as requiring plugin v0.12.0); unsupported hash
  functions error (cryptoutil.go:306-344).
- `step-kms-plugin attest [--kms <uri>] <key>` returns attestation material
  (cryptoutil.go:346-362).

Plugin failures surface with the child's stderr via `exitError`
(cryptoutil.go:219-227). The operational consequence: **the plugin must be
installed and on `$PATH` (or in `$(step path)/plugins`) for any KMS URI to work**,
and each crypto operation pays a process spawn.

## Plugin discovery and execution

`internal/plugin` implements the discovery used by both the KMS bridge and the
root dispatcher (internal/plugin/plugin.go):

- `LookPath(name)` searches for `step-<name>-plugin` in `$(step path)/plugins`
  first (with Windows extension probing via `PATHEXT`), then `$PATH`
  (plugin.go:20-52).
- `Run(ctx, file)` executes it with the CLI arguments, wiring
  stdin/stdout/stderr through, invoking PowerShell for `.ps1` files on Windows
  (plugin.go:56-72).
- `GetURL(name)` maps known plugin names to download URLs — currently only `kms`
  (plugin.go:74-82).

The runtime dispatch page covers how unknown `step <name>` invocations fall into
this machinery; the KMS integration is the first-party consumer of it.

## KMS surfaces across the command tree

Where KMS keys can appear:

- **X.509 issuance offline**: `step certificate create --kms ... --key ...` uses
  `parseOrCreateKey` → `cryptoutil.CreateSigner`/`PublicKey`, requiring
  `IsX509Signer` for issuing keys (command/certificate/create.go:820-832).
- **CA token generation**: X5C and SSHPOP tokens sign with KMS keys via
  `CreateSigner`/`LoadJSONWebKey` (utils/cautils/token_generator.go:216-233,
  422).
- **Renewal/rekey**: `step ca renew` loads the TLS key pair with
  `cryptoutil.CreateSigner` so `yubikey:`/`pkcs11:` key files work
  (command/ca/renew.go:656-679); `step ca rekey` refuses to generate new KMS keys
  and requires `--private-key` instead (command/ca/rekey.go:249-261).
- **CA infrastructure**: `step ca init --kms azurekms` configures key URIs for
  the CA's own root/intermediate/SSH keys (command/ca/init.go:462-518).
- **Attestation**: `--attestation-uri` and the ACME device-attestation flow use
  `CreateAttestor` (cryptoutil.go:173-175).

`step ca init` restricts `--kms` to `azurekms` (command/ca/init.go:258-259),
while the general `--kms` flag on crypto commands supports all documented types;
the KMS implementations themselves live in `go.step.sm/crypto/kms` and the plugin.

## Uncertainty note

The `step-kms-plugin` protocol (subcommand names, flags, stdin/stdout formats) is
implemented in the external plugin repository; this repository's evidence is the
invocation sites cited above. Version requirements beyond the RSA-PSS salt-length
comment (plugin v0.12.0) are not established here.
