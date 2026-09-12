---
type: "Reference"
title: "Operator CLIs"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-d67853ffafaf731eb8cddf50
    resource: repo://crates/celld/cell_cli.rs
  - id: openwiki-source-5582430152973ab16bc08716
    resource: repo://crates/celld/cli_options.rs
  - id: openwiki-source-74510bca427f93999e1bbdd0
    resource: repo://crates/celld/cli_output.rs
  - id: openwiki-source-55e133f02ad99db05fcca8ad
    resource: repo://crates/celld/d1_cli.rs
  - id: openwiki-source-6d3d805980c86df360693637
    resource: repo://crates/celld/kv_cli.rs
  - id: openwiki-source-6c4e31d2bf3e043b470c02ee
    resource: repo://crates/celld/operator_cell.rs
  - id: openwiki-source-cb45cb88385401a2b1df7330
    resource: repo://crates/celld/queue_cli.rs
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---


# Operator CLIs

`celld <cell|d1|kv|queue|diagnose> …` are operator surfaces over a running fleet, each a module in `crates/celld` that deliberately contains no ownership or storage logic — "the cell validates each bound and owns each mutation, so the Worker binding and the CLI cannot disagree about the stored state" (crates/celld/queue_cli.rs#L6-L11).

## Shared plumbing: one fleet, one output style

`cli_options.rs` centralizes `--bucket`/`--endpoint`/`--region` and their `CELLD_*` fallbacks because "four commands parsed them separately before this module existed. That is how `--bucket gs://name` came to be handled in one place and not another: a rule spread across four loops is a rule four authors have to remember" (crates/celld/cli_options.rs#L5-L12). Every `celld` command then obeys the three rules `cli_output.rs` exists to make un-divergable: "stdout carries data, stderr carries everything a person reads. A command that mixes them corrupts the first pipe it meets. A listing is bounded by default, and says on stderr what it withheld and how to continue… A closed pipe ends the output; it is not a failure" (crates/celld/cli_output.rs#L9-L17). Enforcement is structural: a `Record` must implement both `json()` and `text()` so `--json` cannot be half-implemented, and resumable listings implement a separate `Resumable` trait so "a listing that forgets its cursor fails to compile instead of printing a resume line that does not work" (crates/celld/cli_output.rs#L18-L50).

## Why operators go through a node

The commands cannot open bucket objects directly: "that writes behind the fence, and the owner's next flush overwrites it. Neither can name one node either, because an operator's internal listener has an ephemeral port by default" (crates/celld/operator_cell.rs#L5-L12). So the shared machinery walks `nodes/*.json` leases for live nodes, reads the fleet secret from the bucket, and posts to any node's `/runtime/<scope>` route — "the list is a set of equal entrances and not a route" — and each chosen node forwards to the cell's owner (crates/celld/operator_cell.rs#L55-L128). Requests are signed with the peer HMAC per entrance, "because the signature binds the node it is addressed to," with per-subject source labels (what appears in the node's log) and work-shaped timeouts ("a migration on a large table is not a diagnostic ping") (crates/celld/operator_cell.rs#L26-L50, #L122-L128). `/runtime/` refuses unsigned requests because a reserved cell "holds application data and answers arbitrary SQL" (crates/celld/operator_cell.rs#L45-L50).

## The commands

- **`celld cell list [CLASS] [--json] [--after SCOPE] [--all] [--limit N]`** enumerates DO instances as storage-order `Class:ID` scopes: one listing costs one bounded LIST of `cells/` common prefixes (≤1,000 per request), `--after` resumes from the printed scope (translated to the store's `cells/<scope>/` child key), and `--all` paginates while reporting progress on stderr (crates/celld/cell_cli.rs#L14-L20, #L149-L247, README.md#L219-L232). Rows carry `"reserved": true|false` because D1 databases, KV namespaces, and Workflows are real data in reserved classes — filterable with `jq` (crates/celld/cell_cli.rs#L54-L64, README.md#L596-L605).
- **`celld d1 execute` and `celld d1 migrations apply|list`** run SQL and the migration ledger against a deployed D1 database; the JSON protocol is method-shaped (`exec`, batched `statements`, a `migrate` call with the ledger table), migration files must be `.sql`, and an option in the subcommand slot is reported as a missing subcommand rather than a typo hunt (crates/celld/d1_cli.rs#L247-L304, #L434-L446, README.md#L235-L241).
- **`celld kv get|put|delete|list|info` and `bulk get|put`** drive a KV namespace cell with ops `{op: get|put|put-base64|delete|list|info}`; large values use the base64 op, `list` is bounded at 1,000 keys with the `--after`/`--all` contract, and bulk files are the Wrangler format (including its `base64: true` marker) so "a Wrangler export can migrate directly into celld" (crates/celld/kv_cli.rs#L138-L385, #L408-L410, README.md#L242-L247).
- **`celld queue info|pause|resume|purge|peek|redrive`** inspects and controls a Queue broker cell; pause stops delivery while producers keep enqueueing (README.md#L250-L257, crates/celld/queue_cli.rs#L62-L107). `purge` requires `--force`, and `--force` means nothing to the other verbs, which the parser rejects (crates/celld/queue_cli.rs#L162-L165).
- **`celld diagnose`** shares the same lease-walking but performs signed `/peer/probe`s and classifies fleet health (see [Fleet Operations](/openwiki/operations/fleet-operations.md)); its verdicts go through the same `Output` boundary (crates/celld/fleet.rs#L4-L7).

All of these need only bucket credentials (the fleet-admin boundary: "the bucket credentials give full control of the fleet") plus private-network reachability to one live node — never the public listener (docs/README.md#L201-L203, README.md#L189-L200).

Related: [Cloudflare Compatibility Surface](/openwiki/concepts/cloudflare-compat.md), [Listeners and Peer Networking](/openwiki/concepts/networking-peers.md), [Fleet Operations](/openwiki/operations/fleet-operations.md).
