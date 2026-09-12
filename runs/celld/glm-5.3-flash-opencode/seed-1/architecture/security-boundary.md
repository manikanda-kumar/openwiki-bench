---
type: concept
title: Security boundary and peer authentication
description: celld's trust model — who is trusted, the two external boundaries, the three internal-listener request groups, and how the fleet HMAC signs and authenticates peer traffic.
tags: [security, peer-auth, hmac, listeners, boundary]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Security boundary and peer authentication

## Who is trusted

celld is an alpha and "is not safe for hostile multi-tenant use". It trusts
the application code, the fleet nodes, and the operators; mutually
distrusting tenants must not share one fleet
[docs/security.md](repo://docs/security.md#L1-L11).

Two external boundaries protect the system:

- A trusted private network protects the internal listener (an encrypted
  overlay serves when the private network does not).
- Object-storage credentials control the fleet; a credential should access
  one fleet bucket only
  [docs/security.md](repo://docs/security.md#L13-L18).

## Listener separation

The public listener (`--listen`) serves the deployed Worker; the internal
listener (`--internal-listen`) serves the peer protocol and the operator
API, defaulting to `127.0.0.1:0` (an available loopback port chosen at each
start) [docs/security.md](repo://docs/security.md#L22-L34). The listener
guardrails (public-IP advertise rejection, obsolete one-listener shape
rejection) live in `startup::bind_internal_listener` and are covered in
[Fleet model](/openwiki/architecture/fleet-model.md).

Listener surface ownership is explicit:

- The public listener reserves only `/.well-known/celld/health` — 200 with
  `{"ok":true}` when healthy, 503 when not; the Worker owns `/health` and
  every other public path
  [docs/security.md](repo://docs/security.md#L40-L42).
- The internal listener never passes an unknown path to the Worker; it
  returns 404, "so an operator request cannot become an application request"
  [docs/security.md](repo://docs/security.md#L44-L45).

## The three internal request groups

The internal listener has three request groups
[docs/security.md](repo://docs/security.md#L55-L68):

1. Most operator routes — inspect or control a node, **no request
   authentication** (`/state`, `/cell/<SCOPE>`, `/evict/<SCOPE>`,
   `/do/<ID>`, `POST /shutdown`)
   [docs/security.md](repo://docs/security.md#L87-L99).
2. `/peer/tunnel` — tunnel establishment carries the fleet HMAC with a clock
   limit and replay protection; only a fleet-secret holder can open a
   tunnel. Calls cross the tunnel as plain HTTP with the cell scope in a
   reserved header and are **not signed individually**
   [docs/security.md](repo://docs/security.md#L59-L63).
3. Peer-control routes and reserved-cell routes — fleet HMAC, clock limit,
   replay protection.

The tunnel streams bodies, so the HMAC cannot sign each call; the
establishment signature decides who may open a tunnel and does not
authenticate the bytes after it or encrypt anything. The private network
stays the boundary and the HMAC does not replace it
[docs/security.md](repo://docs/security.md#L70-L76). Neither listener
terminates TLS [docs/security.md](repo://docs/security.md#L78-L80).

## The fleet HMAC protocol

`crates/celld/peer_auth.rs` implements the scheme:

- A 32-byte secret shared fleet-wide, stored at `fleet/peer-auth.json` in
  the bucket (`SECRET_KEY`), with a `StoredSecret` version envelope
  (`SECRET_VERSION = 1`); unsupported versions are refused
  [crates/celld/peer_auth.rs](repo://crates/celld/peer_auth.rs#L20-L21)
  [crates/celld/peer_auth.rs](repo://crates/celld/peer_auth.rs#L300-L319).
- Bootstrap: `load_or_create` reads the secret, and if absent generates a
  random 32-byte key, stores it with a conditional create (`put_cas`
  without an etag), so exactly one node creates it; a lost create race is
  resolved by re-reading the stored secret
  [crates/celld/peer_auth.rs](repo://crates/celld/peer_auth.rs#L272-L292).
  Consistent with the README statement that "the first current node creates
  `fleet/peer-auth.json` in the bucket"
  [README.md](repo://README.md#L196-L197).
- Each signed request produces these headers: `x-cells-peer-source`,
  `x-cells-peer-target`, `x-cells-peer-timestamp`,
  `x-cells-peer-nonce` (a random 16-byte hex nonce),
  `x-cells-peer-body-sha256`, and `x-cells-peer-signature`; the protocol
  version rides `x-cells-peer-version`
  [crates/celld/peer_auth.rs](repo://crates/celld/peer_auth.rs#L159-L176).
- The HMAC binds a canonical string of
  `DOMAIN\nPROTOCOL_VERSION\nmethod\npath_and_query\nbody_hash\nsource\ntarget\ntimestamp\nnonce`
  where `DOMAIN` is `cells-peer-request-v1` — so it binds the method, the
  exact path, the body digest, both identities, and the freshness
  [crates/celld/peer_auth.rs](repo://crates/celld/peer_auth.rs#L247-L270).
- Verification: the protocol version must equal `"5"`, identities must be
  valid (ASCII letters, numbers, dot, dash, underscore), the timestamp must
  fall within the clock window (`CLOCK_WINDOW_MS` = 30 000 ms), the body
  hash must match, `target` must equal the expected target, and the
  signature must verify
  [crates/celld/peer_auth.rs](repo://crates/celld/peer_auth.rs#L178-L229).
- Replay protection: a nonce cache retains nonces for
  `REPLAY_RETENTION_MS` (60 s, asserted ≥ the clock window), bounded at
  `MAX_REPLAY_ENTRIES` = 1 000 000 entries; a repeated nonce fails with
  `Replay`, and a full cache fails with `ReplayCapacity`. The cache is
  pruned every 1024 checks or when full
  [crates/celld/peer_auth.rs](repo://crates/celld/peer_auth.rs#L22-L28)
  [crates/celld/peer_auth.rs](repo://crates/celld/peer_auth.rs#L230-L243).

The timestamp/nonce/verify flow is shared: it is used to sign outgoing peer
requests (`sign`), verify incoming peer requests (`verify`), and answer
`/peer/probe` signed diagnostic challenges
[crates/celld/main.rs](repo://crates/celld/main.rs#L2345-L2345).

## Operator API exposure

The unauthenticated operator routes (`/state`, `/cell`, `/evict`, `/do`,
`/shutdown`) do not authenticate the caller — they are explicitly listed as
such in the security page. `/do/<ID>` refuses every reserved runtime class
(D1, Workflows, KV, Queues); those classes' operator protocols can access
application data or change runtime state, so they use the
HMAC-authenticated `/runtime/<SCOPE>` route instead
[docs/security.md](repo://docs/security.md#L96-L99).

## Forwarded-header and body policies

- `X-Forwarded-Host` and `X-Forwarded-Proto` are ignored by default; enable
  `--trust-forwarded-headers` / `CELLD_TRUST_FORWARDED_HEADERS=1` only
  behind a trusted proxy, using the *last* value of each header
  [docs/security.md](repo://docs/security.md#L107-L114). The flag is a
  runtime setting propagated to request URL construction
  [crates/celld/main.rs](repo://crates/celld/main.rs#L1323-L1341).
- Request-target handling: celld always takes path and query from the
  request target and ignores the scheme/authority in an absolute-form
  target, preventing host-policy bypass; without a trusted proxy, `Host`
  controls `request.url`, with malformed/noncanonical values rejected and
  `celld.local` as the fallback
  [docs/security.md](repo://docs/security.md#L112-L119).
- Body limits: public Worker listener and `/do/<ID>` default to 1 GiB
  (`CELLD_MAX_REQUEST_BODY_BYTES`), returning 413 for oversized declared
  bodies; `/do/<ID>` streams bodies ≥ 1 MiB or with unknown length and
  buffers smaller ones
  [docs/security.md](repo://docs/security.md#L128-L135).

## Bucket as the root of authority

The bucket holds deployments, cell state, ownership leases, node leases and
the shared peer secret; a credential holder controls the fleet, so the
bucket credentials must be restricted to the fleet bucket and rotated after
any suspected disclosure
[docs/security.md](repo://docs/security.md#L137-L145). The reserved bucket
prefixes are documented on the
[bucket contract page](/openwiki/data/bucket-contract.md).
