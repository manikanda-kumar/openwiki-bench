---
type: limitations
title: Limitations and Alpha Boundaries
description: The alpha-era operational limits across fleets, networking and security, object storage credentials, WebSockets, and platforms, with uncertainty stated where the repository does not establish a fact.
tags: [limitations, alpha, boundaries, operations]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-d1f8171ced840731654fd4ea
    resource: repo://docs/limitations.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---

# Limitations and Alpha Boundaries

celld is an alpha. The current release has these operational limits, taken
primarily from `docs/limitations.md` and `docs/cloudflare-compat.md`. This page
records what the repository itself establishes; it does not invent guarantees
or deployment details.

## Fleets

- **A fleet runs one application.** celld has no account service, multi-tenant
  scheduler, or managed ingress (`docs/limitations.md` lines 13-14).
- **A fleet stores durable state in an object-storage bucket** — S3-compatible,
  Google Cloud Storage, or Azure Blob Storage. The `celld dev` command instead
  uses a local SQLite object store, and "a regular node or an operator
  subcommand cannot select this local backend" (`docs/limitations.md` lines
  15-18).
- **A node does not rebalance existing cells when it joins a fleet.** Traffic
  assigns an unowned or released cell to a node with capacity (`docs/
  limitations.md` lines 19-20). There is no fixed membership list and no join
  command; nodes find each other "through the leases in the bucket"
  (`docs/README.md` lines 415-418).

## Networking and security

- **celld does not terminate TLS.** Terminate public TLS at an ingress proxy,
  and put the internal listener on a private network or an encrypted overlay
  (`docs/limitations.md` lines 23-24).
- **Peer traffic crosses the internal network as plaintext HTTP.** The fleet
  HMAC authenticates tunnel establishment and control requests, and it does not
  encrypt application data on the wire; "the network layer must provide the
  confidentiality" (`docs/limitations.md` lines 25-28). This is a hard
  boundary: `docs/security.md` repeats it — "The signature does not authenticate
  the bytes after the establishment, and it does not encrypt any traffic"
  (`docs/security.md` lines 74-77).
- **The fleet bucket controls the fleet.** Give its credentials access to one
  fleet only (`docs/limitations.md` lines 29-30). A holder of the bucket
  credentials controls the fleet (`docs/security.md` line 145).

## Object storage credentials

- celld supports different credential methods per provider, with provider-
  specific precedence documented in the README's "Configure object storage"
  section (`docs/limitations.md` lines 35-36).
- **Azure identity support is limited to the public Azure cloud.** A managed
  identity from Azure App Service or Azure Container Apps does not work; use a
  workload identity or a storage account key there (`docs/limitations.md` lines
  37-39). celld rejects a sovereign or custom Azure authority host
  (`docs/README.md` lines 183-189).

## WebSockets

- **An outbound Durable Object WebSocket keeps its cell resident.** The
  connection closes if the cell moves to another node, so "the application must
  store the connection intent and reconnect" (`docs/limitations.md` lines
  42-44).
- A node limits the cells and outbound WebSockets that can remain resident
  (`docs/limitations.md` lines 45-46).

## Platforms and updates

- The installer supplies binaries for Linux x86-64, Linux ARM64, and Apple
  Silicon. Windows is not supported (`docs/limitations.md` lines 52-53).

## Not-qualified and development-only stores

Two stores pass the storage test but are deliberately not production-qualified:

- **MinIO (community edition)** "passes the storage test, but celld has not
  qualified it for production" (`docs/guarantees.md` lines 36-38); one release
  (RELEASE.2025-09-06T17-38-46Z) is broken for the conditional create.
- **Azurite** is "a development store, so celld does not qualify it for a fleet
  either" (`docs/README.md` lines 197-199).

## API surface that is intentionally not implemented

The compatibility page catalogues the services celld does not implement
(Workers AI, Vectorize, Hyperdrive, Browser Rendering, Email Workers, Python
Workers) and the runtime APIs that are inert stubs. Some stub behavior is a
deliberately-*silent* gap: `node:fs` returns `ENOENT` from each read and each
other Node.js module returns an inert stub; `connect()` on the TCP sockets API
returns an inert stub; `EventSource`, `MessageChannel`, and `BroadcastChannel`
are inert stubs (`docs/cloudflare-compat.md` lines 283-303). "This behavior is a
known silent gap."

## Uncertainty stated where the repository does not establish a fact

The repository establishes the reliability promises through its verification
pages but does not establish operational SLA or capacity figures for arbitrary
deployments. In particular:

- Resident-capacity guidance ("One 8 GB node holds 1,000 resident cells, so one
  resident cell costs approximately $0.05 each month", `docs/README.md` lines
  35-36) is an approximate guidance figure, not a measured guarantee.
- Latency measurements in `docs/testing.md` carry their measurement conditions;
  the same page states "each number includes the condition of its measurement.
  A number without its conditions has no value" (`docs/testing.md` lines
  158-160).

Where this wiki states a fact beyond what the cited source asserts, it is
identified as such.

## Security posture

`docs/security.md` opens with: "celld is an alpha. It is not safe for hostile
multi-tenant use. Security fixes apply to the latest release only."
(`docs/security.md` lines 3-4). The trust model is a single application code,
fleet nodes, and operators; do not run mutually distrusting tenants in one
fleet (lines 7-12).
