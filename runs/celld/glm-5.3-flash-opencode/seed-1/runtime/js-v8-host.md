---
type: runtime
title: JS/V8 host surfaces
description: What the V8 embedding exposes to Worker code — isolate bootstrap and bytecode caching, storage/SQLite ops, WebSocket hibernation and the output-gate frame hold, crypto and zlib bridges, and the Cloudflare compat boundary.
tags: [v8, workers-api, websockets, crypto, compat]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-55ec5a6f535496955b66f4ff
    resource: repo://crates/celld/host_services.rs
  - id: openwiki-source-1c500760315c5c5d7423c257
    resource: repo://crates/celld/js/bootstrap.rs
  - id: openwiki-source-523ed570426ab2f0808c1530
    resource: repo://crates/celld/js/crypto.rs
  - id: openwiki-source-71a9e960c45e5efe230ee7b5
    resource: repo://crates/celld/js/storage_ops.rs
  - id: openwiki-source-f9c6a0351651688a4250c0d4
    resource: repo://crates/celld/js/websocket.rs
  - id: openwiki-source-7c8cfe78d4b8ae5d78ad0b6f
    resource: repo://crates/celld/js/zlib.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# JS/V8 host surfaces

## Where the engine lives

`crates/celld/js.rs` (~9 000 lines) implements the V8 embedding plus the
op surface, with per-area files under `crates/celld/js/`
([bootstrap.rs](repo://crates/celld/js/bootstrap.rs),
[crypto.rs](repo://crates/celld/js/crypto.rs),
[storage_ops.rs](repo://crates/celld/js/storage_ops.rs),
[websocket.rs](repo://crates/celld/js/websocket.rs),
[zlib.rs](repo://crates/celld/js/zlib.rs),
[r2_ops.rs](repo://crates/celld/js/r2_ops.rs),
[v8_strings.rs](repo://crates/celld/js/v8_strings.rs),
[modules.rs](repo://crates/celld/js/modules.rs)). The process services a
live engine observes (CPU/RSS sample, wake entries, WebSocket registry)
are injected through `host_services.rs::HostServices` — production
installs one service set while a deterministic domain installs one
**per simulated node**, so co-hosted incarnations do not share counters
[crates/celld/host_services.rs](repo://crates/celld/host_services.rs#L3-L31).

## Isolate bootstrap: compile once, run many

`crates/celld/js/bootstrap.rs`: the prelude and the harness are compiled
**once per process** and cached as bytecode, "so a new isolate pays for
execution but not for compilation". On top of those go the per-worker
bindings — `env`, the routing table, the compatibility flags — "which
differ per worker and are therefore built every time"
[crates/celld/js/bootstrap.rs](repo://crates/celld/js/bootstrap.rs#L3-L13).
This relates directly to the capacity/knob story —
`CELLD_MAX_LOADED_WORKERS` (default 256) limits concurrent loaded
workers and `CELLD_WORKER_LOADER` enables Worker Loader (Code Mode)
[docs/README.md](repo://docs/README.md#L684-L685).

## Storage ops: the JS↔SQLite boundary

`crates/celld/js/storage_ops.rs` is the V8 surface over
`crate::storage` (key-value, SQL, and the shared value encoding). Its
rule: "Nothing here decides anything. Each op converts V8 values to
Rust, calls into `storage`, and converts the answer back — so the
storage semantics live in that module and the serialization format
lives here, because it is what JS can see"
[crates/celld/js/storage_ops.rs](repo://crates/celld/js/storage_ops.rs#L3-L8).

A documented data-fidelity rule: "celld refuses invalid UTF-8 from a
SQLite `TEXT` value. Store arbitrary [bytes under BLOB]"
[docs/cloudflare-compat.md](repo://docs/cloudflare-compat.md#L53-L53).

## WebSockets: registry and output-gate hold

`crates/celld/js/websocket.rs` handles the isolate-side sockets: "A
socket outlives the event that created it, so the registry is what
connects the two — JS holds an id, and this module knows what that id is
attached to. **Frames emitted inside an output-gate region are held
until the gate opens**, which is why emitting is not simply a send"
[crates/celld/js/websocket.rs](repo://crates/celld/js/websocket.rs#L3-L11).

The readiness and body limits around this surface (V8 heap 128 MB
default and its 90%-refusal threshold for new hibernatable clients) are
covered on [Resident capacity and pressure](/openwiki/runtime/admission-pressure.md).

## The compat surface

`docs/cloudflare-compat.md` gives the boundary table — each row either
**Yes** (fully implemented), **Partial** (a listed gap), or **No**, with
the rule that "celld must reject an unsupported configuration or API at
deployment or first use. An unsupported feature that does not cause an
error is a defect"
[docs/cloudflare-compat.md](repo://docs/cloudflare-compat.md#L1-L17). Highlighted rows:

- **Yes**: Workers static assets, WebAssembly.
- **Partial**: Workers, Durable Objects, Cron Triggers, Worker Loader,
  KV, Queues, D1, Workflows, R2, SQLite, and others.
- **No**: Workers AI, Vectorize, Hyperdrive, Browser Rendering, Email
  Workers, Python Workers.
- Node module support is a subset: `node:assert`, `node:async_hooks`,
  `node:buffer`, `node:events`, `node:path`, `node:stream`,
  `node:timers/promises`, `node:util`; `node:crypto` lacks
  Diffie-Hellman, streaming signatures; `node:zlib` only implements the
  synchronous gzip/deflate functions; `node:fs` returns `ENOENT` from
  every read [docs/cloudflare-compat.md](repo://docs/cloudflare-compat.md#L283-L289).

## Crypto: node:crypto and WebCrypto key handling

`crates/celld/js/crypto.rs` implements Web Crypto and `node:crypto`
"key formats" and the primitives that use them (SPKI, PKCS#8, JWK,
raw), with argument validation left to the JS layer so "what arrives
here is already well formed" — it touches V8 only in its ops
[crates/celld/js/crypto.rs](repo://crates/celld/js/crypto.rs#L3-L13). The
crates supplying the supported key algorithms are pinned and reviewed
under [Workspace layout](/openwiki/architecture/workspace-layout.md)
(aes-gcm, ed25519-dalek, p256/p384/p521, rsa, dsa, x25519-dalek, hkdf,
pbkdf2, pkcs8).

## zlib: one-shot op plus streaming bridge

`crates/celld/js/zlib.rs` implements a one-shot `__zlib` op and the
streaming `CompressionStream` / `DecompressionStream` backend. The
shared pattern: a streaming pipe **holds** a live flate2 writer between
its chunks and the host drains it after each push, so the streaming
semantics (chunk-size invariance) do not depend on buffering
[crates/celld/js/zlib.rs](repo://crates/celld/js/zlib.rs#L3-L22).

## How compat is verified

Conformance runs a program **twice**: once on **workerd** (Cloudflare's
own runtime) and once on celld, and requires **equal output**. The
corpus grows whenever a new API surface lands, and upstream workerd /
WPT suites feed it. See
[Testing and conformance](/openwiki/testing/conformance.md).

## Related pages

- [Cell lifecycle](/openwiki/runtime/cell-lifecycle.md) — the actor and
  isolate model that runs code.
- [Configuration](/openwiki/operations/configuration.md) — Worker Loader
  and binding knobs.
- [Testing and conformance](/openwiki/testing/conformance.md) — the
  differential engine that verifies this surface.
