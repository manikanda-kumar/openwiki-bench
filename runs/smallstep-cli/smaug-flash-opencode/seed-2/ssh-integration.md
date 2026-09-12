---
type: integration
title: SSH Integration
description: How step generates, manages, and renews SSH user and host certificates)Skip including the command group, key parsing, SSH agent interaction, and the login flow.
tags: [ssh, ssh-certificates, ssh-agent, cert-authority]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-b433bca309b52304b4f1d008
    resource: repo://command/ssh/renew.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-876dd76a7d08abaa279d8607
    resource: repo://internal/sshutil/sshutil.go
  - id: openwiki-source-c2a1cbcd354ea6d2d5d35e69
    resource: repo://systemd/README.md
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---

## Responsibility

The `step ssh` command group ([`command/ssh/ssh.go`](../../command/ssh/ssh.go))
creates and manages SSH certificates (user and host) issued by a `step-ca`
(online or offline). With a certificate, servers trust only the CA key and verify
its signature on a certificate instead of trusting many user/host keys. It relies
on `internal/sshutil` for key parsing and SSH agent access.

## Command group overview

Subcommands registered in `ssh.go`:

- `certificate` — generate an SSH key pair and create a user or host certificate
  (`--host`), optionally signing an existing public key (`--sign`).
- `checkHost` — check whether a host is reachable using cert-authenticated SSH.
- `config` — configure SSH to use certificates.
- `fingerprint` — print the fingerprint of an SSH certificate/key.
- `hosts` — list hosts the user may access (`SSHGetHosts`).
- `inspect` — display SSH certificate contents.
- `list` — list keys/certificates in the agent.
- `login` — generate a key pair + user certificate and add it to the agent.
- `logout` — remove keys/certificates from the agent.
- `needsRenewal` — report whether a certificate should be renewed.
- `proxycommand` — ProxyCommand helper for cert-aware connections.
- `rekey` — request a new key pair with a renewed certificate.
- `renew` — renew an SSH (host) certificate to disk.
- `revoke` — revoke an SSH certificate.

`step ssh renew` can only renew host certificates (not user certificates).

## Key parsing and certificate signers

[`internal/sshutil/sshutil.go`](../../internal/sshutil/sshutil.go) provides parsing
of SSH public keys and certificates:

- `ParseCertificate(in)` parses marshaled bytes into a `*ssh.Certificate` using
  `ssh.ParsePublicKey`.
- `PublicKey(key)` converts an `ssh.PublicKey` to a Go `crypto.PublicKey`,
  dispatching on key type to `parseRSA`, `parseECDSA`, `parseED25519`, and
  `parseDSA`.
- `parseRSA` follows RFC 4253 §6.6 and validates the exponent range;
  `parseECDSA` follows RFC 5656 §3.1 over nistp256/384/521 via `ecdh`;
  `parseDSA` follows RFC 4253 §6.6.
- `NewCertSigner` wraps a private key and certificate into an `ssh.Signer` via
  `ssh.NewSignerFromKey` and `ssh.NewCertSigner`.

## SSH agent integration

[`internal/sshutil/agent.go`](../../internal/sshutil/agent.go) implements the SSH
agent client:

- `Agent` embeds `agent.ExtendedAgent` plus its `net.Conn`; `DialAgent()`
  connects using `SSH_AUTH_SOCK` (platform-specific in `agent_unix.go` /
  `agent_windows.go`).
- `HasKeys`, `ListKeys`, `ListCertificates`, `GetKey`, `GetSigner`, `RemoveKeys`,
  and `RemoveAllKeys` operate on agent keys, applying filter/option functions:
  `WithSignatureKey(keys)` filters certificates signed by given CA keys,
  `WithCertsOnly` keeps only certificate-backed keys, and
  `WithRemoveExpiredCerts(t)` auto-removes expired certificates.
- `AddCertificate(subject, cert, priv)` adds a certificate to the agent,
  computing the key `LifetimeSecs` as the time remaining until `ValidBefore`
  (0 for certs that never expire, or on Windows where the agent does not support
  a lifetime). It errors if the certificate is already expired.
- `AuthMethod` returns the agent as an `ssh.AuthMethod`.

## Login flow and client-auth retry

`step ssh login` ([`command/ssh/login.go`](../../command/ssh/login.go)) generates
a fresh SSH key pair and submits it to the CA for signing (via the shared
certificate flow), then adds the certificate to the agent.

In [`command/ssh/ssh.go`](../../command/ssh/ssh.go), `loginOnUnauthorized`
provides a `ca.RetryFunc` for handling `http.StatusUnauthorized`. When the CA
reports it requires client authentication (`version.RequireClientAuthentication`),
the flow:

1. Generates an OIDC identity token via `flow.GenerateIdentityToken(ctx)`
   which is the `step oauth` flow for the OIDC provisioner.
2. Derives the user principal from the token's email.
3. Generates a fresh SSH key pair and an X.509 identity CSR/request
   (`ca.CreateIdentityRequest(jwt.Payload.Email)`).
4. Calls `client.SSHSign` with the SSH public key, the OTT, `SSHUserCert` type,
   the email as `KeyID`, and the identity CSR + template data.
5. Writes the X.509 identity certificate and adds the SSH certificate to the
   agent (ignoring agent errors).

`createPrincipalsFromSubject` builds default principals for a subject: the
sanitized name, the local part if the subject is an email and differs, and the
original subject when different.

## Configuration and renewal automation

`step ssh config` ([`command/ssh/config.go`](../../command/ssh/config.go))
configures SSH to use certificates and can inspect the root CA certificates used
to sign them.

The repository ships systemd units under `systemd/`
([`systemd/README.md`](../../systemd/README.md)) for automating SSH certificate
renewal: `ssh-cert-renewer.service`, `ssh-cert-renewer.timer`, plus the X.509
counterparts `cert-renewer.target`/`cert-renewer@.service`/`cert-renewer@.timer`.
These are referenced by the step-ca renewal documentation.

## Relationships

The SSH flows reuse the same token/OTT and client machinery as the X.509 CA
integration ([ca-integration.md](ca-integration.md)), use the shared command
dispatcher ([architecture.md](architecture.md)), and consume identity tokens
produced by the OAuth flow ([oauth-command.md](oauth-command.md)).
