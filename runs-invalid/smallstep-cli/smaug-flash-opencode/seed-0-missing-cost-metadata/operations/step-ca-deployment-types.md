---
type: "Reference"
title: "CA Deployment Types: Standalone, Linked, Hosted, and RAs"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---


# CA Deployment Types: Standalone, Linked, Hosted, and RAs

`step ca init` (`command/ca/init.go`) is the bootstrapping entrypoint for a CA. It
builds a PKI (root, intermediate, and optionally SSH signing keys) and a `step-ca`
configuration, choosing along the way a *deployment type* and whether the local
CA is a certificate authority or a registration authority backed by an upstream
service.

## Deployment types

`initAction` asks the user (or reads `--deployment-type`) to choose among the
`pki.DeploymentType` values (via `promptDeploymentType`):

- **standalone**: an instance of step-ca that does not connect to any cloud
  services; the operator manages authority keys and configuration. Initially
  creates the CA's first provisioner.
- **linked**: an instance of step-ca with locally managed keys that connects to a
  Certificate Manager account for provisioner management, alerting, reporting,
  revocation, and other managed services.
- **hosted**: a fully managed smallstep cloud instance. `step ca init` does not
  produce local config here — instead it prints a message directing the user to
  `step ca bootstrap --team <name> --authority <authority>` after creating an
  account.

Home help text and `promptDeploymentType` define these. For Registration
Authority modes (see below), Hosted is not offered (`deploymentTypes[:2]`).

The deployment type also gates behavior: applying `--acme` (default ACME
provisioner) is only supported for standalone; `--admin-subject`
(`WithSuperAdminSubject`/`WithAdmin`) combinations are checked for
linked/remote-management; and certain flag combinations are validated early
(e.g. `--acme` and `--admin-subject` both conflict with `--no-db`, since ACME and
admin APIs require a database).

## Registration Authority (RA) modes

When `--ra` is `CloudCAS` or `StepCAS`, `step ca init` does not create a full CA;
it configures a registration authority that delegates certificate issuance to an
upstream authority:

- **CloudCAS**: uses Google Certificate Authority Service. `initAction`
  (CloudCAS branch) prompts for project/location/CA pool/tier/GCS bucket and
  builds an `apiv1.Options` with `Type: apiv1.CloudCAS`, `CredentialsFile`,
  `CertificateAuthority`, and the cloud resource fields. Credentials come from
  `--credentials-file` (or the `GOOGLE_APPLICATION_CREDENTIALS` env / default
  service account).
- **StepCAS**: uses another step-ca as the issuer. It prompts for the CA URL,
  root fingerprint, and a JWK provisioner name, and builds an
  `apiv1.Options` with `Type: apiv1.StepCAS`, `IsCAGetter: true`,
  `CertificateAuthority`, `CertificateAuthorityFingerprint`, and a
  `CertificateIssuer` of type JWK.

In RA mode `step ca init` calls `p.ForCreate`/`p.GetCertificateAuthority` rather
than generating keys locally when appropriate (the code path in `initAction`)
and sets `IsCreator` accordingly.

## The CAS interface abstraction

`step ca init` creates a `pki` object via `pki.New(casOptions, pkiOpts...)`, where
`casOptions.Type` selects the underlying `cas` (Certificate Authority Service)
implementation. `internal/cmd/root.go` blank-imports the enabled CAS packages
(`_ "github.com/smallstep/certificates/cas/cloudcas"`,
`_ "github.com/smallstep/certificates/cas/softcas"`,
`_ "github.com/smallstep/certificates/cas/stepcas"`), which is how
cloudcas/softcas/stepcas become available. `apiv1` options drive root/intermediate
generation (SoftCAS `IsCreator: true`) or delegated issuance (CloudCAS/StepCAS).

## What step ca init produces

`initAction` performs in order: seed the CA with a root (creating it via
`p.GenerateRootCertificate` or using `--root`/`--key` for an existing root), the
intermediate (`GenerateIntermediateCertificate`), optional SSH user/host signing
keys (`GenerateSSHSigningKeys` when `--ssh`), then either writes a Helm template
(`p.WriteHelmTemplate(os.Stdout)` with `--helm`) or saves the full PKI and CA
configuration (`p.Save()`).

KMS-backed keys are supported through `--kms`, `--kms-root`, `--kms-intermediate`,
`--kms-ssh-host`, `--kms-ssh-user` (Azure Key Vault). `initAction` creates a
`kms.KeyManager` from `kms.New` with `Type: kms.Type(kmsName)` and passes KMS URIs
to `pki.WithKeyURIs(...)`. The `--ra`/`--kms` combination is rejected as
incompatible (`errs.IncompatibleFlagWithFlag(ctx, "kms", "ra")`).

The `--pki` flag restricts generation to PKI-only (no CA config), and `--no-db`
omits the DB stanza (no persistence). `--remote-management` enables the Admin API
(adding `pki.WithAdmin()`), and `--acme` adds a default ACME provisioner
(`pki.WithACME()`) for standalone. The generated `ca.json` is what offline modes
load (see [CA flows](../architecture/ca-online-offline-flows.md)); an existing
CA config triggers a context warning via `cautils.WarnContext`.

## Installation/run outputs

Because deployment details of the remote cloud services are external, the CLI
only states what source establishes: hosted mode today prints guidance to run
`step ca bootstrap` with a team/authority; standalone/linked produce on-disk
configuration. The command is interactive by default but can run non-interactively
when the required flags are all present (`isNonInteractiveInit`).
