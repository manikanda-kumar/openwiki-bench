---
type: runtime
title: Control Plane and Peer Protocol
description: The two HTTP listeners — the public Worker ingress and the internal peer and operator listener — the operator API routes, the HMAC-authenticated peer tunnel, peer-control routes, and the request limits.
tags: [control-plane, http, listeners, operator-api, peer-protocol, tunnel]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-202feef6a807aadb656fd2df
    resource: repo://crates/celld/main/peer_tunnel.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Control Plane and Peer Protocol

celld opens two HTTP listeners. The **public listener** serves the
deployed Worker, and the **internal listener** serves the peer protocol
and the operator API. Both are reserved before storage or V8 work starts,
by shared startup primitives (crates/celld/startup.rs#L3-L9).

## The public listener

The public listener reserves only `/.well-known/celld/health`: a healthy
node returns `200 {"ok":true}`, an unhealthy node returns 503, and the
deployed Worker owns `/health` and every other public path
(docs/security.md#L40-L42). While a node is draining, new public requests
receive a `503` with `Retry-After: 1` and `Connection: close`, so the
client can retry on a healthy node (crates/celld/main.rs#L2579-L2598).
WebSocket upgrade requests on the public listener are handed to the
WebSocket handler before Worker dispatch (crates/celld/main.rs#L2599-L2604).

## The internal listener

The internal listener does not pass an unknown path to the Worker; it
returns a 404, so an operator request can never become an application
request (docs/security.md#L44-L45). Its routes (crates/celld/main.rs#L2631-L2835):

- `/state` — reports the node state (snapshot, deployment, generation
  census, handoff and restore counters).
- `POST /reload` — adopts the deployment pointer now, forcing a rebuild.
- `POST /shutdown` — starts the graceful handoff; `?handoff=preserve`
  prepares a clean same-node reload that keeps ownership records.
- `/cell/<SCOPE>` — resolves or activates a cell, reporting a local or a
  remote (owner) route.
- `/evict/<SCOPE>` — evicts a resident cell.
- `/do/<ID>` — sends a direct request to an ordinary Durable Object.
- `/runtime/<SCOPE>` — the authenticated route to a reserved runtime class
  (D1, Workflows, KV, Queues); the operator CLIs' way in.
- `/peer/probe`, `/peer/handoff`, `/peer/log/*`, `/peer/abort/*` —
  peer-control routes.
- `/peer/tunnel` — the tunnel establishment endpoint.

The `/do/` route has no authentication, so it refuses every reserved
runtime class: a reserved cell's whole fetch surface is an operator
protocol (arbitrary SQL for D1, create/terminate/events for a workflow),
and its scope is an HMAC over config names rather than a secret. The
mirror holds for `/runtime/`: it serves reserved classes and nothing else,
and a signed request cannot drive a user's Durable Object through a route
whose only contract is an operator protocol
(crates/celld/main.rs#L2758-L2778, crates/celld/main.rs#L2692-L2702).

The operator API is an alpha interface: a release can change its paths or
response formats, so keep the operator tooling and the celld release
together (docs/README.md#L546-L551).

## Routing a cell call

Every cell call begins with an ownership resolution in the decision core.
A request to a resident cell completes with a **local** route; a request
to a cell owned by another node completes with a **remote** route naming
the owner's node, address, epoch, and protocol version
(crates/logic/lib.rs#L2878-L2912). A remote call then crosses to the
owner over the peer protocol, and a top-level Worker fetch whose target
isolate is busy is rescheduled to the stateless Worker pool rather than
run nested (crates/logic/schedule.rs#L3-L10).

## The peer tunnel

The peer protocol carries cell fetch, RPC, and WebSocket calls over one
**tunneled connection per peer**. Establishment is an h1 upgrade on
`/peer/tunnel` — CONNECT semantics with Upgrade mechanics — and after the
101 the connection is an opaque duplex stream carrying plain HTTP driven
by hyper on both ends: the hop never interprets the inner bytes, so the
headers a cell must receive byte-faithful (`Host`, `Content-Length`,
`Upgrade`) are data, not metadata. Per-call control (scope, cell name,
request id, capacity handoff) rides `x-cells-*` headers on the inner
request; node A overwrites them and node B strips them, so the reserved
names cannot be smuggled by an application in either direction
(crates/celld/main/peer_tunnel.rs#L3-L14).

Idle tunnels are pooled per peer and reused for sequential calls (plain h1
keep-alive inside the tunnel, never multiplexing). Without reuse every
call would be a fresh TCP connection, saturating the ephemeral-port range
into TIME_WAIT within seconds at loopback speed
(crates/celld/main/peer_tunnel.rs#L16-L21).

The tunnel protocol carries an explicit version
(`x-cells-tunnel-version`, currently `5`), and establishment is the point
where a mixed-version fleet is refused — which is why the v0.3.0 → v0.4.0
upgrade cannot be a rolling update (docs/README.md#L535-L544,
crates/celld/main/peer_tunnel.rs#L26-L39).

## Request and body limits

- The public Worker listener and `/do/<ID>` have a 1 GiB request body
  limit by default (`CELLD_MAX_REQUEST_BODY_BYTES`); celld returns 413 for
  a declared oversized body and when a Worker reads past the limit
  (docs/security.md#L126-L132).
- For a method other than `GET` or `HEAD`, `/do/<ID>` streams a body when
  its declared length is at least 1 MiB or its length is unknown, and
  collects each smaller body before dispatch (docs/security.md#L133-L135).
- The peer protocol bounds separate surfaces: forwarded bodies up to
  `DEFAULT_MAX_REQUEST_BODY_BYTES + 1 MiB`, operator-cell bodies up to
  64 MiB, and peer-control bodies up to 64 KiB
  (crates/celld/main.rs#L1359-L1365).
- A cell admits at most 64 concurrent fetch events
  (`CELLD_MAX_CELL_REQUESTS`) and refuses excess work with a 503 carrying
  `Retry-After: 1` and `X-Celld-Overload: cell`
  (docs/README.md#L638-L651).

## Managed control plane

With `--control-plane` (`CELLD_CLOUD`), a node enrolls with a managed
installation at `https://celld.dev` (the default control URL) and runs a
presence agent that reports the node's cell presence; a managed
installation issues and validates S3-compatible storage only, because
celld's GCS and Azure clients authenticate through mechanisms a
control-plane-issued credential does not provide
(crates/celld/control_plane.rs#L18-L22,
crates/celld/main.rs#L3227-L3231).
