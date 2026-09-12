---
type: integration
title: Online and Offline step-ca Client Integration
description: The client used to talk to step-ca and an offline CA, covering the CaClient interface, ca-url/root resolution, mTLS admin client, trust store, and ACME challenge modes.
tags: [integration, step-ca, client, acme, admin, offline]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-aecab703e3710c5764638ff5
    resource: repo://utils/cautils/acmeutils.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---

# Online and Offline step-ca Client Integration

`utils/cautils/client.go` defines the client abstraction used by `step ca`
commands to talk to [`step-ca`](https://github.com/smallstep/certificates),
plus ACME client flows in `acmeutils.go`/`acme_flow.go`. The offline CA is an
alternate implementation that runs the authority in-process (see
[Certificate and Token Flows](../architecture/token-flows.md)).

## CaClient interface

`CaClient` (utils/cautils/client.go:29-48) is the interface every online/offline
request path uses. It exposes:

- Sign / renew / rekey / revoke for X.509 (`Sign`, `Renew`, `RenewWithToken`,
  `Revoke`, `Rekey`).
- SSH operations (`SSHSign`, `SSHRenew`, `SSHRekey`, `SSHRevoke`, `SSHRoots`,
  `SSHFederation`, `SSHConfig`, `SSHCheckHost`, `SSHGetHosts`, `SSHBastion`).
- `Version()`.
- Trust-store accessors `GetRootCAs()` and the configured `GetCaURL()`.

Both `ca.NewClient` (online) and `OfflineCA` implement this interface, so
commands can treat online and offline mode uniformly.

## NewClient: online vs offline

`NewClient` (utils/cautils/client.go:52-74):

- If `--offline` is set, requires `--ca-config` and returns `NewOfflineCA`.
- Otherwise resolves the CA URL via `flags.ParseCaURL`, defaults `--root` to
  `pki.GetRootCAPath()` (falling back to `--root` when the default file is
  missing), and constructs an online client with `ca.WithRootFile(root)`
  appended to the options. `ca.NewClient` attaches the root as TLS trust root.

## mTLS admin client

`NewAdminClient` (client.go:99-204) builds a client for the step-ca management
API:

- Requires `--ca-url` (via `flags.ParseCaURLIfExists`) and `--root`.
- If `--admin-cert`/`--admin-key` are provided, they must both be given and
  are loaded; otherwise the command generates in-memory admin credentials: it
  prompts for an admin subject, runs the token flow, builds a CSR, requests a
  cert via the regular sign endpoint, and uses the resulting chain as the admin
  X.509 identity.
- The final client is built with both `ca.WithRootFile(root)` and
  `ca.WithAdminX5C(adminCert, adminKey, passwordFile)`.

`NewUnauthenticatedAdminClient` (client.go:77-96) returns a client that skips
admin authentication (for endpoints that don't need mTLS).

## ACME client flows

`utils/cautils/acmeutils.go` implements ACME `http-01` and `device-attest-01`
challenge validation:

- `newACMEFlow` (acmeutils.go:625-666) rejects offline mode (ACME and offline
  are mutually exclusive) and enforces `--standalone` vs `--webroot` mutual
  exclusivity, defaulting to standalone.
- Standalone mode (`standaloneMode`) runs a local HTTP server that serves the
  key authorization at `/.well-known/acme-challenge/<token>` (acmeutils.go:47-108).
- Webroot mode (`webrootMode`) writes the key authorization file under a
  user-specified `--webroot` directory (acmeutils.go:110-157).
- `getChallengeStatus` (acmeutils.go:518-549) polls the challenge status up to
  10 times and surfaces server-side `acme.Problem` details from subproblems or
  the top-level error.
- `authorizeOrder`/`finalizeOrder` (acmeutils.go:196-283) walk each
  authorization, validate the matching challenge, then wait for the order to be
  ready, finalize it, and wait for it to be valid.
- `doDeviceAttestation` (acmeutils.go:403-512) handles the `device-attest-01`
  challenge, producing a WebAuthn-style attestation object encoded in CBOR.
- `createNewOrderRequest` (acmeutils.go:299-391) builds the ACME order and
  includes LetsEncrypt-specific handling (subject must be a SAN, no
  NotBefore/NotAfter, comment about the 3-month lifetime).

`getClientTruststoreOption` (acmeutils.go:668-708) selects the TLS trust store
for the ACME client: it can merge a local root (from `--root` or the default
step path) into the system cert pool, use only the local root, or use the
system store only.

`acme_flow.go` exposes `ACMECreateCertFlow` (issuing from subject/SANs) and
`ACMESignCSRFlow` (issuing from an existing CSR), both delegating to
`acmeFlow.GetCertificate` (acmeutils.go:710-865) which creates the order,
authorizes, generates a key+CSR, finalizes, and fetches the full chain.

## Related

- [Certificate and Token Flows](../architecture/token-flows.md) — offline client details.
- [SSH Certificate Integration](ssh-integration.md) — SSH client methods.
- [CLI Runtime and Command Registration](../architecture/command-runtime.md) — flow wiring.
