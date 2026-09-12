---
type: storage
title: Cell Storage and SQLite
description: The Durable Object storage API backed by per-cell SQLite — synchronous ops behind async JS, SQL and cursors, KV and D1 storage, the on-disk layout, and SQLite failure handling.
tags: [storage, sqlite, kv, d1, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-71a9e960c45e5efe230ee7b5
    resource: repo://crates/celld/js/storage_ops.rs
  - id: openwiki-source-407f6154ded2a2342941e356
    resource: repo://crates/celld/storage.rs
  - id: openwiki-source-d2d7d8ace8d959adef6686ac
    resource: repo://crates/logic/kv.rs
  - id: openwiki-source-0cf02de4c4ddf27a70ec8634
    resource: repo://crates/logic/sqlite.rs
  - id: openwiki-source-4d936a610dc0c9b35c2eae1a
    resource: repo://crates/ltx/src/db.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Cell Storage and SQLite

Each cell owns a private SQLite database, and the Durable Object storage
API is that database. `ctx.storage` is async in JS but synchronous
underneath — the ops are sync Rust, wrapped in `async` by the JS harness —
so the same contract holds with no thread-hopping
(crates/celld/storage.rs#L6-L14).

## One database per cell

Each cell is its own database file, with its own replicated, epoch-fenced
bucket prefix, so the JS thread holds a `scope → Connection` map: `open`
on activate, `close` on evict (crates/celld/storage.rs#L10-L14). The map
couples each connection with the ownership epoch that authorized its
activation — one residency invariant that keeps asynchronous object-store
work from recovering an epoch through a later ownership lookup after a
takeover (crates/celld/storage.rs#L52-L60).

The storage state belongs to the **isolate**, not a thread. A cell event
is driven by a tokio task, and its turns run on whatever worker holds the
isolate, so state keyed by thread would be invisible to the next turn.
Nothing here is synchronized, and nothing needs to be: a turn holds the
isolate lock, so exactly one thread can reach the maps at a time
(crates/celld/storage.rs#L22-L33).

## The storage surface

`storage_ops.rs` is the V8 surface over `crate::storage`: key-value, SQL,
and the value encoding shared by both. Nothing there decides anything —
each op converts V8 values to Rust, calls into `storage`, and converts the
answer back. The storage semantics live in `storage.rs` and the
serialization format lives in `storage_ops.rs`, because it is what JS can
see (crates/celld/js/storage_ops.rs#L3-L8).

Per-cell state kept by the storage layer includes committed alarm
mutations (drained by the turn that committed them and reported to the
host as a turn output), list and SQL cursors, statement caches, and a
schema cookie. The schema cookie caches `PRAGMA schema_version` because
the pragma is a real query that takes a shared pager lock — an `fcntl` on
the database file — and a handler that touches no storage would otherwise
still pay two locked reads per event; the cookie is reusable unless a new
prepare or a new completed change moved it
(crates/celld/storage.rs#L62-L80).

## SQLite failure handling

A failed SQLite operation poisons the actor only when a critical engine
error (`SQLITE_FULL`, `SQLITE_IOERR`, `SQLITE_NOMEM`, `SQLITE_INTERRUPT`)
coincides with a destroyed transaction — SQLite rolled an active
transaction back, observable as autocommit being re-enabled. Anything else
— a statement error, a critical error that spared the transaction, or a
failure outside a transaction — recovers (crates/logic/sqlite.rs#L15-L28).

## KV storage

A KV namespace is a cell (`__KvNamespace`), and the bounds that decide
where data lives ship as **data** (`__cell.kvLimits`) that the JS harness
compares against — one source of truth, because the Rust checks became a
copy nothing called (crates/logic/kv.rs#L3-L17). The limits
(crates/logic/kv.rs#L37-L65):

- key at most 512 bytes; value at most 25 MiB; metadata at most 1 KiB;
- an expiry shorter than 60 s is refused at the call;
- one bulk call reads at most 100 keys; one `list` page returns at most
  1000 keys.

The largest value stored **inline** in the namespace cell is 1 MiB
(`MAX_INLINE_VALUE_BYTES`): a cell's writes replicate as LTX, so an inline
value is paid twice on every write, and a measured fleet A/B found the
inline path faster at 1 MiB and the bucket path faster at 2 MiB. Above
that bound the bytes go to the fleet bucket and the row names them — the
split Cloudflare's own KV rearchitecture made (crates/logic/kv.rs#L41-L56).

Large-value references are epoch-qualified: a v2 reference
(`v2:e<epoch>:<digest>`) includes the ownership epoch that wrote the
object, stored under `kv/blobs-v2/<cell>/e<epoch>/<digest>`, so an older
owner's collector cannot address an object from a later owner. A cell can
read a reference from its current epoch or an older one, a new write must
use exactly the epoch that authorized the activation, and only objects
from the collector's epoch or older are collectable
(crates/logic/kv.rs#L169-L208).

## D1 storage

A D1 database is also a cell. D1 differs from KV in that a Worker binds
the same database by SQL: `env.DB` executes statements against the cell's
SQLite. A binding result can contain at most 100,000 rows or 32 MiB, and
celld refuses invalid UTF-8 from a SQLite `TEXT` value — store arbitrary
bytes in a `BLOB` (docs/cloudflare-compat.md#L110-L116).

## On-disk layout and replication

The local database lives at `<watch>/<cell>/ltx/e<epoch>/db.sqlite`,
mirroring the `cells/<cell>/ltx/e<epoch>/` bucket prefix. The `celld-ltx`
`Db` opens the database in WAL mode with `wal_autocheckpoint(0)`, holds a
long-running read lock for the checkpoint takeover, and captures each
committed write as L0 LTX segments (crates/ltx/src/db.rs#L5-L32). Storage
semantics and replication semantics are therefore the same file: the
acknowledgement rule (the output gate) holds each response until the
captured data is proven durable.
