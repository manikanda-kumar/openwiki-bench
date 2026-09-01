---
type: flow
title: "SSH Certificate Workflows"
description: "How step ssh generates user/host keys and short-lived SSH certificates, logs in through the ssh-agent, renders client/server SSH config from CA templates, proxies connections via ProxyCommand with bastions, and renews/checks hosts including offline mode."
tags: [ssh, agent, certificates, proxycommand, login, renewal]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-73f7b910a9f89c04fc8a55ce
    resource: repo://command/ssh/certificate.go
  - id: openwiki-source-bfc6a972cd10bc5b5ab89a7d
    resource: repo://command/ssh/checkHost.go
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-f678876f04f1fb4fb8461d6a
    resource: repo://command/ssh/needsRenewal.go
  - id: openwiki-source-498288ff8c7e57e02661614f
    resource: repo://command/ssh/proxycommand.go
  - id: openwiki-source-b433bca309b52304b4f1d008
    resource: repo://command/ssh/renew.go
  - id: openwiki-source-2f73d8dd070a133a0cfba19e
    resource: repo://command/ssh/ssh.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# SSH Certificate Workflows

`step ssh` implements short-lived SSH certificates: the CA's user/host signing keys go to SSH clients and servers, while users authenticate with ephemeral keypairs plus CA-signed certificates held in the local **ssh-agent**. The command surface is `certificate checkHost config fingerprint hosts inspect list login logout needsRenewal proxycommand rekey renew revoke` (`command/ssh/ssh.go:84-101`).

## The agent as the state store

`internal/sshutil` wraps the agent protocol (`DialAgent` over `SSH_AUTH_SOCK`; unix sockets or Windows named pipes) with filtered key queries: `WithSignatureKey` restricts to keys signed by given CA public keys, `WithCertsOnly` skips bare keys, `WithRemoveExpiredCerts` discounts expired certificates, and the agent is mutated via `AddCertificate`/`RemoveKeys`/`RemoveAllKeys` (`internal/sshutil/agent.go:20-260`). "Logged in" therefore means *a valid CA-signed certificate is loaded in the agent* — `step ssh logout` removes only step-CA-signed keys by default and everything with `--all` (`command/ssh/logout.go:27-31`, `command/ssh/logout.go:78-98`).

## `step ssh login`

`loginAction` hard-requires an agent (`sshutil.DialAgent` at `command/ssh/login.go:154-158`). Unless `--force`, it checks the agent for an existing, non-expired key signed by the CA's user keys (`client.SSHRoots()`) and exits early if found (`command/ssh/login.go:159-183`). Otherwise it reuses the enrollment machinery from [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md): `CertificateFlow.GenerateSSHToken(ctx, subject, SSHUserSignType, principals, validAfter, validBefore)` produces an SSH sign token whose `step.ssh` claim carries cert type, principals, and validity windows (`command/ssh/login.go:186-201`, `utils/cautils/certificate_flow.go:209-232`, `utils/cautils/token_generator.go:125-142`). Two notable behaviors:

- `validAfter` defaults to **one minute in the past** so freshly minted certificates aren't rejected for client/CA clock skew (`command/ssh/login.go:190-194`).
- For OIDC tokens the subject is forced to the ID token's email; otherwise the token's `sub` wins over the CLI argument, because the provisioner's identity function derives principals (`command/ssh/login.go:240-248`).

A new keypair is generated in memory; if the CA reports `RequireClientAuthentication` (checked via `client.Version()`), an x509 *identity certificate* is requested in the same call (`ca.CreateIdentityRequest` → `SSHSignRequest.IdentityCSR`) and written as the default identity (`command/ssh/login.go:203-283`). The signed certificate plus private key go into the agent; with `--add-user` a second "provisioner" keypair/certificate is also generated and loaded (`command/ssh/login.go:285-302`). `step ssh certificate` is the on-disk counterpart, writing OpenSSH-format key/cert files (private 0600, public 0644, optional passphrase with CA-provided minimum length) (`command/ssh/certificate.go:330-510`).

## Host-side registration and validation

- `step ssh certificate --host` issues host certificates; `step ssh rekey`/`renew` rotate them. Renewal uses **SSHPOP** — the existing certificate authenticates the request: the command sets `sshpop-cert`/`sshpop-key` to the certificate/key files and passes the certificate's serial as the token subject against the `/1.0/ssh/renew` audience, then posts `SSHRenew{OTT}` (`command/ssh/renew.go:96-131`).
- `step ssh check-host <hostname>` asks the CA `SSHCheckHost`; when the CA requires client authentication it signs the check token with the stored default identity key (`ca.LoadDefaultIdentity`), and exits 0/1 (optionally printing true/false with `--verbose`) so it can gate automation (`command/ssh/checkHost.go:28-45`, `command/ssh/checkHost.go:61-110`).
- `step ssh hosts` lists registered hosts via `SSHGetHosts` (`command/ssh/hosts.go:50-67`), and `step ssh needs-renewal` returns nonzero when a certificate has passed 66% of its lifetime by default (`command/ssh/needsRenewal.go:33-49`).

## `step ssh config` — CA-templated SSH configuration

`step ssh config` is client- or server-side setup driven by **templates stored in the CA**, not local boilerplate. It requests `SSHConfig(type=user|host, data)` where `data` includes `GOOS`, `StepPath`, `StepBasePath`, a template version key, the active context name, and `--set key=value` overrides; for user configs it discovers `User` from the first valid principal of an agent-held certificate and fails with "run `step ssh login`" if none exists. Returned `api.Template`s are written to their paths (0600-ish handling delegated to `Template.Write`) or printed with `--dry-run` (`command/ssh/config.go:112-300`). With `--roots`/`--federation` it instead prints the CA's SSH user/host public keys, mapping HTTP 404 to "step certificates is not configured with SSH support" (`command/ssh/config.go:160-205`). `--team [team] --team-authority ssh` bootstraps a hosted authority first (`command/ssh/config.go:129-145`).

## `step ssh proxycommand` — SSO-style connect

Designed for an ssh client config `ProxyCommand` line (`command/ssh/proxycommand.go:38-48`), `proxycommand <user> <host> <port>`:

1. `doLoginIfNeeded` inspects the agent (CA-signed, unexpired keys) and, when absent, runs the full login flow silently — keypair, SSHPOP-free user token with `validAfter = now − 1m`, `SSHSign`, `agent.AddCertificate` (`command/ssh/proxycommand.go:101-200`).
2. It queries `SSHBastion(user, host)`; with a bastion configured it execs the system `ssh` (from `PATH`, falling back to `/usr/bin/ssh`) with the bastion's user/port/flags and either the bastion-provided command or `nc host port` (`command/ssh/proxycommand.go:266-291`); otherwise it relays stdin/stdout over a direct TCP connection, buffering and closing each direction independently to avoid the deadlock when sshd closes while stdin stays open (smallstep/cli#1641) (`command/ssh/proxycommand.go:229-264`).

## Offline SSH

All SSH client methods are implemented by the in-process authority in `--offline` mode: `SSHSign` authorizes the OTT then calls `authority.SignSSH`, `SSHRenew`/`SSHRekey`/`SSHRevoke`/`SSHCheckHost`/`SSHGetHosts` map to the corresponding authority methods, and `SSHRoots`/`SSHConfig` serve from `ca.json` — so the same login/renew/config commands work against a `ca.json` without a server (`utils/cautils/offline.go:345-537`).

## See also

- Token plumbing shared with X.509: [CA Enrollment, Token, and Signing Flows](/openwiki/flows/ca-enrollment.md)
- Timer-driven renewal: [Renewal Automation and systemd Units](/openwiki/operations/renewal-and-systemd.md)
