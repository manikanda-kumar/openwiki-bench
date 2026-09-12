---
type: runtime
title: Worker Bindings and APIs
description: The supported Worker bindings and runtime APIs — Durable Objects, KV, R2, D1, Queues, Workflows, WebSockets, Web Crypto, node compat — and the Cloudflare compatibility boundary celld enforces at deploy or first use.
tags: [bindings, kv, r2, d1, queues, workflows, websockets, crypto]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-523ed570426ab2f0808c1530
    resource: repo://crates/celld/js/crypto.rs
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-d195a85fdc29d1ff9c9de33c
    resource: repo://crates/celld/js/r2_ops.rs
  - id: openwiki-source-7c8cfe78d4b8ae5d78ad0b6f
    resource: repo://crates/celld/js/zlib.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-5c0cf604d5cf50b924c1c4d6
    resource: repo://crates/celld/ws_client.rs
  - id: openwiki-source-5238b9aafd153b49d22d0084
    resource: repo://crates/logic/queue.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Worker Bindings and APIs

celld implements the Cloudflare Workers and Durable Objects APIs, with a
documented compatibility boundary. The governing rule: celld must reject
an unsupported configuration or API at deployment or first use — an
unsupported feature that does not cause an error is a defect
(docs/cloudflare-compat.md#L11-L13).

Supported binding types are Durable Objects, services, variables, assets,
D1, KV, Queues, Workflows, and R2; every other binding type is not
available (docs/cloudflare-compat.md#L196-L202). A Worker binding for a
Durable Object namespace gives `env.NS.get(id).fetch()` an instantiated
exported DO class (once per id) whose `state.storage` is backed by the
cell's SQLite (crates/celld/js.rs#L1-L8).

## The reserved classes

D1, KV, Queues, and Workflows are each implemented as a cell in a
runtime-supplied Durable Object class (`__D1Database`, `__Workflow` plus
per-script variants, the KV class, and the Queue class). The deployment
rejects a user config that names a reserved class, and the operator
surfaces for these classes are the `celld d1`, `celld kv`, and
`celld queue` commands (crates/celld/deploy.rs#L58-L81,
crates/celld/deploy.rs#L163-L175).

## KV

A KV namespace is a cell and has one writer — use more namespaces to
increase write capacity (docs/cloudflare-compat.md#L79-L93). celld has no
edge cache: `cacheTtl` has no effect and `cacheStatus` is `null`. A value
above 1 MiB requires a fleet bucket; when an application writes an
identical large value after a namespace changes owners, celld stores a
separate object so an old owner cannot delete the current value. A
namespace ID can use the Cloudflare hexadecimal form or another stable
string (docs/cloudflare-compat.md#L79-L93).

## R2

An R2 binding is served out of the fleet bucket the node already holds
credentials for, under the reserved `r2/<bucket_name>/` prefix — the same
durability, the same store, no second set of credentials. A node with no
bucket has nowhere to put a blob, and every op says so rather than
pretending (crates/celld/js/r2_ops.rs#L3-L10). Gaps include `ssecKey`, a
conditional write with a streamed body larger than 8 MiB, multipart resume
after a node move or restart, part replacement, and `jurisdiction`
(docs/cloudflare-compat.md#L145-L158).

## D1

A D1 database is a cell; a binding result can contain at most 100,000 rows
or 32 MiB, and celld refuses invalid UTF-8 from a SQLite `TEXT` value —
store arbitrary bytes in a `BLOB`
(docs/cloudflare-compat.md#L110-L116).

## Queues

A queue is one reserved cell that owns SQL and dispatch; the queue policy
module owns the stable address, the public bounds, the alarm deadline,
concurrency admission, retry timing, lease-generation advancement, and
settlement fencing, and never returns a bare sequence number for a
deliverable row so a late settlement from an expired lease cannot
acknowledge a newer delivery (crates/logic/queue.rs#L3-L10). Defaults are
a batch size of 10, a batch timeout of 5 seconds, and 3 retries, with
`max_retries` capped at 100 and `max_concurrency` at 250
(crates/logic/queue.rs#L30-L32, crates/logic/queue.rs#L343-L351).

A queue has one writer and one consumer script; the consumer cannot also
export a `fetch()` handler. celld retains a message for four days and you
cannot configure the period; pull consumers and the Queues HTTP API are
not available (docs/cloudflare-compat.md#L95-L108).

## Workflows

A workflow instance is a cell in a script-scoped reserved class. Gaps and
differences include: `create()` replaces a terminal instance with the same
ID (Cloudflare refuses each duplicate ID); celld replays `run()` from the
start so code outside a step runs again; a crash after a step side effect
can run the step callback again; `retention` and `locationHint` are not
available; non-step work cannot remain pending for more than 60 seconds; a
step result, an event payload, and the workflow parameters each have a
1 MiB limit; `delete()`, `deleteBatch()`, and rollback are not available
(docs/cloudflare-compat.md#L118-L143).

## WebSockets

celld serves WebSockets with fastwebsockets and connects with them too, so
a frame relayed to a cell's owner is framed, masked, and closed by one
implementation on both sides (crates/celld/ws_client.rs#L3-L8).
Differences from Cloudflare: `getTags()` is not available; a caller must
call `accept()` on the socket from a subrequest upgrade; an outbound
Worker socket closes after the response and `waitUntil` work end; celld
rejects an upgrade when the response status is not 101 and removes
Worker-supplied protocol and connection headers from an upgrade response;
`acceptWebSocket()` throws when the isolate uses more than 90 percent of
its V8 heap limit (docs/cloudflare-compat.md#L232-L245).

## Web Crypto and node:crypto

Web Crypto is **partial**: `wrapKey()` and `unwrapKey()` are not
available, RSA-PSS signing is not available, and Web Crypto does not
provide HKDF or PBKDF2 through `deriveBits()` — use `node:crypto` for
those algorithms (docs/cloudflare-compat.md#L247-L254). The crypto ops
accept SPKI, PKCS#8, JWK, and raw key formats, and the JS layer validates
arguments before the Rust ops run (crates/celld/js/crypto.rs#L3-L8).
`node:crypto` does not implement Diffie-Hellman, streaming signatures,
ciphers, RSA-PSS, or DSA signatures and key generation
(docs/cloudflare-compat.md#L286-L288).

## Node.js compatibility

celld implements `node:assert`, `node:async_hooks`, `node:buffer`,
`node:events`, `node:path`, `node:stream`, `node:timers/promises`, and
`node:util`. `node:zlib` implements only the synchronous gzip and deflate
functions (the streaming compression backend powers the Web
`CompressionStream`/`DecompressionStream` ops)
(crates/celld/js/zlib.rs#L3-L7). `node:fs` returns `ENOENT` from each
read, and every other Node.js module returns an inert stub — a known
silent gap (docs/cloudflare-compat.md#L279-L291).

## Compatibility flags

celld honors the `delete_all_deletes_alarm`, `js_rpc`,
`fetcher_no_get_put_delete`, `sqlite_vec`, `websocket_standard_binary_type`
flags and the static-assets navigation flags; it accepts each other
compatibility flag without effect, and `Cloudflare.compatibilityFlags`
reports only the flags celld honors
(docs/cloudflare-compat.md#L305-L317). The worker-compat switches are
computed from the manifest's `compatibility_date` and `compatibility_flags`
in `crates/celld/lib.rs#L483-L522`.

## Module resolution

A specifier is either a builtin, whose source `modules.rs` holds, or an
import of another worker, which resolves through the loader. Most builtins
are lazy: a module compiles the first time something reads its global, so
a worker that never touches `node:zlib` never compiles it
(crates/celld/js/modules.rs#L3-L7).
