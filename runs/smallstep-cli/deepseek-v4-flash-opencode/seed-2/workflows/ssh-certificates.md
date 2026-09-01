---
type: workflow
title: SSH Certificate Workflows
description: The step ssh command group — obtaining and using short-lived SSH certificates, agent interaction, login/logout, client configuration, and the ProxyCommand host-registry flow.
tags: [workflow, ssh, certificates, agent]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
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
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# SSH Certificate Workflows

`step ssh` (command/ssh/ssh.go) turns the CA into an SSH certificate authority:
short-lived **user** and **host** certificates replace static SSH keys. The
group covers `certificate`, `login`, `logout`, `list`, `inspect`, `config`,
`hosts`, `check-host`, `needs-renewal`, `rekey`, `renew`, `revoke`,
`fingerprint`, and `proxycommand`.

## step ssh login

`loginAction` (command/ssh/login.go:114-302) is the user-facing entry point for
getting a certificate into the SSH agent:

1. Resolves the identity (`<identity>` positional or `--identity`) and defaults
   principals to `[subject]` when none are given; `--comment` defaults to the
   subject.
2. Dials the SSH agent (`sshutil.DialAgent`, via `SSH_AUTH_SOCK`).
3. Unless `--force`, it checks whether a key with the same comment and signed by
   the CA already exists in the agent (`agent.GetKey` with
   `WithRemoveExpiredCerts` + `WithSignatureKey(userRoots)`), and returns early
   if so.
4. Generates a provisioning token with `flow.GenerateSSHToken(ctx, subject,
   SSHUserSignType, principals, validAfter, validBefore)`. `validAfter` defaults
   to `now - 1 minute` to avoid "not yet valid" clock-skew errors.
5. Generates a fresh key pair (kty/curve/size, default EC P-256) and, with
   `--add-user`, a second key pair for the add-user certificate.
6. For OIDC tokens the subject is replaced by the token email (the provisioner
   applies the identity function for principals).
7. When `version.RequireClientAuthentication`, it creates an X.509 identity
   CSR (`ca.CreateIdentityRequest`) and, after signing, writes the default
   identity.
8. Sends the `api.SSHSignRequest` (public key, OTT, principals, `CertType:
   SSHUserCert`, key ID, validity, optional add-user key, identity CSR, template
   data) and adds the returned certificate + private key to the agent with
   `agent.AddCertificate`.

## SSH agent interaction

`internal/sshutil/agent.go` wraps `golang.org/x/crypto/ssh/agent`. It connects
to the agent over `SSH_AUTH_SOCK` (`DialAgent`, agent.go:90-94) and provides:

- **AddCertificate** (agent.go:245-271): computes the agent lifetime from the
  certificate's `ValidBefore` (0 = never expires for `CertTimeInfinity`, an
  error if already expired, and always 0 on Windows because the Windows agent
  rejects a lifetime).
- **Filters** as `AgentOption`s: `WithSignatureKey` (only certs signed by the
  given CA keys), `WithCertsOnly` (only keys that carry a certificate), and
  `WithRemoveExpiredCerts` (auto-removes expired certs).
- **Lookups/removal**: `GetKey`, `ListKeys`, `ListCertificates`, `RemoveKeys`,
  `RemoveAllKeys`, and `HasKeys`.

## step ssh logout

`logoutAction` (command/ssh/logout.go:78-143) removes keys from the agent. By
default it removes only certificates signed by the CA (`WithSignatureKey` with
the user roots, falling back to `WithCertsOnly` when roots cannot be fetched);
`--all` removes every key (or all keys for a subject).

## step ssh certificate

The `certificate` command signs a host or user certificate and writes the
key/cert to files instead of the agent. `createPrincipalsFromSubject`
(command/ssh/ssh.go:298-311) derives the default principals from a subject: the
sanitized principal, the local part of an email, and the original subject when
different. Host certificates use a UUID-derived host ID (`--host-id`, or
"machine" to derive from `/etc/machine-id`).

## ProxyCommand and host registry

`step ssh proxycommand <user> <host> <port>` (command/ssh/proxycommand.go) is
invoked from an ssh client `ProxyCommand` entry. `proxycommandAction`
(proxycommand.go:70-96):

1. Runs `doLoginIfNeeded`, which checks the agent for a CA-signed user
   certificate and, if absent, performs the login flow (token generation,
   `SSHSign`, agent add).
2. Queries the CA for a configured bastion (`client.SSHBastion`).
3. Connects **directly** (`proxyDirect`) by opening a TCP connection and copying
   stdin/stdout both ways, or **through a bastion** (`proxyBastion`) by exec'ing
   `ssh -l <user> -p <port> <bastion> nc <host> <port>` (or the bastion's
   configured `ProxyCommand`).

## Unauthorized retry and identity

`loginOnUnauthorized` (command/ssh/ssh.go:164-252) is a `ca.RetryFunc` for the
signing flows: when a request returns HTTP 401 **and** the CA reports
`RequireClientAuthentication`, it generates an OIDC identity token
(`flow.GenerateIdentityToken`), creates an identity CSR, signs an SSH user
certificate with that identity, writes the default X.509 identity, adds the SSH
certificate to the agent, and retries the request.

## Client configuration

`step ssh config` (command/ssh/config.go) applies the CA's SSH templates to
configure the client or host environment (`--host`), supports team bootstrapping
(`--team`), template variables (`--set`/`--set-file`), and `--roots`/
`--federation` to print the trusted SSH CA public keys. Context removal cleans
up the authority's line in `$STEPPATH/ssh/includes`
(command/context/remove.go:117).
