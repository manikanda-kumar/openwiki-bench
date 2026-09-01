---
type: "Reference"
title: "Change guide: extending provisioner token support"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-e0cfffd9e5ebd278d6cab5c2
    resource: repo://command/ca/provisioner/provisioner.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# Change guide: extending provisioner token support

The one-time provisioning token system has a small number of well-defined
extension points. This guide maps them using the existing provisioner types as
the model. It assumes familiarity with
[Provisioning tokens: claims, options, and parsing](../architecture/tokens-and-provisioners.md)
and [CA client and enrollment flows](../architecture/ca-client-flows.md).

## 1. Token claims and headers (token/options.go)

Each provisioner that signs tokens with an extra JWT **header** adds an
`Options` function in `token/options.go`. Existing examples:

- `WithX5CFile`/`WithX5CInsecureFile` set the `x5c`/`x5cInsecure` header with a
  validated certificate chain (`token/options.go:230-256`, `319-350`).
- `WithSSHPOPFile` sets the `sshpop` header (`token/options.go:352-362`).
- `WithNebulaCert` parses and validates a Nebula certificate/key and sets the
  `nebula` header (`token/options.go:260-317`).

Claims (as opposed to headers) go through `WithClaim` or the dedicated helpers
(`WithRootCA`, `WithSANS`, `WithUserData`, `WithConfirmationFingerprint`, ...).
A new provisioner that needs a body claim adds an option here and, if the claim
must survive round-trips into `step-ca`, a field on `Payload` too.

## 2. Token type detection (token/parse.go)

The `Type` enum lists every token type (`Unknown`, `JWK`, `X5C`, `OIDC`,
`GCP`, `AWS`, `Azure`, `K8sSA`, `Nebula`) (`token/parse.go:17-27`). To add a
new type:

- Add a constant to the enum.
- Add any new claims to the `Payload` struct (`token/parse.go:38-62`).
- Extend `Payload.Type()` with a discriminator in the correct priority order
  (`token/parse.go:64-82`). The existing detection uses the presence of
  `google`/`amazon`/`azure` payloads, the issuer value for K8sSA, `sha`/`sans`
  claims for JWK, and a full OIDC claim set otherwise.
- If the new token carries nested data that must be decoded (like the AWS
  instance identity document or Azure `xms_mirid`), extend `parseResponse`
  (`token/parse.go:168-206`).

Add fixture tokens and cases to `token/parse_test.go`.

## 3. Per-provisioner token generation (utils/cautils)

The two dispatchers that must know about the new provisioner are:

**`NewTokenFlow`** (`utils/cautils/token_flow.go:154-182`) — add a `case` for
the new provisioner type that calls a generator function in
`token_generator.go`. Existing generators:

- `generateJWKToken` — signs the JWT with a JWK (key from the CA or `--key`).
- `generateOIDCToken` — re-executes `step oauth --oidc --bare`.
- `generateX5CToken`, `generateNebulaToken`, `generateSSHPOPToken` — sign with
  header-bearing keys.
- `generateK8sSAToken` — reads the Kubernetes service account token.
- GCP/AWS/Azure — return `p.GetIdentityToken(subject, caURL)`.

**`OfflineCA.GenerateToken`** (`utils/cautils/offline.go:568-598`) — mirror the
same dispatch for offline mode, since offline token flows do not contact the CA.

## 4. Provisioner prompt filtering (utils/cautils/token_flow.go)

`provisionerPrompt` filters the CA's provisioner list before selection
(`token_flow.go:291-408`). A provisioner that is gated behind dedicated flags
needs a filter function (like `allowX5CProvisionerFilter`,
`allowSSHPOPProvisionerFilter`, `allowK8sSAProvisionerFilter`,
`allowNebulaProvisionerFilter`, `token_flow.go:275-289`) and a `switch` case in
`provisionerPrompt` (`token_flow.go:292-318`), plus the corresponding flags in
`flags/flags.go` (e.g. `SSHPOPCert`, `SSHPOPKey`, `NebulaCert`, `NebulaKey`,
`K8sSATokenPathFlag`). If the provisioner is enabled by default, add its type to
the default filter list instead.

## 5. Certificate request SAN derivation (utils/cautils)

For cloud/OIDC-style provisioners, `CreateSignRequest` derives default SANs
from the token payload (`utils/cautils/certificate_flow.go:312-378`). A new
token type whose identity encodes SANs should add a matching `case` here (see
the AWS, GCP, Azure, and OIDC cases).

## 6. Provisioner management flags (command/ca/provisioner)

If the new type is also a *configured* provisioner on the CA side, the
`step ca provisioner add/update` surface needs the type added to the `--type`
flag documentation and any type-specific flags
(`command/ca/provisioner/provisioner.go:268-307`). This is the management
half; the token-generation half is steps 1-5.

## 7. Verification

- Unit tests for parsing and claims: `token/parse_test.go`, `token/token_test.go`.
- Token-generation tests: `utils/cautils/token_flow_test.go`,
  `utils/cautils/offline_test.go`.
- Run `make test`, `make race`, and `make lint`
  (`Makefile:151-175`).
