---
type: "Reference"
title: "Change guide modify flows"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---


## Goal

This guide describes where and how to modify the CA token-generation and
certificate-provisioning flows in `utils/cautils` when you add a new provisioner
type or alter flow behavior)Skip.

## Where the flow lives

The flow logic is concentrated in two filesSkip:

- [`utils/cautils/token_flow.go`](../../utils/cautils/token_flow.go) — one-time
  token generation (`NewTokenFlow`, `NewIdentityTokenFlow`,
  `OfflineTokenFlow`), audience derivation (`parseAudience`), provisioner
  selection (`provisionerPrompt`), and the dispatch by provisioner concrete type.
- [`utils/cautils/certificate_flow.go`](../../utils/cautils/certificate_flow.go)
  — `CertificateFlow` and its `GenerateToken`, `GetClient`, and related methods
  that combine token generation with client construction to retrieve a
  certificate.

## The flowContext / Option pattern

`certificate_flow.go` defines `flowContext`, which carries shared state across
commands:

```go
type flowContext struct {
    DisableCustomSANs       bool
    SSHPublicKey            ssh.PublicKey
    CertificateRequest      *x509.CertificateRequest
    ConfirmationFingerprint string
    CustomAttributes        map[string]interface{}
}
var sharedContext flowContext
```

`sharedContext` is a package-level variable so that state set while generating a
token can be used later in the same process when building the request. It is
shared between commands (comment on the variable notes "used to share
information between commands").

Contributors attach options via the `Option` interface and helper constructors
`WithSSHPublicKey`, `WithCertificateRequest`, `WithConfirmationFingerprint`, and
`WithCustomAttributes`. The `funcFlowOption` adapter implements `Option` over a
function that mutates the context. `NewCertificateFlow` and `NewTokenFlow` apply
options to `sharedContext` before running the flow.

## Adding a new provisioner type to the token dispatch

When a new provisioner is added upstream in
`github.com/smallstep/certificates/authority/provisioner`, wire it into the
token flow:

1. In `NewTokenFlow` (`token_flow.go`), add a `case` for the new concrete
   provisioner type under the existing `switch p := p.(type)` dispatch, calling
   an appropriate token generation method (e.g. `generateJWKToken`,
   `generateOIDCToken`, `generateX5CToken`, `generateNebulaToken`,
   `generateSSHPOPToken`, `generateK8sSAToken`, or a cloud `GetIdentityToken`).
   If the new provisioner does not support token auth flows, mirror the ACME/SCEP
   pattern and return a typed error.
2. In `provisionerPrompt`, add the new type to the provisioner list displayed and
   to any flag-driven filter (`--x5c-cert`/`--x5c-key`, `--sshpop-cert`/`--sshpop-key`,
   `--nebula-cert`/`--nebula-key`, `--k8ssa-token-path`), and add the type name to
   the default "list all" filter that decides which provisioners are selectable.
3. If the provisioner maps to a specific flag, define/register that flag in
   `flags/flags.go` and add the corresponding filter branch.

## ACME and SCEP return errors

`NewTokenFlow` returns `ACMETokenError` (message "step ACME provisioners do not
support token auth flows") and `SCPETokenError` for those provisioner types.
These are deliberate: ACME uses its own challenge-based flow, and SCEP does not
use OTTs. When adding another non-token provisioner, follow the same typed-error
pattern.

## Offline mode considerations

`OfflineTokenFlow` and `OfflineCA` (see [ca-integration.md](ca-integration.md))
build tokens from the local `ca.json` created by `step ca init`, so new
provisioners must surface here too for offline signing. New types that rely on
interactive/cloud identity may need an offline analogue or an explicit error.

## The CertificateFlow client path

When `CertificateFlow.GetClient` runs, it inspects the parsed OTT: if the token
has a root `sha` claim and an `http`-prefixed audience it uses
`ca.WithRootSHA256(jwt.Payload.SHA)`; otherwise it requires `--ca-url`/`--root`
and uses `ca.WithRootFile`. If you introduce new token header/claim semantics
(e.g. a new confirmation or attestation claim), update this client-construction
branch accordingly.

## Related

- [ca-integration.md](ca-integration.md) — the overall CA integration and flows.
- [token-claim.md](token-claim.md) — how the OTT claims are serialized/signed.
- [change-guide-add-command.md](change-guide-add-command.md) — adding a command
  surface that calls these flows.
