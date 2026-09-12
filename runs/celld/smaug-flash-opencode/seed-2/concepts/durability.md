---
type: "Reference"
title: "Ownership, fencing, durability, and the output gate"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-c6c8c55af3ba6827f33bf834
    resource: repo://crates/logic/gate.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---


# Ownership, fencing, durability, and the output gate

celld makes two promises about your data: exactly one node serves a cell at a
time, and celld does not answer a write until that write survives a failure
(`docs/guarantees.md:3-5`). This page grounds both in source.

## The bucket contract

celld needs three properties from the object store: a conditional create, a
conditional overwrite, and read-after-write consistency. The qualified stores
are Amazon S3, Cloudflare R2, Tigris, Google Cloud Storage, and Azure Blob
Storage. Backblaze B2, Hetzner, and DigitalOcean Spaces do not implement the
required conditional writes and are not correct (`docs/guarantees.md:18-34`).

`crates/celld/bucket.rs` is the single object-store client. It speaks two
conditional-write dialects to the shared surface:

- **S3 / Azure** (`s3://` or bare, `az://`): the CAS token is the etag, sent
  as If-Match / If-None-Match (`crates/celld/bucket.rs:7-11`). Azure Put Blob
  honors both headers.
- **GCS** (`gs://`): the CAS token is the object generation, sent as
  `x-goog-if-generation-match` with OAuth credentials. GCS does not apply
  If-Match to a PUT (`crates/celld/bucket.rs:12-16`).

The token is an opaque `String` a read answers and a conditional write
consumes; callers never see the difference. Error handling is strict:
`put_cas` answers `Ok(None)` only for a clean 412/409 rejection, and every
other failure is ambiguous — the write may have committed (`crates/celld/bucket.rs:20-24`).
The CAS store is built with retries OFF, because a retried CAS put can land on
its own token change and report a false clean rejection; ambiguity must surface
as `Err` so the caller reconciles (`crates/celld/bucket.rs:155-158`).

`is_clean_cas_rejection` treats `Error::Precondition` and `Error::AlreadyExists`
as a clean lost race and keeps every other error ambiguous
(`crates/celld/bucket.rs:183-188`).

## The ownership record and epochs

Each cell has one ownership record in the bucket, `cells/<cell>/own.json`. A
node acquires a cell with a conditional write — a create when no record exists,
a compare-and-swap on the previous record when one does — so two nodes cannot
acquire the same cell (`docs/guarantees.md:108-114`). Every activation advances
the epoch, and an epoch never has two writers.

The adapter `crates/celld/ownership_store.rs` reads/writes these records.
`read_owner` loads `cells/{cell}/own.json` as `{node, epoch}` and carries the
etag (`crates/celld/ownership_store.rs:288-299`). `cas_owner` writes the CAS,
`release_owner` publishes a cell unowned keeping its epoch
(`crates/celld/ownership_store.rs:386-420`).

## The epoch prefix

The replicator copies each cell's SQLite data to the bucket under
`cells/<cell>/ltx/e<epoch>/` with plain unconditional PUTs. The epoch in the
key is the fence: a node that lost ownership can keep writing, but its writes
land in a superseded prefix, and a restore selects the current lineage
(`docs/guarantees.md:122-128`).

## The acknowledgement rule (RPO=0) and the output gate

A **gate** holds each write response until a durability proof covers the write
(`docs/guarantees.md:134-142`). In the core this is the **output gate**.
Every channel through which an output can reveal the cell's state arrives at
`Event::Output`, and the core withholds it until every write it can reveal is
proven durable (`crates/logic/types.rs:501-515`).

`Effect::AwaitDurable` proves the cell's committed `position` is replicated so
a withheld local write response can be released; unlike `EnsureDurable` it is
per-request and changes no cell phase (`crates/logic/types.rs:857-864`).

- A **bucket proof** reads the ownership record once and acknowledges only if
  the record still names this node at this epoch; the receiver
  `Effect::VerifyOwnership` emits this read (`crates/logic/types.rs:867-873`).
  A partitioned node can replicate into its superseded prefix, but the
  ownership read shows the new owner, so the write is not acknowledged.
- A **fleet proof** does not require that read: the owner sends each write to
  one or two other follower nodes, every follower must fsync, and a takeover
  seals the prior node-log session before it restores
  (`docs/guarantees.md:144-149`). `ProofSource` distinguishes the two because
  their fences differ (`crates/logic/types.rs:375-379`).

`Config` gates the whole feature: `CELLD_OUTPUT_GATE` defaults to `1`; setting
`0` removes the replication wait (`docs/README.md:690`).

## Node leases and self-fencing

Each node holds a lease in the bucket (`nodes/<node>.json`) with an expiry; it
renews after one third of the lifetime (`CELLD_TTL_MS`, default 10000 ms)
(`docs/guarantees.md:202-205`). A renewal that does not reach the bucket does
not fence the node until the published expiry passes. When it passes, the node
fences itself: it stops each active cell and fails every uncompleted request.
A node whose lease record was replaced or removed fences at once
(`docs/guarantees.md:207-213`).

The fence writes nothing to the bucket; peers read the lease as dead or
replaced and acquire the cells through the ownership records. A request is safe
even before the fence runs because celld compares the current time against the
published expiry each time it routes (`docs/guarantees.md:214-218`). The
`node_authoritative()` predicate in the core evaluates the lease's published
validity at ask time on the monotonic clock, matching the fence timer's
polarity so the predicate and the timer cannot disagree
(`crates/logic/lib.rs:723-737`).

A fenced node logs a line starting with `SELF-FENCE:` and exits with code 3; the
fenced state is terminal and only a restart returns it to the fleet
(`docs/guarantees.md:220-224`).

## The input gate is a separate concern

`crates/logic/gate.rs` implements the worker-level **input gate**
(`blockConcurrencyWhile`) that holds back *delivery* of incoming events, not
durability. It is distinct from the output gate: the input gate stops another
event from running while a handler holds it, so a handler that must not be
interrupted cannot resume to find its own state changed
(`crates/logic/gate.rs:3-9`). In celld every storage path is local SQLite
underneath, so reads and writes complete inside the turn that started them and
never yield to another event (`crates/logic/gate.rs:16-24`). The input gate's
`acquire` is synchronous with the JS call that asks for it
(`crates/logic/gate.rs:47-53`).

---

## Related pages

- [Cells and the lifecycle state machine](/openwiki/concepts/cells.md)
- [LTX replication and the in-fleet node log](/openwiki/concepts/replication.md)
- [Security and trust model](/openwiki/security/trust-model.md)
