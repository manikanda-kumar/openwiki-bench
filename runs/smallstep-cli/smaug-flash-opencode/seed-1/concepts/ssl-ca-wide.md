---
type: concept
title: SSH Certificates and Agent Integration
description: How step ssh signs SSH user/host certificates, derives principals and host IDs, and integrates with the SSH agent, hosts and proxycommand.
tags: [ssh, certificates, agent, principal, proxycommand, step-cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:42:28.757Z
sources:
  - id: openwiki-source-73f7b910a9f89c04fc8a55ce
    resource: repo://command/ssh/certificate.go
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-498288ff8c7e57e02661614f
    resource: repo://command/ssh/proxycommand.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-876dd76a7d08abaa279d8607
    resource: repo://internal/sshutil/sshutil.go
generated: { by: "opencode", at: "2026-09-12T20:42:28.757Z" }
---

# SSH Certificates and Agent Integration

The `step ssh` command group signs and manages SSH user/host certificates via
a step-ca, obviating per-machine trust of many keys: clients/servers trust only
the CA signing key. Subcommands cover `certificate`, `login`, `logout`,
`config`, `inspect`, `list`, `hosts`, `needsRenewal`, `rekey`, `renew`,
`revoke`, `checkHost`, fingerprint, and `proxycommand`
(`command/ssh/ssh.go`).

## Certificate types and principal derivation

`step ssh certificate` generates a key pair (or signs an existing public key
with `--sign`) and requests a user or host certificate:

- `--host` requests a host certificate; otherwise a user certificate.
- `--add-user` additionally requests an "add user" provisioning certificate.

Principals default differently for users and hosts. For user subjects, the
principal is the sanitized local part of an email (e.g. `joe` from
`joe@work`), with the local part and full subject appended when different
(`createPrincipalsFromSubject`, `command/ssh/ssh.go`). For host certificates,
the subject is used directly (`command/ssh/certificate.go`).

Output file names follow SSH conventions: `<name>` private key, `<name>.pub`
public key, `<name>-cert.pub` certificate (`command/ssh/certificate.go`).

## SSH agent integration

`sshutil.Agent` wraps the `golang.org/x/crypto/ssh/agent` client over
`SSH_AUTH_SOCK` (`internal/sshutil/agent.go`). It supports listing keys,
retrieving a key by comment, and adding certificates with a computed lifetime
(the certificate remains in the agent until its `ValidBefore`, unless infinite
or on Windows, where lifetime is 0). Expired certificates can be removed
automatically via `WithRemoveExpiredCerts` (`internal/sshutil/agent.go`).

`step ssh login` requires a live SSH agent, checks whether the certificate is
already present (unless `--force`), otherwise signs a new user certificate and
adds it to the agent (`command/ssh/login.go`). `step ssh logout` removes
certificates from the agent. `step ssh list` lists agent keys/certificates.

## Config, roots, and federation

`step ssh config` configures SSH to use certificates by writing user/host
environment config derived from step-ca templates; `--roots` prints the public
keys used to verify user certificates, and `--federation` lists federated
roots (`command/ssh/config.go`).

## Hosts, checkHost, and proxycommand

- `step ssh hosts` lists hosts accessible through the CA host registry.
- `step ssh checkHost` checks whether a principal exists as a host.
- `step ssh login` / `proxycommand` consult the host registry; `proxycommand`
  acts as an ssh `ProxyCommand`, adding the user to the agent if necessary and
  proxying the connection according to host registry config
  (`command/ssh/proxycommand.go`).

## Host identity: host-id and machine-id

For host certificates, an X.509 identity certificate with a URI SAN is
required. The host UUID is derived:

- Auto-derived or read from an existing default identity cert.
- `--host-id machine` derives a deterministic v4-format UUID from
  `/etc/machine-id` using BLAKE2b keyed hashing (`deriveMachineID`).
- A explicit UUID may be given.

This stable host ID enables re-running the command and recurring host identity
(`command/ssh/certificate.go`).

## Key parsing

`sshutil` parses SSH public keys and certificates into `crypto.PublicKey`
implementations, supporting RSA, ECDSA (P-256/384/521 and SK variants),
Ed25519/SK-Ed25519, and DSA (with deprecation linting enabled for
compatibility), and exposes `NewCertSigner` to create an SSH signer from a
certificate and private key (`internal/sshutil/sshutil.go`).
