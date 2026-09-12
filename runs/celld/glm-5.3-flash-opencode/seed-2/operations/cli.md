---
type: operations
title: CLI and operator surface
description: The celld command tree — daemon flags, deploy, dev, cell list, d1, kv, queue, diagnose, and the operator output contracts.
tags: [cli, operations, diagnostics, dev]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-d67853ffafaf731eb8cddf50
    resource: repo://crates/celld/cell_cli.rs
  - id: openwiki-source-d271645e8d40f1fc2d0c8902
    resource: repo://crates/celld/dev.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-6c4e31d2bf3e043b470c02ee
    resource: repo://crates/celld/operator_cell.rs
  - id: openwiki-source-cb45cb88385401a2b1df7330
    resource: repo://crates/celld/queue_cli.rs
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# CLI and operator surface

## The command tree

The `celld --help` output is the compact operator contract
(repo://crates/celld/main/cli.rs#L271-L322):

```
celld --bucket [s3://|gs://|az://]NAME[/PREFIX] [OPTIONS]  # run a node
celld deploy [PROJECT] --bucket ...
celld dev [PROJECT] [--host IP] [--port PORT] [--logs]
celld cell list [CLASS] --bucket ...
celld d1 migrations apply|execute DATABASE ...
celld kv get|put|delete|list|info NAMESPACE ...
celld queue info|peek|purge|pause|resume|redrive QUEUE ...
celld diagnose --bucket ... [--peer NODE_ID]...
```

Each subcommand is its own module: `deploy.rs`, `dev.rs`, `cell_cli.rs`,
`d1_cli.rs`, `kv_cli.rs`, `queue_cli.rs`, and `fleet.rs` for diagnose.
The daemon `main` dispatches these to their modules and only falls back
to running a node when no subcommand is named
(repo://crates/celld/main.rs#L3095-L3131).

## The daemon mode (running a node)

Production install is exactly `celld --bucket s3://NAME [OPTIONS]` for the
common case (or `gs://`/`az://`). Core options with defaults:

- `--listen IP:PORT` — public Worker listener, default `127.0.0.1:8080`;
  a non-loopback address requires `--internal-listen` to be configured.
- `--internal-listen IP:PORT` — peer and unauthenticated operator listener,
  default `127.0.0.1:0` (an available loopback port per start).
- `--advertise ADDR:PORT` — the address peers reach the internal listener
  on, requiring an explicit internal listen.
- `--unsafe-public-advertise` — opt-in to a literal public advertise
  address. The CLI help warns: operator routes permit unauthenticated
  work, eviction, state inspection, and shutdown, so this is a deliberate
  choice, never a default.

(repo://crates/celld/main/cli.rs#L287-L322)

## `celld dev`

`celld dev` runs one node backed by a **local SQLite object store** rather
than a cloud bucket, which no production node can select
(repo://crates/celld/dev.rs#L3-L30). The command spawns the project
watcher with `notify::recommended_watcher` watching the project directory
recursively, so a rebuild is triggered by any source change
(repo://crates/celld/dev.rs#L106-L119). The state lives under `.celld/dev`
so later invocations reuse the durable data. `DEV_\*` internal flags are
set only by the dev supervisor for its child node
(repo://crates/celld/main/cli.rs#L26-L30). Output hides node info/warning
logs until `--logs` is passed; errors always show
(repo://README.md#L100-L110).

## `celld cell list`

Lists the fleet's Durable Object instances from the bucket. Output
properties:

- One `Class:ID` scope per line (or `--json`, one object per line).
- Output is in the store's key order, which is what makes `--after
  SCOPE` resumable — a repeat `--after` value is dropped because the
  store resumes from a key and every key below `cells/<after>/` sorts
  after it (repo://crates/celld/cell_cli.rs#L149-L157).
- Bounded: one listing request returns at most 1000 instances, so the
  command prints at most 1000 and reports on stderr that more exist;
  `--all` reads the whole listing (repo://README.md#L228-L232).

## `celld d1`, `celld kv`, `celld queue`

These operator commands read/write deployed Fleet data structures — a
D1 database (with a migration ledger that `migrations apply` extends),
a KV namespace (bulk commands read the Wrangler file format so a Wrangler
export migrates directly), and a Queue broker (info/peek/purge/pause/
resume/redrive). All share `operator_cell.rs`'s reach machinery: find a
live node from the bucket leases, sign the request with the fleet secret,
and POST `/runtime/<scope>` for the owner to apply (repo://crates/
celld/operator_cell.rs#L5-L20). It deliberately does not write the bucket
directly because a bucket write would happen behind the fence and be
overwritten by the owner's next flush (repo://crates/celld/operator_cell.rs#L5-L12).

## `celld diagnose`

Enumerates every node lease, probes each live peer with a signed direct
probe, and distinguishes failures: expired records, malformed or unsafe
advertise addresses, unreachable peers, and incompatible protocols. Output
lines keep the long-standing `ok bucket ...` / `fail peer X: ...` shape,
with `ok`/`skip` to stdout and `fail` to stderr so
`celld diagnose > report.txt` keeps the failure visible; in `--json`
mode each line is one diagnostic check for `jq` piping
(repo://crates/celld/fleet.rs#L61-L102, L315). Corner case: about the
conditional-write probe, a store that cannot fence makes every peer
result moot — so the probe runs first and its failure aborts the
diagnosis (repo://crates/celld/fleet.rs#L342).

The `--peer NODE_ID` option (repeatable) restricts probing to specific
nodes; the optional `--read-only` skips the bucket write probe (useful
with a read-scoped credential). Node probes report overloaded cells and
each node's coarse resident-cell, WebSocket, RSS, CPU, fd, pressure, and
shedding sample (repo://README.md#L204-L215).

## `/state` — the operator snapshot route

While a node runs, `GET /state` on the internal listener returns a
snapshot with the node's live state (cells, load, and the four memory
measurements used in pressure decisions); this is the operator-facing
version of what the internals track (repo://crates/
celld/main.rs#L2635-L2636).

## Plain-JSON contract

The CLI's JSON stdout contract is uniform: one JSON object per record
when `--json` is passed, no decoration, so `celld kv get KEY > value` or
`celld d1 execute ... --command` can be piped with no further parsing
(repo://crates/celld/main/cli.rs#L60-L66).
