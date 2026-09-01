---
type: flow
title: SSH Certificates
description: The step ssh command group — user/host certificate issuance, SSH agent integration (login/logout/list), config generation, host checking, hosts discovery, and bastion proxying.
tags: [ssh, certificates, agent, bastion, config]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-046008c13a5e35bec19892a7
    resource: repo://command/context/remove.go
  - id: openwiki-source-73f7b910a9f89c04fc8a55ce
    resource: repo://command/ssh/certificate.go
  - id: openwiki-source-bfc6a972cd10bc5b5ab89a7d
    resource: repo://command/ssh/checkHost.go
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
  - id: openwiki-source-0b43673e7972a33b56f2860f
    resource: repo://command/ssh/hosts.go
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-498288ff8c7e57e02661614f
    resource: repo://command/ssh/proxycommand.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# SSH Certificates

## Command group

`step ssh` registers: `certificate`, `check-host`, `config`, `fingerprint`,
`hosts`, `inspect`, `list`, `login`, `logout`, `needs-renewal`,
`proxycommand`, `rekey`, `renew`, and `revoke`. The SSH flows reuse the same
token machinery as X.509 but with SSH token types: `SSHUserSignType` and
`SSHHostSignType` target the `/1.0/ssh/sign` audience, plus
`SSHRevokeType`, `SSHRenewType`, and `SSHRekeyType` for the other lifecycle
endpoints (see [Token Generation](/openwiki/flows/token-generation.md)).

## Issuance: `step ssh certificate` and `step ssh login`

`certificateAction` writes three files for a subject and key base name:
`<key>`, `<key>.pub`, and `<key>-cert.pub`. `--host` switches the certificate
type to `SSHHostCert` with an `SSHHostSignType` token; user certificates use
`SSHUserCert`/`SSHUserSignType`. `--sign` signs an existing public key
instead of generating one, and `--add-user` requests an additional user
provisioner certificate (rejected together with `--host` or more than one
principal). Flag validation enforces `--no-password` requiring `--insecure`
and being incompatible with `--min-password-length` and `--password-file`,
and `--token` being incompatible with `--provisioner-password-file`. The
generated certificate is added to the SSH agent unless `--no-agent` is given.

`loginAction` is the interactive single-sign-on variant: it *requires* an SSH
agent (`sshutil.DialAgent`, connecting over `SSH_AUTH_SOCK`). Unless
`--force` is given, it first asks the CA for the user signature keys
(`client.SSHRoots()`) and probes the agent for an existing key with the
certificate's comment — removing expired certificates in the process — and
returns early when one is already present. Otherwise it generates an SSH
user token (`flow.GenerateSSHToken` with `SSHUserSignType`), generating a new
key pair according to `--kty/--curve/--size`. For OIDC tokens the subject is
taken from the token's email claim; when the CA requires client
authentication (`version.RequireClientAuthentication`), an identity
certificate request is also created. The resulting certificate is loaded
into the agent.

## SSH agent integration (`internal/sshutil`)

`sshutil.Agent` wraps `SSH_AUTH_SOCK` connections with certificate-aware
helpers: `GetKey(comment)` and `RemoveKeys(comment)` match keys by comment
and can filter by the CA's signature keys or drop expired certificates
(`WithSignatureKey`, `WithRemoveExpiredCerts`, `WithCertsOnly`),
`ListCertificates` enumerates SSH certificates, `AddCertificate` loads a
certificate plus private key, and `AuthMethod` exposes the agent for SSH
dialing. `login` and `logout` are thin wrappers over these helpers.

## Configuration: `step ssh config`

`configAction` bootstraps the team authority when `--team` is passed (via
`BootstrapTeamAuthority`, defaulting the authority sub-domain to `ssh`),
otherwise applies the active context (`step.Contexts().Apply`). With a retry
hook that triggers the login flow on "unauthorized" responses, it builds the
CA client and then either:

- prints the CA's user or host public keys (`--roots`, `--federation`), with
  a friendly error when the CA lacks SSH support (HTTP 404), or
- renders the SSH client (or server, `--host`) configuration from templates,
  feeding it `GOOS`, `StepPath`, `StepBasePath`, template version `v2`, the
  current context name when contexts are enabled, and `--set` variables.
  The generated config includes per-authority snippets under
  `$STEPPATH/ssh/includes` and a `ProxyCommand` using `step ssh proxycommand`,
  which is what makes `ssh <host>` transparently obtain certificates.

## Host discovery and validation

- `step ssh hosts` lists all valid hosts from the CA registry
  (`client.SSHGetHosts()`).
- `step ssh check-host <hostname>` asks the CA whether a certificate has
  been issued for the host (`client.SSHCheckHost`). When the CA requires
  client authentication, the command mints an `x5c-identity` token from the
  default identity (audience `/ssh/check-host`, `x5cInsecure` header) before
  the call; `--verbose` prints `true`/`false`.

## Proxying through bastions

`step ssh proxycommand <user> <host> <port>` is the `ProxyCommand` behind
generated configs. It logs the user in if no certificate is in the agent
(`doLoginIfNeeded`), asks the CA for bastion information
(`client.SSHBastion`), and then either relays the connection through the
returned bastion or connects directly, splicing the raw SSH byte stream
between stdin/stdout and the target.

## Lifecycle commands

`renew`, `rekey`, `revoke`, and `needs-renewal` mirror their X.509
counterparts against the `/1.0/ssh/...` endpoints with the corresponding SSH
token types, and `fingerprint`/`inspect` operate on SSH certificate files.
