---
type: "Reference"
title: "The step ssh Command Group"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-73f7b910a9f89c04fc8a55ce
    resource: repo://command/ssh/certificate.go
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-96ea4234c1703f7b144093dd
    resource: repo://command/ssh/logout.go
  - id: openwiki-source-498288ff8c7e57e02661614f
    resource: repo://command/ssh/proxycommand.go
  - id: openwiki-source-b433bca309b52304b4f1d008
    resource: repo://command/ssh/renew.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-876dd76a7d08abaa279d8607
    resource: repo://internal/sshutil/sshutil.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---


# The step ssh Command Group

`step ssh` creates and manages SSH certificates signed by a step-ca SSH CA. It
registers the subcommands `certificate`, `check-host`, `config`, `fingerprint`,
`hosts`, `inspect`, `list`, `login`, `logout`, `needs-renewal`,
`proxycommand`, `rekey`, `renew`, and `revoke`.

The commands talk to step-ca through the shared flows described in
[CA Client and Certificate Flows](../ca/ca-client-and-flows.md); the SSH agent
integration lives in `internal/sshutil`.

## Agent integration (`internal/sshutil`)

- `sshutil.Agent` wraps `golang.org/x/crypto/ssh/agent`, connecting via
  `SSH_AUTH_SOCK` (`DialAgent`). It adds certificates with a lifetime derived
  from the certificate's `ValidBefore` (0 lifetime on Windows), lists/filters
  keys and certificates, and removes keys by comment.
- Filters support `WithSignatureKey` (only keys signed by given SSH CAs),
  `WithCertsOnly`, and `WithRemoveExpiredCerts`.
- `sshutil` also parses SSH keys into Go keys (`PublicKey`), creates cert
  signers (`NewCertSigner`), and formats public keys with type/size for
  fingerprint display.

## certificate

`step ssh certificate <key-id> <key-file>` generates an SSH key pair and signs
a certificate:

- By default it is a **user** certificate; `--host` makes it a **host**
  certificate. With `--sign` it signs an existing public key instead of
  generating a pair.
- Principals default from the subject (`createPrincipalsFromSubject`: the
  sanitized name, the local part before `@`, and the full subject).
- The flow calls `flow.GenerateSSHToken` (or uses `--token`) and then
  `caClient.SSHSign` with the public key, principals, cert type, key ID, and
  validity. If the CA requires client authentication
  (`version.RequireClientAuthentication`), it also creates an X.509 identity
  CSR (for hosts, embedding a host UUID URI — either an existing one, a new
  random UUID, `--host-id machine` derived from `/etc/machine-id`, or a given
  UUID).
- Output files: the OpenSSH private key (`0600`), the public key (`.pub`),
  and the certificate (`-cert.pub`, `0644`). With `--add-user` it also writes
  a provisioner key/cert used to create new users. Unless `--no-agent` is
  passed, user certificates are added to the SSH agent with the comment.

## login, logout, list

- `step ssh login [<identity>]` generates a key pair, signs a user
  certificate, and adds it to the SSH agent. It skips the flow if a matching
  (CA-signed, non-expired) key is already in the agent unless `--force`. For
  OIDC tokens the subject is the token email; a fresh identity is minted when
  the CA requires client authentication.
- `step ssh logout [<identity>]` removes keys from the agent: by default only
  keys signed by the CA (falling back to certs-only when roots can't be
  fetched), or everything with `--all`.
- `step ssh list [<subject>]` lists agent identities (fingerprints by default,
  raw keys with `--raw`).

## config, hosts, check-host, proxycommand

- `step ssh config` applies the SSH configuration templates from step-ca for
  the user or host environment (`--host`). `--roots`/`--federation` print the
  SSH CA public keys; `--dry-run` prints the templates instead of writing them.
  Template variables come from `--set`/`--set-file`, plus `GOOS`,
  `StepPath`, context name, and (for users) a `User` detected from an existing
  agent certificate.
- `step ssh hosts` returns the list of valid hosts for SSH.
- `step ssh check-host` checks whether a principal can be used to login to a
  host.
- `step ssh proxycommand <user> <host> <port>` looks up a host in the host
  registry and proxies the connection, logging the user into the agent if
  needed; it is meant to be used with OpenSSH's `ProxyCommand`.

## renew, rekey, revoke

- `step ssh renew <ssh-cert> <ssh-key>` renews an SSH **host** certificate
  (user certificates cannot be renewed this way), overwriting the certificate
  or writing to `--out`.
- `step ssh rekey` issues a new SSH certificate for a new key.
- `step ssh revoke` revokes an SSH certificate by serial or using the
  `sshpop` token flow.
- `step ssh needs-renewal` reports whether an SSH certificate needs renewal.

## inspect, fingerprint

- `step ssh inspect` prints SSH certificate details; `step ssh fingerprint`
  prints fingerprints (with `--certificate` including the certificate bytes).

## Relationship to other pages

- The token and client flows used by these commands are documented in
  [Provisioning Tokens](../ca/provisioning-tokens.md) and
  [CA Client and Certificate Flows](../ca/ca-client-and-flows.md).
