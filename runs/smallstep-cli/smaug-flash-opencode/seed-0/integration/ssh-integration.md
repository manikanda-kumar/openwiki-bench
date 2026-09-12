---
type: integration
title: SSH Certificate Integration
description: The step ssh command group for issuing, inspecting, and managing SSH certificates with the ssh-agent, plus proxycommand and sshutil helpers.
tags: [integration, ssh, certificates, ssh-agent, proxycommand]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-96ea4234c1703f7b144093dd
    resource: repo://command/ssh/logout.go
  - id: openwiki-source-498288ff8c7e57e02661614f
    resource: repo://command/ssh/proxycommand.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-876dd76a7d08abaa279d8607
    resource: repo://internal/sshutil/sshutil.go
  - id: openwiki-source-543c4095ac05cfd690f07de7
    resource: repo://utils/cautils/token_flow.go
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---

# SSH Certificate Integration

The `step ssh` command group (command/ssh/ssh.go) creates and manages SSH
certificates against a step-ca (or offline CA), interacting with the local
ssh-agent. Its subcommands are registered in `ssh.go:84-99`.

## Subcommands

- `certificate` — issue an SSH user or host certificate (`--host`).
- `login` — generate a key pair, request a signed user certificate, and add
  it to the ssh-agent.
- `logout` — remove a key from the ssh-agent (only step-signed certs by
  default, with `--all` to remove all).
- `list` — list keys in the agent.
- `inspect` — inspect an SSH certificate file or one in the agent.
- `config` — generate SSH templates/config.
- `hosts` — list hosts the user has access to (requires host registry).
- `checkHost` — check whether a principal is valid for a host.
- `needsRenewal` — determine whether an SSH cert needs renewal.
- `renew` / `rekey` / `revoke` — renew, rekey, or revoke SSH certificates.
- `proxycommand` — proxy SSH connections according to the host registry.

## login flow

`step ssh login` (command/ssh/login.go:114-302) generates a new SSH key pair and
requests a signed user certificate, then adds it to the agent.

- It connects to the ssh agent (`sshutil.DialAgent`) and, unless `--force`,
  checks for an existing cert signed by the CA roots, returning early when a
  valid key is already present.
- It obtains an SSH sign token via `flow.GenerateSSHToken(ctx, subject,
  SSHUserSignType, principals, validAfter, validBefore)` — the same token flow
  used for X.509 (see [Certificate and Token Flows](../architecture/token-flows.md)).
- It picks OIDC email / token subject as needed, generates the SSH public
  key, and calls `caClient.SSHSign` with the OTT, principals, cert type
  `SSHUserCert`, key ID, validity per nbf/naf, and any add-user key.
- If the CA requires client authentication, it also creates an identity
  (X.509) certificate and stores it.
- Finally the certificate is added to the agent; the `--add-user` flag also
  requests and stores an add-user certificate.

## logout flow

`step ssh logout` (logout go) removes a key from the ssh-agent (or all, with
`--all`), defaulting to removing only certificate keys signed by
step-certificates.

## proxycommand

`step ssh proxycommand <user> <host> <port>` (command/ssh/proxycommand.go)
looks up the host in the CA's host registry and proxies the SSH connection. It
is meant to be used with ssh's `ProxyCommand` keyword; it adds the user to the
agent if necessary before proxying.

## sshutil helpers

`internal/sshutil` provides SSH helpers used across these commands:

- `agent.go` wraps ssh-agent access with `AgentOption` functional options such
  as `WithSignatureKey(keys)` (filters to certs signed by given signing keys)
  and `WithCertsOnly` (filters to keys with certificates), plus methods to get
  `RemoveExpiredCerts`, add certificates, and query keys.
- `sshutil.go` provides `NewCertSigner` (builds a signing certificate signer),
  `ParseCertificate` (parse a marshaled SSH certificate), and `PublicKey` which
  converts an `ssh.PublicKey` into Go's `crypto.PublicKey` (RSA/ECDSA/Ed25519),
  with associated helpers.
- `shell.go`, `pipe.go`, and platform-specific `agent_unix.go`/`agent_windows.go`
  manage agent connections.

## SSHAuth and tokens

SSH signing/renewing/rekeying/revoking each use their own token type
(`SSHUserSignType`/`SSHHostSignType`, `SSHRenewType`, `SSHRekeyType`,
`SSHRevokeType`) which map to `parseAudience` `/1.0/ssh/*` endpoints and feed
the `OfflineCA`'s `GenerateToken`/`SSHSign` flows.

## Related

- [Certificate and Token Flows](../architecture/token-flows.md) — token flow used by login.
- [Online and Offline step-ca Client Integration](ca-client.md) — SSH client methods.
