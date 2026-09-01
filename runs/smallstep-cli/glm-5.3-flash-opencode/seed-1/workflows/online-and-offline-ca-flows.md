---
type: online-offline-ca-flows
title: Online and Offline CA Flows
description: The CaClient abstraction that lets certificate commands target a live step-ca server or an embedded offline authority, plus bootstrap trust establishment.
tags: [ca-client, offline, bootstrap, trust, admin-api, architecture]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-266af16dcb701727c28b19d5
    resource: repo://command/ca/bootstrap.go
  - id: openwiki-source-976947cfd6258da1cc5693a8
    resource: repo://utils/cautils/acme_flow.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# Online and Offline CA Flows

## The CaClient abstraction

`cautils.CaClient` is the interface every certificate command programs against:
sign, renew, renew-with-token, revoke, rekey, SSH sign/renew/rekey/revoke, SSH
roots/federation/config/check-host/hosts/bastion, version, root pool, and CA
URL (repo://utils/cautils/client.go#L29-L48). Two implementations exist:

- **Online**: `ca.NewClient(caURL, opts...)` from `smallstep/certificates`
  speaks HTTPS to a running step-ca, pinned to the root file via
  `ca.WithRootFile` (repo://utils/cautils/client.go#L52-L74).
- **Offline**: `OfflineCA` embeds a full `authority.Authority` constructed from
  a local `ca.json` and answers the same interface in-process
  (repo://utils/cautils/offline.go#L28-L81).

`NewClient(ctx)` selects between them: `--offline` requires `--ca-config` and
returns the offline instance; otherwise it parses `--ca-url` (defaulting the
root to `pki.GetRootCAPath()`, erroring when that file is absent) and builds
the online client (repo://utils/cautils/client.go#L52-L74).

## The offline singleton

`NewOfflineCA` keeps a package-level `offlineInstance`; when one already
exists it is returned instead of re-initializing. The in-source reason:
double-initialization of the embedded authority is sometimes impossible due to
locks (badgerDB). The config must contain at least one provisioner, and
`--password-file` seeds the config password for decrypting the intermediate key
(repo://utils/cautils/offline.go#L36-L81).

Offline details:

- The CA URL is `https://<first DNS name from ca.json>` (IPv6 addresses get
  bracketed) (repo://utils/cautils/offline.go#L83-L86, repo://utils/cautils/offline.go#L601-L607).
- `Sign` runs the same authorize/sign pipeline as the server
  (`authority.Authorize` → `SignWithContext`) (repo://utils/cautils/offline.go#L196-L222).
- Renew/Rekey/Revoke pull the peer certificate out of the injected TLS
  transport (`rt.(*http.Transport).TLSClientConfig.Certificates[0]`) to identify
  the certificate being renewed (repo://utils/cautils/offline.go#L226-L250, repo://utils/cautils/offline.go#L316-L341).
- Audiences are derived locally from `ca.json` DNS names per token type
  (repo://utils/cautils/offline.go#L141-L158).

## Trust establishment: bootstrap

`step ca bootstrap --ca-url --fingerprint [--install] [--team ...]`
(repo://command/ca/bootstrap.go#L85-L111):

1. With `--team`, the CLI queries `api.smallstep.com/v1/teams/<team>/authorities/<authority>`
   (overridable via `--team-url`, `<>` substituted with the team name) to
   discover ca-url and fingerprint; `--team` without `--authority` bootstraps
   the "ssh" authority (repo://command/ca/bootstrap.go#L95-L103, repo://utils/cautils/bootstrap.go#L226-L294).
2. `bootstrap()` creates an insecure client on purpose — the fingerprinted root
   validates the `Root(fingerprint)` response (repo://utils/cautils/bootstrap.go#L104-L114).
3. The root is persisted (0600) and `defaults.json` written with ca-url,
   fingerprint, and root path; with contexts, the context is registered and
   selected (covered in [STEPPATH State and Contexts](/openwiki/concepts/steppath-and-contexts.md))
   (repo://utils/cautils/bootstrap.go#L145-L219).
4. `--install` additionally installs the root into the OS trust store via
   `smallstep/truststore` (repo://utils/cautils/bootstrap.go#L212-L219).

## How online clients resolve trust mid-flow

`CertificateFlow.GetClient` supports a second trust mode: if the provided
token carries a `sha` claim (root fingerprint) and an http audience, the client
is built with `ca.WithRootSHA256(sha)` and the audience as CA URL — the
bootstrap-token pattern for unconfigured hosts; otherwise `--ca-url`/`--root`
are required (repo://utils/cautils/certificate_flow.go#L134-L173).

## Admin API client

`step ca admin` operations use the step-ca management API via
`ca.NewAdminClient`. `NewAdminClient(ctx)` requires admin credentials: either
`--admin-cert`/`--admin-key` files, or it **bootstraps an admin identity
in-memory** — generating a key and CSR, minting a sign token via
`NewTokenFlow`, signing it against the CA, and using the resulting chain as
the X5C admin credential (`ca.WithAdminX5C`) (repo://utils/cautils/client.go#L99-L204).
`NewUnauthenticatedAdminClient` is used by flows that must not require admin
credentials (repo://utils/cautils/client.go#L77-L96).

## ACME as a third path

ACME issuance bypasses the CaClient token model entirely: `ACMECreateCertFlow`
and `ACMESignCSRFlow` drive an RFC8555 transaction (`newACMEFlow` handles
challenges; standalone HTTP server or webroot), and with attestation-based
certificates there is no private key file — the attestation URI is printed as
the "private key" location (repo://utils/cautils/acme_flow.go#L15-L44).

## Failure behavior

- Missing `--ca-config` in offline mode or unresolvable `--ca-url`/`--root`
  online produce typed `errs` required-flag/invalid-value errors
  (repo://utils/cautils/client.go#L52-L74).
- A non-2xx response from the team API is decoded into an `apiError`; 404
  yields "authority not found" (repo://utils/cautils/bootstrap.go#L266-L271, repo://utils/cautils/bootstrap.go#L333-L355).
- The offline CA cannot verify client certificates against a missing root or
  intermediate pool — `VerifyClientCert` reads both pools from the config paths
  and fails fast (repo://utils/cautils/offline.go#L94-L138).
