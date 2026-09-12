---
type: operations
title: Operator CLI
description: The celld operator commands — diagnose, cell, d1, kv, queue, dev, and the control-plane enrollment commands — plus the shared stdout/stderr and bounded-listing conventions they all follow.
tags: [cli, operators, diagnose, cell, d1, kv, queue]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-74510bca427f93999e1bbdd0
    resource: repo://crates/celld/cli_output.rs
  - id: openwiki-source-55e133f02ad99db05fcca8ad
    resource: repo://crates/celld/d1_cli.rs
  - id: openwiki-source-6d3d805980c86df360693637
    resource: repo://crates/celld/kv_cli.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-6c4e31d2bf3e043b470c02ee
    resource: repo://crates/celld/operator_cell.rs
  - id: openwiki-source-cb45cb88385401a2b1df7330
    resource: repo://crates/celld/queue_cli.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Operator CLI

`celld` is one binary whose subcommands split cleanly into two kinds: a
**node** (`celld` with no subcommand, or `celld dev`) whose stdout *is*
its log, and **operator commands** whose stdout is their answer
(crates/celld/main/cli.rs#L30-L38).

## Output conventions

Three rules hold across every subcommand (crates/celld/cli_output.rs#L7-L20):

1. **stdout carries data, stderr carries everything a person reads.** A
   command that mixes them corrupts the first pipe it meets.
2. **A listing is bounded by default**, and says on stderr what it
   withheld and how to continue. Cost follows the fleet's size, not the
   operator's question.
3. **A closed pipe ends the output; it is not a failure.** `BrokenPipe`
   is the only write error that means success — what `| head` does — while
   every other write error stays an error, so a truncated redirect is not a
   silent success (crates/celld/cli_output.rs#L87-L109).

The enforcement is the `Record` trait: a row cannot be printed as text
without also declaring its JSON shape, so `--json` cannot be
half-implemented, and `Resumable` demands a cursor so a listing that
forgets its resume line fails to compile (crates/celld/cli_output.rs#L27-L47).

## Reaching a reserved cell

D1, KV, and Queues are cells in reserved classes, and operator commands
reach them the same way: find a live node through the node leases, sign a
request with the fleet secret, and post it to `/runtime/<scope>`, which
forwards to the cell's owner. No command can open the object in the bucket
instead (that writes behind the fence, and the owner's next flush
overwrites it), and none can name one node, because an operator's internal
listener has an ephemeral port by default. Every live node with a lease is
an equal entrance — the list stays correct even when the cell moves
between calls (crates/celld/operator_cell.rs#L3-L17,
crates/celld/operator_cell.rs#L53-L64).

## `celld diagnose`

`celld diagnose` enumerates every node lease by default, then performs a
signed direct probe of each live peer. The report keeps checking after an
individual failure and distinguishes expired records, malformed or unsafe
advertise addresses, unreachable peers, and incompatible protocols; it
also prints each node's coarse resident-cell, WebSocket, RSS, CPU,
file-descriptor, pressure, and shedding sample. Pass `--peer NODE_ID`
one or more times to restrict the check, and `--read-only` to skip the
conditional-write probe when diagnosing with a credential that cannot
write (README.md#L204-L215, docs/guarantees.md#L72-L74). Each node line
shows `restoring`, the count of cold routes holding or waiting for an
activation permit, which a rolling update should wait on
(docs/README.md#L571-L576).

## `celld cell list`

`celld cell list` lists the Durable Object instances in the fleet bucket,
one `Class:ID` scope per line, with `--json` for one JSON object per line.
An instance appears after the first event reaches it, because its owner
then writes an ownership record to the bucket; an ID an application only
derives does not appear. The listing is bounded: one storage request
returns at most 1000 instances, and the command reports on stderr that
more exist and gives the `--after SCOPE` that continues the listing; pass
`--all` to read the whole listing, `--limit N` for a different bound, or
a class name to list only that class (docs/README.md#L588-L629). The
`--json` output marks celld's own reserved cells (D1, KV, Workflow — their
names start with `__`) with `"reserved": true`
(docs/README.md#L596-L604).

## `celld d1`

`celld d1` runs SQL and migrations against a deployed D1 database,
finding a node through the same node leases. `celld d1 migrations apply
NAME --bucket ...` applies a migration ledger; the CLI holds no ownership
logic and no SQLite — it reaches the owner through the authenticated
`/runtime/` route (crates/celld/d1_cli.rs#L3-L8, docs/README.md#L341-L347).

## `celld kv`

`celld kv` reads and writes a deployed KV namespace. Its bulk commands use
the Wrangler file format, so a `wrangler kv bulk get` export can migrate
directly into celld (`celld kv bulk put NAME export.json`).
`celld kv list` is bounded like every listing (1000 keys by default, with
`--after KEY` and `--all`), and `celld kv get KEY > value` writes the
value to stdout and nothing else
(crates/celld/kv_cli.rs#L3-L8, docs/README.md#L349-L361).

## `celld queue`

`celld queue` inspects and controls a deployed Queue broker
(`celld queue info NAME`, `pause`, `resume`). A queue can continue to
accept messages while delivery is paused. The command reaches the
reserved Queue cell through the authenticated fleet operator route and
does not read SQLite or implement a queue transition itself — the cell
owns each mutation, so the Worker binding and the CLI cannot disagree
about the stored state (crates/celld/queue_cli.rs#L3-L8, docs/README.md#L250-L257).

## `celld dev`

`celld dev` is the local application stack: it opens a local object store,
deploys the application, and starts one supervised celld node on
`http://127.0.0.1:9876` by default, keeping durable state in `.celld/dev`
below the project directory. It watches the project and rebuilds the
application after a source or configuration change, keeping the current
application running if a build fails (docs/README.md#L274-L337).

## Control-plane enrollment

The `connect`, `credentials`, `token`, and `disconnect` actions handle
managed control-plane enrollment for a node running with
`CELLD_CLOUD`/`--control-plane` (crates/celld/main.rs#L3063-L3074,
crates/celld/control_plane.rs). A managed installation issues and
validates S3-compatible storage only — celld's GCS and Azure clients
authenticate through mechanisms a control-plane-issued credential does not
provide (crates/celld/main.rs#L3227-L3231).
