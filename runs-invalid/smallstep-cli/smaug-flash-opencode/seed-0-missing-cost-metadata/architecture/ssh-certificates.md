---
type: concept
title: SSH Certificate Signing and Agent Management
description: How step ssh signs user and host SSH certificates, derives principals, integrates with the SSH agent for login/logout/list/renew/revoke, and provides proxycommand and remote-shell helpers.
tags: [ssh, ssh-certificates, ssh-agent, principal, proxycommand]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-73f7b910a9f89c04fc8a55ce
    resource: repo://command/ssh/certificate.go
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-af772892bc9f57ec50f9da80
    resource: repo://internal/sshutil/shell.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---

# SSH Certificate Signing and Agent Management

The `step ssh` command group signs and manages SSH certificates. It shares the
online/offline CA client abstraction with the X.509 flows but adds SSH-specific
principal handling and a deep SSH agent integration.

## The ssh command group

`step ssh` (`command/ssh/ssh.go`) registers `certificate`, `check-host`,
`config`, `fingerprint`, `hosts`, `inspect`, `list`, `login`, `logout`,
`needs-renewal`, `renew`, `revoke`, and `proxycommand`. Its package-level flags
cover the SSH-specific `--host`, `--host-id`, `--sign`, `--principal`,
`--add-user`, and `--private-key`.

## Requesting an SSH certificate: `step ssh certificate`

`certificate.go` implements `step ssh certificate <key-id> <key-file>`, which
either generates a fresh SSH key pair or, with `--sign`, uses the supplied
public key. It derives the output file names with fixed SSH suffixes:
`<key-file>.pub` and `<key-file>-cert.pub` (and `<key-file>-provisioner*` for
the add-user mode).

Validation rejects incompatible combinations (`--no-password` without
`--insecure`, `--token` with `--provisioner-password-file`, `--host` with
`--add-user`, `--host-id` without `--host`, and `--add-user` with more than one
principal). Certificate type is `SSHUserCert`/`SSHHostCert` and the matching
token type (`SSHUserSignType`/`SSHHostSignType`) is chosen from `--host`.

Principals are derived when not given via `--principal`:
- Host certificates default to the subject as the single principal.
- User certificates call `createPrincipalsFromSubject(subject)`, which takes the
  sanitized subject as the first principal, adds the local part of an
  `abc@def` subject if different, and appends the original subject when it
  differs (`ssh.go#createPrincipalsFromSubject`).

When the runtime requires client authentication (the CA reports
`RequireClientAuthentication` through `caClient.Version()`), the command builds
an X.509 identity CSR via `ca.CreateIdentityRequest`. For host certificates it
adds a URI SAN carrying a host UUID derived from an existing identity cert, the
`--host-id` value, or `/etc/machine-id` (via `deriveMachineID`, a
Blake2b-160 hash of the machine ID coerced into a v4 UUID) — the code notes that
the "uuid URI to be the first one".

After `SSHSign`, files are written with mode 0600/0644 and `--add-user` writes
the extra provisioner key/cert pair. Unless `--no-agent`, the certificate and
private key are added to the SSH agent (only user certificates and only when a
private key is available).

## Login, agent lifecycle, and the agent wrapper

`step ssh login` (`login.go`) generates a new SSH key pair using
`flags.GetKeyDetailsFromCLI`, obtains a signing token (or accepts `--token`),
and calls `caClient.SSHSign`. It requires an SSH agent (`sshutil.DialAgent`) and
skips signing when `GetKey` finds an existing valid key matching the comment
(unless `--force`). Before adding it checks the CA's SSH user roots and filters
for certificates signed by those keys. For OIDC tokens it uses the token's email
as the subject; otherwise the token subject is used. When client authentication
is required it writes an X.509 identity certificate (`ca.WriteDefaultIdentity`).

The agent wrapper (`internal/sshutil/agent.go`) connects via `SSH_AUTH_SOCK`
(`DialAgent`) and exposes filtered listing/removal with options like
`WithSignatureKey` (match certs signed by given signing keys), `WithCertsOnly`,
and `WithRemoveExpiredCerts` (auto-remove expired certificates). `AddCertificate`
computes the agent lifetime from the certificate's `ValidBefore`, rejecting
already-expired certs and ignoring lifetimes on Windows.

`step ssh list`, `logout`, and `login` build on these helpers:
- `list` inspects keys/certificates in the agent.
- `logout` removes a user's certificates.
- `renew`/`revoke` re-sign or revoke existing SSH certificates through the CA
  flow.

## Proxycommand and remote shell

`step ssh proxycommand` (`command/ssh/proxycommand.go`, tested by
`proxycommand_test.go`) prints the config needed to route `ssh` through a
bastion. `internal/sshutil/shell.go` implements the underlying SSH client used by
the SSH helpers: `ProxyCommand` substitutes `%%`, `%h`, `%p`, `%r`; `NewShell`
builds an `ssh.Client` against `~/.ssh/known_hosts` with configurable
`ssh.AuthMethod`s; `Run` executes a command; `RemoteShell` opens an interactive
login shell with a PTY; and `LocalForward`/`RemoteForward` set up port forwarding.
`requestPty` negotiates a term string from the `TERM` env with `xterm-256color`
as the preferred default.
