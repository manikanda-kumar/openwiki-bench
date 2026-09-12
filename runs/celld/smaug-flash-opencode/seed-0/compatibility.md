---
type: compatibility
title: Cloudflare Compatibility Boundary
description: The Cloudflare Workers and Durable Objects API surface celld implements, the supported Wrangler configuration subset, the deployment feature gates and manifest schema, and known compatibility gaps.
tags: [cloudflare, compatibility, wrangler, workers, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-5a6cbf6f6333a36a693f815b
    resource: repo://crates/logic/cron.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---

# Cloudflare Compatibility Boundary

celld implements a subset of the Cloudflare Workers Durable Objects API. The
full authoritative catalog — every service and every runtime API — lives in
`docs/cloudflare-compat.md`. The binding rule against silent drift is:

> celld must reject an unsupported configuration or API at deployment or first
> use. An unsupported feature that does not cause an error is a defect.
> (`docs/cloudflare-compat.md` lines 11-13)

This page summarizes that boundary and then explains the enforcement
mechanism for it: the deployment feature gates based on the manifest schema in
`crates/celld/protocol.rs`.

## Services

celld implements its own set of the Cloudflare service catalog but not all of it:

- **Implemented fully:** Static assets (`Yes`).
- **Partial:** Workers, Durable Objects, Cron Triggers, Worker Loader, KV,
  Queues, D1, Workflows, R2, WebAssembly, and several runtime APIs.
- **Not implemented:** Workers AI, Vectorize, Hyperdrive, Browser Rendering,
  Email Workers, Python Workers (`docs/cloudflare-compat.md` lines 15-35).

The per-service gap notes are in that page (lines 36-157). Two worth housing
here:

- **KV:** "celld has no edge cache. `cacheTtl` has no effect, and `cacheStatus`
  is `null`" (lines 80-82). A value above 1 MiB requires a fleet bucket, and a
  namespace has one writer — "Use more namespaces to increase write capacity"
  (line 90-91).
- **R2:** "An R2 binding uses the fleet bucket under `r2/<bucket_name>/`"
  (line 149). A conditional write cannot use a streamed body larger than 8 MiB,
  and a multipart upload cannot resume on another node or after a restart
  (lines 151-153).

## Runtime APIs

The runtime API status table (lines 160-184) marks Fetch/Request/Response/
Headers, Bindings, Context, Handlers, RPC, Streams, WebSockets, Web Crypto,
Web standards, Performance/timers, Console, and Node.js compatibility as
`Partial`; Encoding and WebAssembly as `Yes`; and Cache, HTMLRewriter, TCP
sockets, EventSource, MessageChannel, and BroadcastChannel as `No`.

Partial notes to keep in mind when writing application code include:

- **RPC:** "A cross-isolate named service binding supports only a single method
  call" (lines 221-223), and "An RPC stub cannot cross an isolate boundary"
  (line 223).
- **WebSockets:** `getTags()` is not available; the caller must call `accept()`
  on a subrequest-upgrade socket; and the runtime rejects an upgrade when the
  response status is not 101 (lines 236-244).
- **Web Crypto:** `wrapKey()`/`unwrapKey()` and RSA-PSS signing are not
  available, and HKDF or PBKDF2 must be reached via `node:crypto`, not through
  `deriveBits()` (lines 249-254).
- **Node.js compatibility:** only `node:assert`, `node:async_hooks`,
  `node:buffer`, `node:events`, `node:path`, `node:stream`,
  `node:timers/promises`, and `node:util` are implemented; `node:fs` returns
  `ENOENT` from each read; and "each other Node.js module returns an inert
  stub" (lines 283-291). These inert stubs are a *known silent gap* — an
  unsupported call that does not throw.

Unsupported features must not throw errors silently or at unexpected points,
except the silent-stub cases explicitly named in that page (e.g. `connect()`
and the inert `EventSource`/`MessageChannel`/`BroadcastChannel`).

## Compatibility flags

celld honors these compatibility switches:

- `delete_all_deletes_alarm`
- `js_rpc`
- `fetcher_no_get_put_delete`
- `sqlite_vec`
- `websocket_standard_binary_type`
- the static-assets navigation flags

("compatibility flags", `docs/cloudflare-compat.md` lines 307-317). Each other
compatibility flag is accepted without effect. The compatibility logic itself
lives in `worker_compat` in `crates/celld/lib.rs` (lines 483-521), which maps
flags and the `compatibility_date` onto a `js::Compat` struct the JS harness
consumes. `Cloudflare.compatibilityFlags` reports only the flags celld honors.

## Wrangler configuration subset

`celld deploy` accepts `wrangler.jsonc` or `wrangler.json`, never
`wrangler.toml` (`docs/cloudflare-compat.md` line 321). The accepted top-level
keys:

- `$schema`, `name`, `main`, and `no_bundle`
- `compatibility_date` and `compatibility_flags`
- `durable_objects` and `migrations`
- `assets`, `services`, `triggers`, and `vars`
- `d1_databases`, `kv_namespaces`, `queues`, `workflows`, and `r2_buckets`

("Wrangler configuration", lines 319-333). Any other top-level key, including
`routes`, stops the deployment. An asset-only project may omit `main`.

The allowlist lives in `crates/celld/deploy.rs`: `SUPPORTED_KEYS` names what
deploy understands, and the module's contract is "anything we do not model is
refused, never silently dropped" (`crates/celld/deploy.rs` lines 42-44).

## The deployment feature gates and manifest schema

The durable deployment contract is defined by the types in
`crates/celld/protocol.rs` ("Durable types on the bucket contract between
deployment tools and celld. These objects are the interface; nothing else is
exchanged"). The key types:

- **`Manifest`** (`protocol.rs` lines 11-44) is "the normalized thing celld
  reads to know what to run". It carries the script name, version, the worker
  modules, asset and cron metadata, queue consumers, and a `required_features`
  list.
- **Deploy pointer** — the node reads `deploy/current.json` every 30 seconds
  and adopts the deployment it names (`docs/README.md` lines 245-255); the
  deployment types include `DeployPointer`, `Manifest`, `ModuleKind`, `Rollout`.

Supported deployment features are gated up front. `SUPPORTED_DEPLOYMENT_FEATURES`
enumerates the values a build can load (`protocol.rs` lines 54-64):

- `assets-v1`, `cron-v1`, `d1-v1`, `kv-v1`, `queues-v1`, `sqlite-vec-v1`,
  `r2-v1`, `wasm-v1`, `workflows-v1`.

"A manifest requiring anything else must be rejected up front" (lines 53-54),
because a node without the corresponding reserved class would otherwise load a
config it cannot honor — e.g. without the reserved `__D1Database` class "a
build without ... would load the manifest and then fail every `env.DB` call at
request time" (lines 68-71). The gates move silent runtime failures to the
deploy.

The reserved Durable Object classes that back these features are declared in
`crates/celld/deploy.rs` (lines 58-81): `__D1Database`, `__Workflow`,
`__KvNamespace`, `__Queue` (with the cron class `.cron` defined in
`crates/logic/cron.rs`). A user config naming one of these is refused, because
the harness registers each class in every isolate.

## Rejecting unsupported input

Two independent enforcement points cover the "silent gap is a defect" rule:

1. **Deploy-time allowlist** (`docs/cloudflare-compat.md` line 331): an unknown
   config key stops the deployment; an unsupported binding type is refused at
   deploy.
2. **Manifest feature gate** (`protocol.rs` lines 54-81): a manifest requiring
   an unknown feature is rejected *before* any node loads it.

These compose with the differential-conformance testing described on the
[testing page](testing.md), which ensures each surface is exercised against
workerd with identical bytes.
