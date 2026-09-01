---
type: commands
title: step ssh command group and SSH utilities
description: The step ssh command group for issuing and managing SSH certificates, integrating with the SSH agent, inspecting certificates, configuring clients, and proxying connections, plus the internal/sshutil helpers.
tags: [step-cli, ssh, certificate, ssh-agent, proxycommand]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-73f7b910a9f89c04fc8a55ce
    resource: repo://command/ssh/certificate.go
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-498288ff8c7e57e02661614f
    resource: repo://command/ssh/proxycommand.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-af772892bc9f57ec50f9da80
    resource: repo://internal/sshutil/shell.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---

# step ssh command group and SSH utilities

`step ssh` creates and manages SSH certificates signed by a step-ca (online or
offline). The group registers `certificate`, `checkHost`, `config`,
`fingerprint`, `hosts`, `inspect`, `list`, `login`, `logout`, `needsRenewal`,
`proxycommand`, `rekey`, `renew`, and `revoke`
(`command/ssh/ssh.go:84-100`). The `internal/sshutil` package supplies the
agent and shell plumbing.

## Certificate issuance

`step ssh certificate <key-id> <key-file>` (`command/ssh/certificate.go:36-219`)
either generates a new SSH key pair (writing `<key-file>`, `<key-file>.pub`,
and `<key-file>-cert.pub`) or, with `--sign`, signs an existing public key.

- **User vs host**: `--host` selects a host certificate; user principals are
  derived from the subject via `createPrincipalsFromSubject` (local part of an
  email plus the full subject) unless `--principal` is given
  (`command/ssh/ssh.go:294-311`).
- **Host IDs**: host identity certificates get a URI SAN containing a UUID
  derived from `--host-id` (explicit UUID, `machine` = a v4 UUID keyed from
  `/etc/machine-id` via blake2b, or a previously stored host UUID)
  (`command/ssh/certificate.go:377-428`, `559-607`).
- **Client authentication**: when the CA requires client authentication
  (`version.RequireClientAuthentication`), an X.509 identity certificate is
  requested alongside the SSH certificate and saved to the default identity
  location (`command/ssh/certificate.go:368-432`, `516-520`).
- **`--add-user`**: additionally requests a provisioner ("add user") key and
  certificate so the user can create future users
  (`command/ssh/certificate.go:436-447`, `501-513`).
- The resulting user certificate+key are added to the SSH agent unless
  `--no-agent` (`command/ssh/certificate.go:528-540`).

## login, logout, list

- **`step ssh login`** requires a running SSH agent. It checks whether a
  certificate signed by the CA user keys already exists (filtering with
  `WithSignatureKey` and `WithRemoveExpiredCerts`) and skips the flow unless
  `--force`; otherwise it generates a key pair, signs a user certificate, and
  adds certificate+key to the agent
  (`command/ssh/login.go:154-301`).
- **`step ssh logout`** removes the user's certificate from the agent.
- **`step ssh list`** prints agent identities as fingerprints (or raw keys with
  `--raw`), optionally filtered by subject/comment (`command/ssh/list.go:62-105`).

For OIDC tokens the effective subject is the token email
(`command/ssh/login.go:241-248`), matching how OIDC provisioners assign
principals.

## Agent integration (internal/sshutil)

`sshutil.Agent` wraps `agent.ExtendedAgent` and connects through the
`SSH_AUTH_SOCK` socket via `DialAgent` (`internal/sshutil/agent.go:84-99`).
Key operations:

- **`AddCertificate`** adds a certificate+key with a lifetime derived from the
  certificate's `ValidBefore` (a non-expiring cert gets 0); Windows always uses
  0 because its agent does not support lifetimes
  (`internal/sshutil/agent.go:244-271`).
- **Filters**: `WithSignatureKey` (signed by specific signing keys),
  `WithCertsOnly`, and `WithRemoveExpiredCerts` are used by
  `HasKeys`/`ListKeys`/`GetKey`/`RemoveKeys` to select which agent keys count
  (`internal/sshutil/agent.go:31-79`, `106-242`).

`sshutil.NewCertSigner` builds an `ssh.Signer` from a certificate and key, and
`sshutil.ParseCertificate`/`PublicKey` convert between the SSH and Go crypto
representations (`internal/sshutil/sshutil.go:21-66`).

## Inspect and config

- `step ssh inspect` renders a human-readable summary of an SSH certificate
  via `sshutil.InspectCertificate`, matching `ssh-keygen` formatting
  (`internal/sshutil/inspect.go:42-101`).
- `step ssh config` writes client/host SSH configuration from the CA's SSH
  templates.

## Hosts, checkHost, and proxycommand

- **`step ssh hosts`** lists hosts from the CA registry and
  **`step ssh checkHost`** checks whether a principal is a registered host.
- **`step ssh proxycommand`** is used from `ProxyCommand` in the SSH client
  config. It (1) performs a login if the agent has no CA-signed user key
  (`doLoginIfNeeded`), (2) looks up a bastion via `client.SSHBastion`, and (3)
  either proxies through the bastion by exec'ing `ssh <bastion> nc <host>
  <port>` (with `%h`/`%p`/`%r` placeholders substituted) or dials the host
  directly over TCP (`command/ssh/proxycommand.go:70-96`, `218-295`).
- The bastion command placeholder substitution is implemented by
  `sshutil.ProxyCommand` (`internal/sshutil/shell.go:20-30`).

## Remote shell

`sshutil.Shell` (internal/sshutil/shell.go) implements an SSH client used for
interactive sessions and port forwarding: host-key verification via the user's
`known_hosts`, auth via agent/signers/certificates, a PTY `RemoteShell`, and
`LocalForward`/`RemoteForward` (`internal/sshutil/shell.go:101-288`).

## Failure handling

- Commands that require an agent (login, list, logout) return an error when
  `SSH_AUTH_SOCK` is unavailable (`command/ssh/login.go:154-159`).
- When the CA responds with HTTP 401 and requires client authentication,
  `loginOnUnauthorized` transparently runs an OIDC identity login and retries
  the request (`command/ssh/ssh.go:164-252`).
