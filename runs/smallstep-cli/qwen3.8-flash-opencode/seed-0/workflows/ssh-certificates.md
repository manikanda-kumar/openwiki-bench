---
type: workflow
title: SSH Certificate Workflows
description: step ssh user/host certificate lifecycle — login/logout with ssh-agent integration, config templates fetched from the CA, proxycommand with bastion exec, renewal tooling and systemd units, plus crl inspection utilities.
tags: [ssh, certificates, agent, systemd, proxycommand, crl]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-8df833e7257eb456286e631b
    resource: repo://command/certificate/needsRenewal.go
  - id: openwiki-source-722bacb6403539bdaf6c7a35
    resource: repo://command/crl/inspect.go
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
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-02cba02a31978f84a900def3
    resource: repo://internal/crlutil/crlutil.go
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-91676838b983ce2dda111875
    resource: repo://internal/sshutil/pipe.go
  - id: openwiki-source-fe5b002eb6bab88c8a9f5a2c
    resource: repo://systemd/cert-renewer%40.service
  - id: openwiki-source-5b8432eb4ee5e7ab8f9f9b3a
    resource: repo://systemd/cert-renewer%40.timer
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---

# SSH Certificate Workflows

The `step ssh` group (command/ssh/ssh.go:84-100) implements single-sign-on SSH
on top of the same CA flows as X.509, using `SSHUserSignType`/
`SSHHostSignType` tokens (see
[CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)).
Key material never leaves the machine; the agent holds short-lived
certificates.

## User login: `step ssh login`

`loginAction` (command/ssh/login.go:154-296):

1. **Requires a running ssh-agent** via `sshutil.DialAgent()` — on Unix it
   connects to `$SSH_AUTH_SOCK`; on Windows it can use the named pipe,
   including the default `\\.\pipe\openssh-ssh-agent` or a `IdentityAgent`
   parsed from `%HOMEDRIVE%%HOMEPATH%\.ssh\config` (internal/sshutil/agent.go,
   internal/sshutil/pipe.go:11-35).
2. If a key with the requested **comment** (defaults to the subject) is
   already in the agent — filtered to CA-signed certs via
   `sshutil.WithSignatureKey(userKeys)` and swept of expired entries via
   `WithRemoveExpiredCerts(time.Now())` — it prints "already present" and
   exits without contacting the CA (login.go:167-181).
3. Otherwise it generates a fresh keypair, obtains an SSH user certificate
   through the CA (`cautils` token + `client.SSHSign`), and calls
   `agent.AddCertificate(comment, cert, priv)`; a CA "additional identity"
   certificate in the response is added too (login.go:285-295).

`step ssh logout <identity>` removes agent entries (identity is a substring
match; `--all` calls `agent.RemoveAll()`), and `step ssh list`/`fingerprint`/
`inspect` operate on the same agent/CA-filtered view
(command/ssh/logout.go:89-117).

## Host bootstrap and configuration: `step ssh certificate`, `step ssh config`

- `step ssh certificate --host <hostname> <keyfile>` creates the host keypair
  and signs a host certificate (SSHHostSignType token flow).
- `step ssh config` fetches **server-side templates** over the CA SSH config
  endpoint: it builds a data map (`GOOS`, `StepPath`, `StepBasePath`,
  template version `v2`, current context name, `Console`, user-supplied
  `--set` pairs, and the `User` discovered from an agent certificate) and
  sends `api.SSHConfigRequest` (command/ssh/config.go:201-262). The CA
  returns `api.Template` path+content pairs which the CLI prints with
  `--dry-run` or writes via `t.Write()`, reporting "No configuration changes
  were found." when empty (config.go:262-302). `--roots` instead prints the
  CA's user/host SSH signing keys, erroring if the CA has none configured
  (config.go:180-200).
- `step ssh check-host <hostname>` and `step ssh hosts` query
  `SSHCheckHost`/`SSHGetHosts` — the host registry (command/ssh/hosts.go:67).

## `step ssh proxycommand`

Designed for `ProxyCommand` in `~/.ssh/config`: given `user host port`, it

1. ensures a valid user certificate is in the agent (signing one if missing,
   writing the x509 identity certificate via
   `ca.WriteDefaultIdentity` when the CA requires client auth),
2. asks the CA for a **bastion** configuration (`client.SSHBastion`), then
3. either dials the target TCP address directly — with a bidirectional
   `io.Copy` that returns as soon as one direction finishes, avoiding the
   stdin deadlock from smallstep/cli#1641 — or shells `ssh` to the bastion
   with `-l/-p/<flags>` and a `netcat` (or bastion-provided) command for the
   final hop, launching through **`exec.Exec`** (syscall.Exec on Unix, so step
   replaces itself; `exec.Run` with full signal forwarding on Windows)
   (command/ssh/proxycommand.go:70-216, 218-293, exec/exec.go:39-50,
   exec/exec.go:161-218).

`exec.Run` (used elsewhere, e.g. when `step` must wait for a child) forwards
every OS signal to the child and mirrors its exit status via a
`signalHandler` goroutine that exits only after the process reaps
(exec/exec.go:56-69, 199-218).

## Renewal tooling: `needs-renewal` and the daemon

`step certificate needs-renewal <crt>` (also `step ssh needs-renewal`) is
built for automation: it exits **0 when the certificate needs renewal**
(default: ≥66% of validity consumed, or `--expires-in <duration|%>`
thresholds) and **1 when it doesn't**; bad flag values exit 255
(command/certificate/needsRenewal.go:152-241). `step ca renew --daemon`
internally uses the same threshold logic to schedule renewals and post-renewal
signals (see
[Certificate Issuance and Renewal Workflows](/openwiki/workflows/certificate-lifecycle.md)).

The `systemd/` directory ships renewer units meant to be installed on hosts:

- `cert-renewer@.service` (templated on the relying service name):
  `ExecCondition=/usr/bin/step certificate needs-renewal ${CERT_LOCATION}` —
  systemd skips `ExecStart` unless the exit is 0 — then
  `ExecStart=/usr/bin/step ca renew --force ${CERT_LOCATION}
  ${KEY_LOCATION}` and `ExecStartPost` reloads/restarts `%i.service` if it is
  active. Defaults `STEPPATH=/etc/step-ca` and `/etc/step/certs/%i.{crt,key}`
  paths; `PartOf=cert-renewer.target` (systemd/cert-renewer@.service).
- `cert-renewer@.timer` fires every 15 minutes (`OnCalendar=*:1/15`) with
  `Persistent=true` and `RandomizedDelaySec=5m` jitter to avoid herd renewals.
- `ssh-cert-renewer.service/.timer` are the SSH variant. The README notes
  these files are S3 redirect targets from files.smallstep.com — moving them
  breaks external references (systemd/README.md:1-6).

## Inspection helpers (`internal/sshutil`, `command/crl`)

- `internal/sshutil` converts between `crypto` keys and SSH wire formats
  (`NewCertSigner`, `ParseCertificate`, key-type inference incl. legacy DSA)
  (internal/sshutil/sshutil.go:20-40) and exposes agent shell-environment
  helpers (`shell.go`) for starting under ssh-agent.
- `step crl inspect <file|url>` parses a CRL with `internal/crlutil` into a
  JSON representation (version, issuer, this/next update, revoked serials,
  extensions) and, when `--ca`/`--ca-file` material is supplied, verifies the
  CRL signature against candidate CA certificates matched by
  AuthorityKeyID and `KeyUsageCRLSign`, annotating `signature.valid` —
  requiring `--insecure` to inspect without validation, and supporting
  `--from` file validation paths (command/crl/inspect.go:112-240,
  internal/crlutil/crlutil.go:24-104).

## Gotchas

- `step ssh login` fails fast without an agent: there is no fallback of
  writing key files for use without one.
- ProxyCommand latency: `step ssh login` re-checks the agent for an existing
  CA-signed comment before hitting the CA — the agent comment convention
  (`--comment`, default subject) is what makes this idempotent.
- OIDC/JWK/X5C provisioners (and any provisioner with
  `disableCustomSANs`) ignore `step ssh` `--principal` flags: principals come
  from the token itself (command/ssh/ssh.go:105-113).

## See also

- [CA Integration: Online and Offline Flows](/openwiki/core/ca-integration.md)
- [Build, Packaging, and Release Operations](/openwiki/operations/build-and-release.md)
