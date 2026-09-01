---
type: guide
title: "Change Guide: Support a New Provisioner Type"
description: "Maintenance recipe for teaching step's token flows about a new step-ca provisioner type: where the type comes from, the token-flow dispatch and prompt filters to extend, flag and token-option conventions, the duplicated offline dispatch, and the tests to touch."
tags: [guide, provisioners, tokens, ca, change-guide]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-7bd911fdd3026b7b031a01e3
    resource: repo://go.mod
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-94215bbc8923986ec4e6eb4f
    resource: repo://token/options_test.go
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-fc5b5a27a7859a84bf6b4e2a
    resource: repo://token/provision/provision_test.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-d65498dad1900ee9e4309461
    resource: repo://utils/cautils/token_flow_test.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# Change Guide: Support a New Provisioner Type

When `step-ca` gains a provisioner type, the CLI must learn to *select* and *token-generate* for it. Scope this first: the provisioner structs, their `Type` constants, and server-side validation all live in the external `github.com/smallstep/certificates/authority/provisioner` module (`utils/cautils/token_flow.go:17-18`, `go.mod:16`); this repository only consumes them. A CLI change is meaningless without a matching CA release, and the CA *must* recognize the token shape the CLI emits.

There are two common shapes to copy:

- **Credential-header provisioners** (X5C, SSHPOP, Nebula): the client proves possession of a certificate/key by embedding the credential in a JWT header.
- **Identity-provider provisioners** (GCP/AWS/Azure/K8sSA/OIDC): the cloud/cluster hands back an opaque token used as the OTT verbatim — `token_flow.go` mostly delegates (`utils/cautils/token_flow.go:170-178`). The rest of this guide follows the header shape (the Nebula addition is the most recent reference implementation).

## 1. Flags

Add the credential flags to `flags/flags.go` following the existing `NebulaFlag`/`NebulaKeyFlag`/`SSHPOPFlag` pattern (`flags/flags.go:357-385`), and attach them to `step ca token` and any commands that build tokens (`command/ca/token.go`, ssh counterparts).

## 2. Selection wiring in `token_flow.go`

Three places in `utils/cautils/token_flow.go`:

- `provisionerPrompt`'s auth-flag pre-narrowing: mirror the `allowNebulaProvisionerFilter` case so passing `--<type>-cert` restricts candidates to the new family (`utils/cautils/token_flow.go:291-305`, `utils/cautils/token_flow.go:275-289`).
- The default allow-list of `p.GetType()` values (JWK, OIDC, ACME, SCEP, K8sSA, X5C, SSHPOP, Nebula, GCP, AWS, Azure) — a type not listed can never be interactively selected (`utils/cautils/token_flow.go:306-319`).
- The `switch p := p.(type)` dispatch at the bottom of `NewTokenFlow` returning the new `generate<Type>Token` (`utils/cautils/token_flow.go:160-185`).

The per-display-name mapping in the prompt loop (`provisionersSelect`) should also include the type so the UI label is sensible (`utils/cautils/token_flow.go:371-390`).

## 3. The generator function

Model `generate<Type>Token` in `utils/cautils/token_generator.go` on `generateNebulaToken` (`utils/cautils/token_generator.go:275-310`):

1. Read the credential flags; fail with `errs.RequiredWithProvisionerTypeFlag` if absent (`utils/cautils/token_generator.go:276-283`).
2. Load the signing key — prefer `cryptoutil.LoadJSONWebKey(ctx.String("kms"), keyFile, opts...)` so KMS URIs work, and honor the provisioner password via `getProvisionerPasswordOption` (`utils/cautils/token_generator.go:292-301`, `utils/cautils/token_generator.go:325-332`, `utils/cautils/token_generator.go:380-440`).
3. Build the audience with the provisioner-ID fragment convention these types use: `fmt.Sprintf("%s#%s", tokAttrs.audience, p.GetIDForToken())` (`utils/cautils/token_generator.go:302-303`).
4. Dispatch the requested `tokType` (Sign/Revoke/SSH user/host/renew…) through `TokenGenerator.SignToken`/`RevokeToken`/`SignSSHToken`/`Token`, threading your new `token.With<Type>Cert(...)` option into each, and error on unsupported types (`utils/cautils/token_generator.go:304-310`).

## 4. Token shape

In `token/options.go`, add an `Options` function that validates the credential and attaches it — headers via `c.SetHeader("nebula", b)` (see the full `WithNebulaCert` implementation reading v1/v2 PEM banners and verifying the key matches), and extra claims via `c.Set(key, value)` on `token.Claims` (`token/options.go:261-317`, `token/token.go:50-62`). If the *server's* token payload for the type needs CLI-side parsing later (e.g. for SAN defaults), extend `token.Payload`/`Type()` in `token/parse.go`, being aware that type inference is an ordered heuristic (`sha`/`sans` claims → JWK, else classic OIDC claims, etc.) and a new shape can collide with existing branches (`token/parse.go:64-82`). Remember the library hooks: signing runs through `go.step.sm/crypto/jose`, and prompt/password behavior is already wired in `newApp` (`internal/cmd/root.go:97-103`).

## 5. Don't forget the offline duplicate

`OfflineCA.GenerateToken` re-implements the same type switch against provisioners parsed from `ca.json` (`utils/cautils/offline.go:539-601`); add the identical case there or offline mode breaks for the new type. Audience mapping for offline comes from `OfflineCA.Audience` (`utils/cautils/offline.go:141-159`).

## 6. Validation

- Unit tests: `token/options_test.go` for the new option (`token/options_test.go:26`), `utils/cautils/token_flow_test.go` for prompt/filter behavior (`utils/cautils/token_flow_test.go:31`), `token/provision/provision_test.go` for claim defaults (`token/provision/provision_test.go:24`).
- Run `make test && make lint`; the help-quality txtar tests will police any new usage text (`integration/help_test.go:14-45`).
- Add a CHANGELOG entry as for any behavior change (`docs/local-development.md:13-14`).
- True end-to-end verification needs a `step-ca` that enforces the provisioner; this repo only proves client-side shape (`go.mod:16` — the `smallstep/certificates` dependency pins which server behaviors are available).

## See also

- [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md) — what each touched code path does at runtime
- [Change Guide: Add a New Command](/openwiki/guides/adding-a-command.md) — general contribution mechanics
