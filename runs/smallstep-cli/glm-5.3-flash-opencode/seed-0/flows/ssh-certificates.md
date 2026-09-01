---
type: workflow-page
title: SSH Certificate Lifecycle
description: The step ssh command family - certificate issuance, agent-integrated login, identity certificates with machine UUID SANs, config installation, and bastion proxying.
tags: [ssh, certificates, agent, login, bastion, proxycommand]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-73f7b910a9f89c04fc8a55ce
    resource: repo://command/ssh/certificate.go
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-f22687e3ddd183c70e3a6bc8
    resource: repo://command/ssh/proxycommand_test.go
  - id: openwiki-source-498288ff8c7e57e02661614f
    resource: repo://command/ssh/proxycommand.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

The `step ssh` family manages short-lived SSH user and host certificates backed by a
step-ca SSH provisioner. It leans heavily on the ssh-agent for state and on the same
token machinery as X.509 flows (see the tokens page).

## Command surface and shared helpers

`step ssh` registers certificate, check-host, config, fingerprint, hosts, inspect,
list, login, logout, needs-renewal, proxycommand, rekey, renew, and revoke
(command/ssh/ssh.go:84-100). Two helpers shape the flows: `GenerateSSHToken` on the
certificate flow (audience `<ca-url>/1.0/ssh/sign`, offline support) and
`loginOnUnauthorized` (ssh.go:164-252) — an unauthorized-callback that, when the CA
requires client authentication, generates an OIDC identity token, creates an x509
identity CSR via `ca.CreateIdentityRequest`, signs it with `SSHSign`, and writes the
default identity via `ca.WriteDefaultIdentity`.

## step ssh certificate

`certificateAction` (command/ssh/certificate.go:221-549) takes `<key-id> <key-file>`
and derives fixed suffixes: `<key>.pub` and `<key>-cert.pub` (certificate.go:229-232).
Key steps:

1. **Cert type.** `--host` selects `SSHHostCert`/`SSHHostSignType`, otherwise
   `SSHUserCert`/`SSHUserSignType` (certificate.go:295-301). Default principals come
   from the subject — the whole subject for hosts, parsed parts for users via
   `createPrincipalsFromSubject` (certificate.go:303-310).
2. **Key.** With `--sign`, an existing authorized key is parsed as input
   (optionally with its private key via `--private-key`); otherwise a keypair is
   generated from `--kty/--curve/--size` (certificate.go:318-346).
3. **Token.** Unless `--token` is supplied, `flow.GenerateSSHToken` runs the
   provisioner dispatch (JWK/OIDC/X5C/SSHPOP/... as described by the tokens page)
   (certificate.go:348-356).
4. **CA call.** `caClient.SSHSign` submits the public key, OTT, principals, cert
   type, key ID, validity window, optional add-user public key, identity CSR, and
   template data (certificate.go:449-460).
5. **Identity certificate.** When `version.RequireClientAuthentication` is true,
   an x509 identity CSR is created; for **host** certs a URI SAN is prepended —
   "there is code that expects the uuid URI to be the first one"
   (certificate.go:377-414). The UUID comes from `--host-id machine` (derived from
   `/etc/machine-id` via blake2b with key `"man moon machine"`, then formatted as a
   v4 UUID), an explicit UUID, reuse of an existing identity cert's UUID (so
   re-running doesn't clobber the host ID), or a fresh random UUID
   (certificate.go:379-401; derivation helpers at certificate.go:559-581).
6. **Output.** The private key is serialized OpenSSH-style with password encryption
   (prompt, `--password-file`, or plaintext only via `--no-password --insecure`,
   certificate.go:466-489); public and certificate files are written 0644
   (certificate.go:491-498); `--add-user` produces a provisioner key triple named
   `<base>-provisioner*` (certificate.go:502-510).
7. **Agent.** Unless `--no-agent`, user certificates are added to the agent via
   `agent.AddCertificate(comment, cert, priv)` (certificate.go:529-540).

## step ssh login and the agent

`loginAction` (command/ssh/login.go:114-302) **requires an ssh-agent** —
`sshutil.DialAgent()` fails otherwise (login.go:154-159). Its idempotency contract:
without `--force`, it fetches the CA's user roots and asks the agent for a key with
the requested comment, filtering by signature key (certs signed by the CA) and
removing expired certs as a side effect; a valid existing key returns early with
"already present in the SSH agent" (login.go:161-183).

Token generation back-dates `validAfter` by one minute to avoid
"Certificate invalid: not yet valid" errors from clock skew (login.go:190-201).
For OIDC tokens the subject is overridden with the token email; for others the token
subject is used when no identity was given (login.go:238-248). After `SSHSign`, the
identity certificate is written when required (login.go:278-283), and both the user
certificate and optional add-user certificate are loaded into the agent
(login.go:285-299). Agent failures are reported inline rather than failing the
command (login.go:286-287).

`step ssh logout` removes only CA-signed keys with the given comment — falling back
to any certificate when CA roots are unavailable — via `agent.RemoveKeys`
(command/ssh/logout.go).

### Agent implementation details

`internal/sshutil.Agent` wraps `agent.ExtendedAgent` plus its connection
(internal/sshutil/agent.go:84-99); `DialAgent` uses `$SSH_AUTH_SOCK` with
platform-specific dialers (agent_unix.go/agent_windows.go). Filtering options drive
every listing operation: `WithSignatureKey` matches the certificate's signature key
against the CA's public keys (agent.go:31-52), `WithCertsOnly` keeps only
certificate-bearing keys (agent.go:54-62), and `WithRemoveExpiredCerts` actively
removes expired certificates from the agent during listing (agent.go:64-79).
`AddCertificate` computes the agent key lifetime as `ValidBefore - now` (0 =
infinite), refuses already-expired certificates, and **forces lifetime 0 on
Windows** because the Windows agent rejects lifetimes (agent.go:244-271).

## step ssh config

`configAction` (command/ssh/config.go) installs SSH client/host configuration
rendered from CA templates. It applies contexts (`step.Contexts().Apply`), supports
bootstrapping a team authority, and wires the `loginOnUnauthorized` retry
(config.go:147-162). With `--roots`/`--federation` it prints the user/host CA
public keys in authorized_keys format instead (config.go:165-199). Otherwise it
builds template data — `GOOS`, `StepPath`, `StepBasePath`, the SSH template
version key `v2`, the current context name when contexts are enabled, `Console`
when `--console`, and `--set` key/values (config.go:201-221) — detects `User` from
agent certificates signed by the CA (erroring with "please run `step ssh login
<identity>`" when absent, config.go:223-250), fetches templates with
`client.SSHConfig` (config.go:252-265), and writes them with `t.Write()` or prints
them under `--dry-run` (config.go:288-301).

## step ssh proxycommand

`proxycommandAction` (command/ssh/proxycommand.go:70-96) is the `ProxyCommand`
helper for `ssh_config`. It: (1) checks the agent for a valid CA-signed key and
performs a full login if missing — `doLoginIfNeeded` (proxycommand.go:100-216),
including the identity-cert and one-minute-backdating behaviors; (2) queries the
CA for a bastion via `client.SSHBastion` (proxycommand.go:218-227); and (3)
connects either through the bastion by re-executing `ssh` with the bastion
user/port/flags and `nc host port` (or a CA-provided command rendered via
`sshutil.ProxyCommand`), or directly by opening a TCP connection and piping
stdin/stdout bidirectionally (proxycommand.go:229-264). The direct path returns as
soon as either direction finishes — waiting for both can deadlock when the server
closes while stdin stays open (fix referencing smallstep/cli#1641,
proxycommand.go:246-249).

## Remaining commands

`check-host` answers "is this host known to the CA" (exit 1 when unknown),
optionally authenticating with an x5c-identity token when client authentication is
required; `hosts` lists hosts via `client.SSHGetHosts`; `inspect`/`fingerprint`
display certificates; `renew`/`rekey`/`revoke` mirror the X.509 lifecycle against
the `/1.0/ssh/*` audiences described by the tokens page; and `needs-renewal`
applies the same exit-code contract as its X.509 sibling.

## Representative tests

The proxycommand direct-connect path has unit tests with injected I/O
(command/ssh/proxycommand_test.go); the wider family is exercised through the
token/CA layers rather than dedicated command tests.
