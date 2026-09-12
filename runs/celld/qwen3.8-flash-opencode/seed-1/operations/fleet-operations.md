---
type: "Reference"
title: "Fleet Operations"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-02acfd4182787268658ca557
    resource: repo://crates/celld/memory.rs
  - id: openwiki-source-e8fcaece1f081632b9f33665
    resource: repo://crates/logic/cache.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---


# Fleet Operations

This page is the operator's runbook for a node and its fleet: what you configure, how a node starts, stops, sheds, and is verified. The coordination mechanisms themselves are [Durability and the RPO=0 Protocol](/openwiki/concepts/durability.md); peer routes are [Listeners and Peer Networking](/openwiki/concepts/networking-peers.md).

## Configuration contract

Every setting has a flag or an environment variable, and the contract is strict: "An unset variable selects its documented default. A Boolean variable accepts only `0` or `1`. celld exits during startup when a supplied value is invalid" (docs/README.md#L706-L708), enforced by the up-front `env_vars::validate()` sweep (crates/celld/env_vars.rs#L10-L26). The primary knobs — `CELLD_BUCKET`, `S3_ENDPOINT`, `--listen`/`CELLD_ADDR`, `--internal-listen`/`CELLD_INTERNAL_ADDR`, `--advertise`/`CELLD_ADVERTISE`, `CELLD_WATCH`, `CELLD_ACTIVATIONS`, `CELLD_DURABILITY`, `CELLD_OUTPUT_GATE`, `CELLD_MAX_RESIDENT_CELLS`, `CELLD_MAX_RSS_MB`, `CELLD_V8_HEAP_LIMIT_MB` — are tabulated with defaults in docs/README.md#L660-L702. The rules a topology rests on: an explicit advertised address requires an explicit internal listener, a non-loopback public listener requires an explicit internal listener, and a literal public advertise IP requires `--unsafe-public-advertise` (README.md#L189-L195). Nodes find each other only through bucket leases — "The second node needs no extra configuration, because a node finds the other nodes through the bucket" (README.md#L139-L141) — and a spare node receives no assignment until traffic reaches it (README.md#L291-L293).

## Object storage: dialects, credentials, probe

`bucket.rs` is the engine's single object-store client, speaking two conditional-write dialects behind one surface: S3 etag (`If-Match`/`If-None-Match`) for `s3://` and `az://` (Azure Put Blob honors the same headers), and the Cloud Storage XML generation dialect (`x-goog-if-generation-match`) for `gs://` — "GCS accepts S3-style requests on the same host but does not apply If-Match to a PUT, so only the generation dialect can fence there" (crates/celld/bucket.rs#L3-L19). Its error contract is load-bearing for self-fencing: `put_cas` answers `Ok(None)` *only* for a clean 412/409 rejection; everything else is ambiguous — "the write may have committed" — and surfaces as `Err`, and a response without a CAS token is an error, never an empty token (crates/celld/bucket.rs#L21-L25). Credential rules per provider (AWS chain; ADC for GCS; exactly one of account key / managed identity / workload identity for Azure, public authority host only) are documented with rejection semantics at docs/README.md#L126-L199; a bucket may carry a key prefix so two fleets share one bucket (docs/README.md#L205-L209).

Because "a store can also accept the conditional headers and ignore the condition, and that store fails late and silently," every node runs a four-step conditional-write probe at startup (`create, reject-create, update, reject-stale`) and stops on a broken store unless `CELLD_STORAGE_PROBE=0` (docs/guarantees.md#L59-L73, crates/celld/fleet.rs#L281-L306). `celld diagnose --read-only` skips the write probe for read-only credentials (crates/celld/fleet.rs#L235-L253).

## Graceful shutdown and paced handoff

SIGTERM/SIGINT (what systemd, docker stop, and a pod delete send) starts the drain: `/.well-known/celld/health` turns unhealthy, new public requests get 503, accepted public requests finish, and versioned peer traffic for not-yet-handed-off cells keeps flowing (docs/README.md#L427-L442). Handoff runs in batches: reserve cells, stop new local routes, prove the batch durable, try one L9 snapshot per closed database (the additive L0 chain is the fallback if the `CELLD_LTX_DURABILITY_TIMEOUT_SECS` window expires), release the ownership record, and ask a compatible peer to adopt it *dormant* — the donor's next batch waits on that acknowledgement (docs/README.md#L443-L457). Pacing knobs (defaults confirmed in code): `CELLD_RELEASES` 8, `CELLD_SHUTDOWN_DRAIN_MS` 25000 (max gap between completed handoffs, reset by each successor ack), `CELLD_SHUTDOWN_TOTAL_MS` 40000 (crates/celld/main.rs#L4054-L4056); "An orchestrator stop grace must be longer than this bound" (docs/README.md#L458-L469).

Simultaneous stops are serialized by the **fleet drain token**: one bucket object a donor claims before releasing anything, "so concurrent donors hand off one node at a time"; it is advisory — a donor that cannot claim it within `CELLD_DRAIN_TOKEN_WAIT_MS` (default 30000; `0` disables) proceeds anyway, a dead holder's claim expires, and handoff without it stays safe (docs/README.md#L471-L478, crates/celld/drain_token.rs#L3-L14, crates/logic/drain.rs#L3-L11). A deadline-cut handoff can leave a node-log recovery for the replacement process, and a waiting process can replace an unresponsive recovery after 30 seconds (docs/README.md#L495-L503). `POST /shutdown?handoff=preserve` prepares a same-node reload and keeps ownership records, bounded by the shorter drain value because there are no successor acks (docs/README.md#L467-L469, #L546-L551).

## First-readiness gate

A fresh process holds its first healthy response until the fleet is settled: its own live lease, no active donor, memory below every pressure low watermark on each live node, a total restore backlog no larger than one `CELLD_ACTIVATIONS` budget, and incumbent ownership counts within one equal-successor share above the fleet mean — the joining node must advertise paced-handoff support and own fewer cells than the busiest incumbent (docs/README.md#L479-L488). Older peers that do not publish the headroom field fall back to their pressure latch during mixed-version updates. The wait is bounded by `CELLD_READY_FLEET_GATE_MS` (default 120000, `0` disables; crates/celld/main.rs#L3872-L3876): after it expires the node reports healthy with a `ready_gate_expired` event, and fleet state never removes readiness again (docs/README.md#L490-L494, crates/celld/main.rs#L3939). The operational loop: rolling-update one node at a time, waiting for health and `restoring=0` on every node before the next stop (docs/README.md#L510-L513, #L571-L576).

## Memory pressure and shedding

Four measurements are sampled in one turn by `memory.rs`: process RSS, `in_use_bytes` (RSS minus jemalloc slack), the cgroup working set (`memory.current` − `inactive_file`, both v1 and v2 paths, floored at current if the snapshots race), and the complete cgroup `memory.current` charge (crates/celld/memory.rs#L3-L101). The classifier is pure and latched with hysteresis: each configured ceiling (ordinary threshold at `CELLD_MAX_RSS_MB`, default 80% of available memory; the absolute cap at 95%; 125% of an explicit threshold when the available memory is unreadable) has its own low watermark at 80% of that ceiling, "so one crossing can never hold the node against the other's watermark" (crates/logic/pressure.rs#L20-L48, #L195-L231, README.md#L267-L295). Residency is *not* a pressure signal: `CELLD_MAX_RESIDENT_CELLS` is a hard cap enforced at admission, and conflating the two "produced the placement churn and the admission wedge" (crates/logic/pressure.rs#L11-L15).

Under pressure celld "durably replicates and fences the least-recently used idle cells, publishes them as unowned without resetting their epochs, and refuses to reacquire new unowned cells," never shedding a cell with active work or a live host WebSocket; eviction-snapshot files accumulate and are LRU-bounded because that cache is pure optimization (README.md#L288-L295, crates/logic/cache.rs#L3-L10). `/state` reports the four inputs (README.md#L275-L276), and the node logs the cap warning and startup decision when a `CELLD_MAX_RSS_MB` value at or above 95% makes the cap the effective limit (README.md#L281-L287).

## Version upgrades

Three recorded constraints (docs/README.md#L514-L544): v0.1.0→v0.2.0 and v0.3.0→v0.4.0 require stopping the whole fleet first (addressing/compact-object incompatibility; the v0.4.0 tunnel protocol refuses version mismatches and its epoch-qualified KV references are unreadable by v0.3.0); v0.2.1→v0.3.0 is the ordinary rolling case. Downgrading behind a v0.3.x node loses fleet-buffered acknowledged writes unless the shutdown log shows `node-log close: sealed epoch` (docs/README.md#L530-L534).

## Diagnosing a fleet

`celld diagnose` enumerates every node lease (without taking one), then performs a signed `/peer/probe` against each live peer, continuing past individual failures and classifying them: expired records, malformed/unsafe advertise addresses, unreachable peers, authentication failures, protocol disagreement — plus each node's resident-cell, WebSocket, RSS, CPU, fd, pressure, and shedding sample and its `restoring` count (README.md#L203-L217, docs/README.md#L553-L576, crates/celld/main/cli.rs#L258-L265). For the data-plane listings (cells, D1, KV, queues) see [Operator CLIs](/openwiki/operations/operator-clis.md).

Related: [Quickstart](/openwiki/quickstart.md), [Node Runtime and Actor Loop](/openwiki/architecture/node-runtime.md), [Durability and the RPO=0 Protocol](/openwiki/concepts/durability.md), [Observability and Control Plane](/openwiki/operations/observability.md).
