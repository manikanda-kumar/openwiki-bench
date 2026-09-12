---
type: "Reference"
title: "KMS, step-kms-plugin, and External PKI Integrations"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-4871c514390de4c3447b7738
    resource: repo://command/ca/federation.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-722bacb6403539bdaf6c7a35
    resource: repo://command/crl/inspect.go
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---


# KMS, step-kms-plugin, and External PKI Integrations

The CLI reaches outside the local cluster of files and its own CA in several
ways: through hardware/cloud key managers (KMS), through external Identity
Providers for OIDC SSO, and through revocation/federation/policy tooling that
talks to remote authorities or the local trust web.

## KMS URIs and the step-kms-plugin

The `--kms` flag (`flags.KMSUri`, defined in `flags/flags.go`) describes a
key-management backend with a URI of the form
`kmstype:[key=value;...]?[key=value&...]`. The documented types are YubiKey PIV
(`yubikey:`), PKCS#11 (`pkcs11:`), TPM 2.0 (`tpmkms:`), Google Cloud KMS
(`cloudkms:`), AWS KMS (`awskms:`), and Azure Key Vault (`azurekms:`). The flag
help notes that `--kms` can be combined with key references such as
`pkcs11:module-path=...;token=smallstep?pin-value=pass` or
`yubikey:pin-value=123456`.

When a key reference is not a file, `internal/cryptoutil` dispatches to
`step-kms-plugin`. `CreateSigner`, `PublicKey`, `LoadCertificate`,
`LoadJSONWebKey`, and `CreateAttestor` check whether the path is a file
(`isFilename`) and, if not, build a signer/loader whose operations are delegated
to the `step-kms-plugin` binary found via `plugin.LookPath("kms")`
(`internal/plugin/plugin.go#GetURL`). The `kmsSigner.Sign` method invokes the
plugin's `sign` command with the hash/algorithm and key, and `Attest` invokes
`attest`; RSA PSS hashing and salt length are forwarded. The plugin is only
invoked for non-file references — a file path always uses the local PEM parser.

`IsKMSSigner` identifies the plugin-backed signer and `IsX509Signer` restricts
X.509 signing to ECDSA/RSA/Ed25519 (with an `sshagentkms:` exception that allows
only Ed25519). `step ca init`'s `--kms`/`--kms-root`/`--kms-intermediate` flags
support generating the CA keys in a KMS (Azure) via `pki.WithKMS`.

## External Crypto / OIDC SSO: `step oauth`

`command/oauth/cmd.go` implements the OAuth 2.0 / OIDC flows used to obtain
identity tokens at the CLI, which feed the OIDC provisioner token flow. It ships
hard-coded default Google OAuth client credentials for installed-app flows and
device-authorization, plus known endpoints for `google` and `github`.

The command supports:
- Loopback (browser) authorization: opens a browser to the authorization URL and
  listens on a loopback address (`DoLoopbackAuthorization`), verifying the OAuth
  `state` and exchanging the code with PKCE.
- Device Authorization Grant flow (`--console-flow device`, or `--console`):
  `DoDeviceAuthorization` polls the token endpoint.
- Out-of-band flow (`--console-flow oob`): prints the URL and reads a manually
  entered code (`DoManualAuthorization`).
- Two-legged JWT-bearer and JWT-auth flows for service accounts (`--account`
  `--jwt`): `DoTwoLeggedAuthorization`/`DoJWTAuthorization`.

Providers can be selected via `--provider` (google/github, or an OIDC discovery
endpoint), or endpoints can be given directly with `--authorization-endpoint`/
`--token-endpoint`/`--device-authorization-endpoint`. Missing endpoints are
fetched from the provider's `/.well-known/openid-configuration` document
(`disco`). Output is the raw token (`--bare`), an `Authorization: Bearer`
header (`--header`), or JSON, and `--oidc` selects the ID token versus the access
token. For simplicity it uses hosts on `127.0.0.1` loopback (or `--listen`).
The `postForm` helper sets an `Accept: application/json` header, required by
GitHub to get JSON responses.

`step oauth` is invoked internally by `generateOIDCToken` when an OIDC provisioner
is selected during a token flow (see [tokens](../architecture/token-system.md)).

## Revocation, federation, and root tooling

`step ca roots` and `step ca federation` (`command/ca/federation.go`) download a
bundle of all root certificates (or federation roots) from the CA and write them
to a file (or stdout) — the federation command reaches beyond the immediate CA
into the trust web the CA federates with. Both require `--ca-url` and `--root` (or
the defaults) and construct an online client with `ca.NewClient(...,
ca.WithRootFile(root))`.

`step crl inspect` (`command/crl/crl.go`) validates and prints a Certificate
Revocation List from a file or URL. It requires `--insecure`, `--ca` (the CRL
signing CA certificate), or `--from` (extracting the CRL distribution point from
a URL/certificate). When validating, it parses the CRL (`crlutil.ParseCRL`) and
marks the signature valid against a matching CA certificate that has the
`keyUsage certSign` bit and a matching subject key ID/authority key ID. `step
certificate verify` also wires CRL/OCSP checking (see the
[certificate toolkit](../architecture/certificate-toolkit.md)).

## Policy tooling and the Admin API

Policy and admin commands reach the online CA's Admin API via
`cautils.NewAdminClient`/`NewUnauthenticatedAdminClient`; see the
[provisioners and policies](../architecture/provisioners-and-policies.md) page.
`step api token` (`command/api/token/create.go`) is a hidden command for
connecting to the Smallstep API.
