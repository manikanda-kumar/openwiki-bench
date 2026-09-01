---
type: "Reference"
title: "Guide: Extending CA Flows"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-ff8a7fe9f3a4815e9b6b5c30
    resource: repo://command/ca/sign.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-eac4c6d87c1234945c50c143
    resource: repo://utils/cautils/offline_test.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-d65498dad1900ee9e4309461
    resource: repo://utils/cautils/token_flow_test.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---


# Guide: Extending CA Flows

The CA flows (`utils/cautils`) are shared by many commands. Changes there
propagate widely, so this guide frames the main coupling points as
invariants to check before merging.

## Invariant 1: token types and audiences move together

`token_flow.go` defines the token type constants (`SignType`, `RevokeType`,
`SSHUserSignType`, `SSHHostSignType`, `SSHRevokeType`, `SSHRenewType`,
`SSHRekeyType`, `RenewType`) and `parseAudience` maps each to its
`/1.0/...` path. Three places must agree:

- `parseAudience` (online audiences);
- `OfflineCA.Audience` (offline audiences derived from the config's first
  DNS name — same list, different prefix);
- any per-provisioner generator switch (`generateJWKToken`,
  `generateX5CToken`, `generateNebulaToken`) whose `switch tokType` arms
  decide how a token type is materialized.

Adding a new token type without updating all three leaves one path failing
at runtime with "unexpected token type" or generating the default token
form. `TestOfflineCA_Audience` (`utils/cautils/offline_test.go`) pins the
offline mapping — extend it when the mapping changes.

## Invariant 2: every provisioner branch handles every relevant type

`NewTokenFlow` dispatches on provisioner type, and each generator switches
on token type. When adding a token type or provisioner:

- `provisionerPrompt` filters candidates by flags; new credential flags need
  a new filter arm or the provisioner will never be selected.
- ACME and SCEP intentionally error in token flows (`ACMETokenError`,
  `SCEPTokenError`); `step ca certificate` converts the ACME error into the
  ACME flow, so preserve that error type contract.
- Cloud provisioners (GCP/AWS/Azure) flow `DisableCustomSANs` into the
  shared context, which `CreateSignRequest` consults when synthesizing SANs.

`TestProvisionerPromptPrompts` covers prompt behavior for filtered
provisioner lists.

## Invariant 3: client construction has two trust paths

`CertificateFlow.GetClient` trusts the CA either from the token's `sha`
fingerprint claim plus `http(s)` audience (`ca.WithRootSHA256`) or from
`--root`/default root file plus `--ca-url`. Any change to token claim
names (`token.RootSHAClaim`) or audience shapes breaks this handshake —
the `sha` claim is written by `token.WithRootCA` and read here. The same
dual-path logic exists in `NewClient` (`utils/cautils/client.go`) and in
the renew flow's `RenewWithToken`.

## Invariant 4: offline and online parity

Offline mode (`NewOfflineCA`) is a singleton wrapping an in-process
authority. Keep in mind:

- `--offline` requires `--ca-config`; `OfflineTokenFlow` prioritizes the
  ca.json provisioners over flags and otherwise requires
  `--provisioner`/`--issuer` plus `--key`.
- `--token` is incompatible with `--offline` in `step ca certificate` and
  `step ca sign` because token generation itself consumes the offline CA.
- Audiences and `CaURL()` are synthesized from `config.DNSNames[0]` —
  commands must not assume a real network endpoint exists offline.

`TestOfflineCA_CaURL` and `TestOfflineCA_GetCaURL` pin the URL derivation.

## Invariant 5: shared context is process-global

`sharedContext` (`flowContext`) carries CSR fingerprints, confirmation
fingerprints, custom attributes, and `DisableCustomSANs` between flow
stages. It is a package-level var applied by options; commands that run
flows must set it through the `Option` API, and new fields must be plumbed
from token options (`token/options.go`) into `TokenGenerator` methods
explicitly.

## Checkpoints before merging

1. `make test` — unit suite; watch `utils/cautils` and `command/ca` tests
   (`TestOfflineCA_Audience`, `TestOfflineCA_CaURL`, `TestOfflineCA_GetCaURL`,
   `TestProvisionerPromptPrompts`, `command/ca/init_test.go`,
   `command/ca/sign_test.go`).
2. Grep for `tokType`/`SignType` switches when touching token types.
3. Grep for `parseAudience` and `Audience(` when touching audience paths.
4. Verify both `step ca certificate` and `step ca sign` (and their
   `--offline` variants) still compile against any `SignRequest` change —
   the API types come from `smallstep/certificates/api`, so upstream field
   changes flow through `flow.Sign`.
5. Remember `RenewType` tokens bypass provisioner selection entirely
   (`generateRenewToken` requires `--x5c-cert`/`--x5c-key`); don't add
   provisioner logic on that path accidentally.
