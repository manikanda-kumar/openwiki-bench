---
type: workflow
title: Certificate Issuance
description: End-to-end issuance with step ca certificate and step ca sign — token generation, CSR/SAN construction, key generation, online vs offline backends, and writing the signed chain.
tags: [workflow, certificates, csr, issuance]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-ff8a7fe9f3a4815e9b6b5c30
    resource: repo://command/ca/sign.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# Certificate Issuance

Certificate issuance is served by `step ca certificate` (new key + certificate)
and `step ca sign` (sign an existing CSR). Both go through the same
`CertificateFlow` abstraction in `utils/cautils/certificate_flow.go`, which
hides the online HTTP client and the offline in-process authority behind one
API.

## step ca certificate

`certificateAction` (command/ca/certificate.go:220-307) takes
`<subject> <crt-file> <key-file>`:

1. Validates arguments (2-3; 2 only with `--attestation-uri`) and rejects
   `--offline`+`--token` and `--attestation-uri`+`--kms`.
2. Builds the flow with `cautils.NewCertificateFlow(ctx)`.
3. If no `--token`: with `--acme` it goes directly to the ACME flow; otherwise
   it calls `flow.GenerateToken(ctx, subject, sans)`. A returned
   `ACMETokenError` (ACME provisioner) routes to
   `cautils.ACMECreateCertFlow`.
4. `flow.CreateSignRequest(ctx, tok, subject, sans)` returns the request and the
   generated private key.
5. The token is classified with `token.ParseInsecure`. For **JWK** tokens the
   subject must equal the CSR common name, and `--token` combined with `--san`
   is rejected; for **OIDC/AWS/GCP/Azure/K8sSA** tokens the common name is
   validated server-side.
6. `flow.Sign(...)` writes the certificate chain to `<crt-file>`, and the key
   is serialized to `<key-file>` with mode 0600.

## step ca sign

`signCertificateAction` (command/ca/sign.go:150-223) takes `<csr-file>
<crt-file>`:

1. Reads the CSR with `pemutil.Read`, asserts it is a `*x509.CertificateRequest`,
   and checks the CSR signature.
2. Builds the flow with `cautils.NewCertificateFlow(ctx, cautils.WithCertificateRequest(csr))`.
3. Without a token: `--acme` routes to `ACMESignCSRFlow`; otherwise it merges
   `--san` values with the CSR's SANs (`mergeSans`) and generates a token.
4. The token subject must match the CSR common name, except for
   OIDC/AWS/GCP/Azure/K8sSA tokens (server-side validation).
5. `flow.Sign` writes the chain.

## GenerateToken

`CertificateFlow.GenerateToken` (utils/cautils/certificate_flow.go:176-205)
delegates to the `OfflineCA.GenerateToken` when offline, otherwise requires
`--ca-url` and `--root` (or the default root path) and runs the online
`NewTokenFlow` (see "Provisioners and One-Time Tokens"). An `SSH` variant
(`GenerateSSHToken`) and an OIDC-only `GenerateIdentityToken` exist for the SSH
and admin flows.

## CreateSignRequest

`CreateSignRequest` (utils/cautils/certificate_flow.go:297-405) turns a token +
subject + SANs into an `*api.SignRequest` and a private key:

1. Parses the token (`token.ParseInsecure`) and generates a key with
   `keyutil.GenerateKey(kty, crv, size)` from `utils.GetKeyDetailsFromCLI`.
2. Merges `--san` values with the token's `sans` claim via `splitSANs`, which
   de-duplicates and splits into DNS/IP/email/URI with `x509util.SplitSANs`.
3. Injects token-type-specific default SANs when no SANs were given:
   - **AWS**: `PrivateIP` and `ip-<ip>.<region>.compute.internal` from the
     instance-identity document (plus the subject unless
     `DisableCustomSANs`).
   - **GCP**: `instance-name.c.<project>.internal` and
     `instance-name.<zone>.c.<project>.internal`.
   - **Azure**: the resource name from the `xms_mirid` claim.
   - **OIDC**: when the subject matches the token email, the CN is set to the
     token subject with the email as a SAN and an issuer-fragment URI; otherwise
     the subject is used as the only SAN.
   - Default (JWK etc.): the subject becomes the common name.
4. Builds an `x509.CertificateRequest` with those SANs, creates + parses +
   verifies the CSR signature, and returns `&api.SignRequest{CsrPEM, OTT: tok}`.

## Sign

`flow.Sign` (utils/cautils/certificate_flow.go:250-293) resolves the client
(`flow.GetClient`, which uses the token's `sha` claim + audience for trust
when present — see "CA Client Abstraction"), parses `--not-before`/
`--not-after` and template data (`--set`/`--set-file`), sends
`api.SignRequest{OTT, NotBefore, NotAfter, TemplateData}` through
`client.Sign`, and writes the returned chain (`ServerPEM` + `CaPEM`, or
`CertChainPEM`) to the target file with mode 0600.

The private key is serialized separately by the command (mode 0600), so a
signing failure never leaves a key file behind unless serialization itself
succeeded.

## Offline mode

With `--offline`, the same commands run against the `ca.json` config: the token
is generated by the `OfflineCA` from the embedded provisioners, and signing
runs `authority.Authorize` + `authority.SignWithContext` in-process. `--offline`
is incompatible with `--token` because the token is generated inside the
offline instance. The offline client is a process-wide singleton
(see "CA Client Abstraction").
