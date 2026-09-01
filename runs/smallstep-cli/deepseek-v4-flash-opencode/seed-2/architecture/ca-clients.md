---
type: architecture
title: CA Client Abstraction
description: How the step CLI talks to a certificate authority, through the CaClient interface backed by either the online HTTP client from smallstep/certificates or the in-process OfflineCA used by --offline.
tags: [architecture, ca, client, offline]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# CA Client Abstraction

Every command that needs to sign, renew, revoke, or rekey a certificate uses a
common client abstraction defined in `utils/cautils/client.go`. The interface
hides the difference between an online `step-ca` server and the fully offline
mode where the CLI itself runs an embedded certificate authority.

## The CaClient interface

`CaClient` is the contract that both implementations satisfy:

```go
type CaClient interface {
    Sign(req *api.SignRequest) (*api.SignResponse, error)
    Renew(tr http.RoundTripper) (*api.SignResponse, error)
    RenewWithToken(ott string) (*api.SignResponse, error)
    Revoke(req *api.RevokeRequest, tr http.RoundTripper) (*api.RevokeResponse, error)
    Rekey(req *api.RekeyRequest, tr http.RoundTripper) (*api.SignResponse, error)
    SSHSign(req *api.SSHSignRequest) (*api.SSHSignResponse, error)
    SSHRenew(req *api.SSHRenewRequest) (*api.SSHRenewResponse, error)
    SSHRekey(req *api.SSHRekeyRequest) (*api.SSHRekeyResponse, error)
    SSHRevoke(req *api.SSHRevokeRequest) (*api.SSHRevokeResponse, error)
    SSHRoots() (*api.SSHRootsResponse, error)
    SSHFederation() (*api.SSHRootsResponse, error)
    SSHConfig(req *api.SSHConfigRequest) (*api.SSHConfigResponse, error)
    SSHCheckHost(principal string, token string) (*api.SSHCheckPrincipalResponse, error)
    SSHGetHosts() (*api.SSHGetHostsResponse, error)
    SSHBastion(req *api.SSHBastionRequest) (*api.SSHBastionResponse, error)
    Version() (*api.VersionResponse, error)
    GetRootCAs() *x509.CertPool
    GetCaURL() string
}
```

The interface spans X.509 and SSH operations, plus version probing and trust
store access. Notably, `Renew`, `Revoke`, and `Rekey` take an `http.RoundTripper`
argument so that callers (like the renewer) can hand over an mTLS transport
carrying the client certificate.

## Online vs. offline selection

`cautils.NewClient(ctx, opts...)` (utils/cautils/client.go:52-74) is the factory
used by commands that accept `--offline`:

- When `--offline` is set, `--ca-config` is mandatory and the function returns
  `NewOfflineCA(ctx, caConfig)`. The in-process authority then serves the request.
- Otherwise it parses `--ca-url`, resolves the root file (`--root`, falling back
  to the default STEPPATH location `pki.GetRootCAPath()`), and builds the online
  client with `ca.NewClient(caURL, ca.WithRootFile(root)...)`.

The `CertificateFlow` used by `step ca certificate` and `step ca sign` carries a
flag `offline` and keeps an `*OfflineCA` reference; its `GetClient` method
(utils/cautils/certificate_flow.go:134-171) implements the same branch.

## Trust resolution from a token

`CertificateFlow.GetClient` has a bootstrap-specific path. If the supplied token
payload contains a `sha` claim (the SHA-256 of the root certificate) and an
audience beginning with `http`, the client is constructed with
`ca.WithRootSHA256(jwt.Payload.SHA)` and, when `--ca-url` is absent, the CA URL
is taken from the token audience. This lets a single token carry enough
information to both locate and trust the CA. Otherwise `--ca-url` and `--root`
(or the default root path) are required, and the client is built with
`ca.WithRootFile(root)`.

## Admin clients

The provisioner, policy, and admin command groups use a separate `ca.AdminClient`
for the step-ca management API:

- `NewUnauthenticatedAdminClient` (utils/cautils/client.go:77-96) creates a
  client with no credentials, used to probe whether the Admin API is enabled.
- `NewAdminClient` (utils/cautils/client.go:99-204) authenticates. If
  `--admin-cert`/`--admin-key` are provided, they are loaded and used as the
  x5c credentials. Otherwise the CLI generates an ephemeral admin identity:
  it prompts for a subject, runs `NewTokenFlow` with `SignType` to mint a
  token, generates a fresh key, builds a CSR, calls `client.Sign`, and uses the
  resulting chain with `ca.WithAdminX5C(adminCert, adminKey, passwordFile)`.

## OfflineCA: an embedded authority

`OfflineCA` (utils/cautils/offline.go) wraps the `authority.Authority` from
`github.com/smallstep/certificates` so that `step ca certificate --offline`,
`step ca renew --offline`, `step ca revoke --offline`, and the SSH equivalents
run entirely without a server.

Key design points:

- It is a **singleton**. `NewOfflineCA` returns the previously constructed
  instance on subsequent calls (`offlineInstance`). The comment explains that
  double initialization must be avoided because some backends (e.g. badgerDB)
  take locks on first open.
- The configuration is read from the JSON `ca.json` file (`--ca-config`). It
  requires `AuthorityConfig.Provisioners` to be non-empty, and honors a
  `--password-file` to set `cfg.Password`.
- `GetCaURL` synthesizes `https://<first-dns-name>` and `GetRootCAs` returns
  nil, because no network trust pool is needed.
- Each method delegates to the corresponding `authority.Authority` method after
  running authorization. For example `Sign` calls `authority.Authorize` then
  `authority.SignWithContext`; `Revoke` builds `authority.RevokeOptions` from
  the request and either a token (`OTT`, `MTLS=false`) or the client
  certificate extracted from the mTLS transport (`MTLS=true`).
- `Renew` and `Rekey` extract the peer certificate from the `*http.Transport`
  passed in (`TLSClientConfig.Certificates[0]`), which is how the renewer's
  transport is reused by the offline path.
- `GenerateToken` provides the offline token flow using the embedded
  provisioners and the synthesized audience (`https://<dns>/sign`, `/renew`,
  `/ssh/sign`, etc.).

## Client construction in the renewer

The `renewer` type in `command/ca/renew.go` builds its own `http.Transport`
with a root pool loaded from the root file and, when the certificate is still
valid, sets `TLSClientConfig.Certificates` for mTLS. It then constructs the
online client with `ca.NewClient(caURL, ca.WithTransport(tr))`, or uses
`cautils.NewOfflineCA` when `--offline` is set. This transport is also where
`RenewWithToken` removes the certificate before issuing an X5C token-based
renewal.

## Tests

The token flow tests (utils/cautils/token_flow_test.go) exercise the provisioner
selection and token generation that the online path relies on, while
`command/ca/sign_test.go` and `command/ca/init_test.go` cover the command-level
validation boundaries. The offline path itself is exercised end-to-end through
the command flow when run with `--offline`.
