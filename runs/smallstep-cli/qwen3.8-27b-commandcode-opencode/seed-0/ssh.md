---
type: commands
title: "SSH Certificates and Single Sign-On"
description: "The step ssh command group: certificate signing (user/host, identity/mTLS, add-user), login/logout via ssh-agent, step ssh config (SSO team bootstrap, roots/federation, templates), hosts and check-host, list, and proxycommand (host-registry bastion lookup and exec of ssh), plus the internal/sshutil helpers."
tags: [ssh, ssh-agent, sso, bastion, proxycommand, templates, check-host, identity]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-73f7b910a9f89c04fc8a55ce
    resource: repo://command/ssh/certificate.go
  - id: openwiki-source-bfc6a972cd10bc5b5ab89a7d
    resource: repo://command/ssh/checkHost.go
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
  - id: openwiki-source-0b43673e7972a33b56f2860f
    resource: repo://command/ssh/hosts.go
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
  - id: openwiki-source-269a7da24e16c0f32a1452e1
    resource: repo://internal/sshutil/agent.go
  - id: openwiki-source-876dd76a7d08abaa279d8607
    resource: repo://internal/sshutil/sshutil.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

The `step ssh` group (subcommands registered in `command/ssh/ssh.go:84-100`: `certificate`, `check-host`, `config`, `fingerprint`, `hosts`, `inspect`, `list`, `login`, `logout`, `needs-renewal`, `proxycommand`, `rekey`, `renew`, `revoke`) is the client half of step's SSH CA: it obtains short-lived SSH certificates from step CA and wires them into the local ssh-agent and ssh client configuration.

## `step ssh certificate <key-id> <key-file>`

Signs an SSH certificate for a key pair (or an existing public key with `--sign`). Output files use SSH's fixed suffixes: private key `<key-file>` (0600, OpenSSH format), public key `<key-file>.pub` (0644, with the subject as comment), certificate `<key-file>-cert.pub` (0644) (`command/ssh/certificate.go:221-232,551-557`).

- `--host` switches between host and user certificates (`SSHHostCert`/`SSHHostSignType` vs `SSHUserCert`/`SSHUserSignType`); without `--principal`, user defaults come from `createPrincipalsFromSubject` (sanitized subject, plus the email local-part and the original subject when they differ) and host defaults to the subject itself (`command/ssh/certificate.go:295-310`; `createPrincipalsFromSubject` in `command/ssh/ssh.go:294-311`).
- Flag gates: `--no-password` requires `--insecure` and is incompatible with `--min-password-length`/`--password-file`; `--token` is incompatible with `--provisioner-password-file`; `--host` is incompatible with `--add-user`; `--host-id` requires `--host`; `--add-user` allows at most one principal (`command/ssh/certificate.go:266-282`).
- **mTLS identity**: when `client.Version().RequireClientAuthentication` is true, a smallstep x509 identity CSR is created (`ca.CreateIdentityRequest(subject)`) and sent with the sign request; the resulting identity certificate is stored via `ca.WriteDefaultIdentity`. For **host** certificates the identity CSR gets a **host-id UUID as its first URI SAN** (code expects it first): reusing the UUID of an existing identity certificate by default, deriving a stable v4 UUID from `/etc/machine-id` when `--host-id machine` (BLAKE2b-128 with a fixed, non-secret key), or parsing an explicit UUID (`command/ssh/certificate.go:368-432,559-607`).
- **`--add-user`** generates an additional provisioner key pair, sends its public key as `AddUserPublicKey`, and writes the returned user-provisioner certificate as `<base>-provisioner{,.pub,-cert.pub}` (0600/0644, id `<sanitized-subject>-provisioner`) (`command/ssh/certificate.go:437-447,502-513`).
- The certificate is signed through the shared flow: `flow.GenerateSSHToken` (or `--token`), then `caClient.SSHSign` with principals, cert type, key ID, validity, template data, and the identity CSR (`command/ssh/certificate.go:352-463`).
- Finally, for user certificates (unless `--no-agent`) the private key + certificate are **added to the ssh-agent**; an agent failure is printed in red but does not fail the command (`command/ssh/certificate.go:528-540`).

## `step ssh login` / `logout` / `list`

- **`login <identity>`** (`command/ssh/login.go:114-302`): requires a running agent (`sshutil.DialAgent` fails without `SSH_AUTH_SOCK`/Windows pipe). Without `--force`, it first looks for an existing agent key with the same comment **signed by one of the CA's user roots** (`WithSignatureKey` + `WithRemoveExpiredCerts`); if found it reports the key already present and stops. Otherwise it runs the sign flow — with `validAfter` backdated one minute by default to avoid `not yet valid` clock-skew errors — and, for OIDC tokens, uses the token's email as the subject. The certificate is written to the agent (plus the add-user provisioner certificate when requested); agent errors are non-fatal.
- **`logout [identity] [--all]`** (`command/ssh/logout.go:78-151`): `--all` with no argument removes everything from the agent; otherwise it removes only keys matching the identity (comment) — or all certificates when no identity is given — that are signed by the CA's user roots (falling back to "certificates only" if the roots can't be fetched).
- **`list [identity]`** (`command/ssh/list.go:62-106`): lists agent identities by fingerprint, or raw public keys with `--raw` (pipeable into `step ssh inspect`).

## 401 re-login: `loginOnUnauthorized`

`loginOnUnauthorized` (`command/ssh/ssh.go:164-252`) builds a `ca.RetryFunc` used by `hosts`, `config`, `check-host`, and `revoke`: on HTTP 401, it checks `RequireClientAuthentication`, generates an OIDC identity token (via the certificate flow's `GenerateIdentityToken`), requires an email, generates a fresh default key pair, signs a user certificate with the email as key ID plus an identity CSR, stores the identity, and adds the certificate to the agent (errors ignored). This is what makes a lapsed SSO session transparently re-authenticate.

## `step ssh config` — SSO entry point

`config` (`command/ssh/config.go:112-304`) has four modes, mutually exclusive by flag validation:

- **`--team <team> [--team-authority <sub>]`** (default authority `ssh`): runs `cautils.BootstrapTeamAuthority` — the SSO bootstrap against `api.smallstep.com` (see the bootstrap page) — then falls through to the template flow.
- **`--roots` / `--federation`**: prints the CA's user or host public keys as `<TYPE> <BASE64>` lines (the values for `TrustedUserCAKeys` in sshd_config or `@cert-authority` in known_hosts); a 404 from the API is reported as *step certificates is not configured with SSH support*, and an empty key list as *not configured with an ssh.hostKey/userKey*.
- **Template flow (default)**: builds a template data map (`GOOS`, `StepPath`, `StepBasePath`, template version `v2`, current `Context`, `Console`, `--set` pairs), infers `User` from the first principal of the first agent certificate signed by the CA (erroring with *please run `step ssh login <identity>`* when missing), fetches `client.SSHConfig` (user or host templates), and either prints them (`--dry-run`) or writes each template file in place, printing each absolute path.
- **Host mode** (`--host`): requests host templates instead (used to generate sshd_config host-key settings).

## `hosts`, `check-host`, `inspect`

- **`hosts`** (`command/ssh/hosts.go:50-89`): `client.SSHGetHosts` (with the 401 retry func) rendered as a `HOSTNAME / ID / TAGS` table from the host registry.
- **`check-host <hostname>`** (`command/ssh/checkHost.go:61-115`): asks the CA whether the host is eligible for a certificate; when mTLS is required it builds an x5c token from the stored identity (issuer `x5c-identity`, audience `/ssh/check-host`, `WithX5CInsecureFile`). Exits **1** when the host doesn't exist (verbose prints the boolean) — designed for ssh config conditionals.
- **`inspect`** / **`fingerprint`**: parse a certificate file or STDIN and show key type/size, serial, validity, principals, critical options and extensions via `sshutil.InspectCertificate` (`internal/sshutil/inspect.go:42-111`).

## `step ssh proxycommand <user> <host> <port>`

Used as `ProxyCommand` in the ssh client config to route connections through the host registry (`command/ssh/proxycommand.go:70-96`):

1. **`doLoginIfNeeded`** (L100-216): dials the agent; if a certificate signed by a CA user root is already present (expired ones skipped), it returns immediately; otherwise it performs the full user-certificate login (backdated `validAfter`, OIDC email subject, identity CSR when required) and adds the result to the agent.
2. **`getBastion`** (L218-227): `client.SSHBastion(user, host)` — the registry lookup.
3. **Bastion path** (`proxyBastion`, L266-295): locates `ssh` via `exec.LookPath` (fallback `/usr/bin/ssh`), builds `-l <user> -p <port> <bastion flags> <hostname>` — bastion flags are split with `strings.Fields` (a comment flags this as naive) — and appends either the rendered bastion `Command` (`sshutil.ProxyCommand` substitutes `%%`, `%h`, `%p`, `%r`; `internal/sshutil/shell.go:25-30`) or `nc <host> <port>` for plain port forwarding. It then calls **`exec.Exec(sshPath, args...)`**: on Unix this is `sysutils.Exec` → `syscall.Exec` (execve), which **replaces the step process with the ssh client** so the kernel sees ssh as the ProxyCommand process (signal delivery, TTY, and exit status all belong to ssh); on Windows `Exec` falls back to `exec.Run`, which inherits stdio, forwards all signals to the child in a `signalHandler` goroutine, and exits with the child's exit status (`exec/exec.go:39-69,190-217`).
4. **Direct path** (`proxyDirect`, L229-264): TCP-dials `host:port` and copies both directions with half-closes, returning as soon as **either** direction finishes — the comment notes waiting for both can deadlock when the server closes while stdin stays open (smallstep/cli#1641).

## ssh-agent integration (internal/sshutil)

- **Dialing** (`agent_unix.go`, `agent_windows.go`): Unix-family platforms connect to the Unix socket in `$SSH_AUTH_SOCK`; Windows tries a Unix socket (cygwin), then a `winio` named pipe at `SSH_AUTH_SOCK`, then the default OpenSSH ssh-agent pipe name resolved from its config (`internal/sshutil/pipe.go`).
- **`Agent`** (`internal/sshutil/agent.go:84-242`) wraps `agent.ExtendedAgent` with variadic options: `WithSignatureKey` (keep only certificates whose `SignatureKey` matches the given roots), `WithCertsOnly`, and `WithRemoveExpiredCerts` (removes expired certificates from the agent on the fly; `CertTimeInfinity` certs are kept). Helpers: `HasKeys`, `ListKeys`, `ListCertificates`, `GetKey` (by comment), `GetSigner` (matches the marshaled key against `Signers()`), `RemoveKeys`, `RemoveAllKeys`, and `AuthMethod` (`ssh.PublicKeysCallback(a.Signers)`).
- **`AddCertificate`** (L244-271): computes the agent lifetime from `ValidBefore - now` (0 for `CertTimeInfinity`, error if already expired, and always 0 on Windows because the Windows agent fails with lifetimes), and adds the key with the subject as comment.
- **Other helpers** (`internal/sshutil/sshutil.go:22-68`): `ParseCertificate`, `NewCertSigner` (certificate + private key as an `ssh.Signer`), and `PublicKey` (converts marshaled SSH DSA/RSA/ECDSA/ED25519 public keys to `crypto.PublicKey`); `shell.go` additionally provides a `Shell` for remote command execution over ssh using the agent as an auth method.
