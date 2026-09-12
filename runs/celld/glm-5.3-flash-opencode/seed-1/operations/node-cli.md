---
type: operations
title: Node command surface and graceful shutdown
description: The celld command set and settings parsing, listener wiring and validation at startup, the internal operator API, the process shutdown sequence, and rolling-update guidance.
tags: [cli, listeners, operator-api, shutdown, rollout]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Node command surface and graceful shutdown

## The command line: actions and settings

`crates/celld/main/cli.rs` answers one question — which `Action` to take —
and "refuses anything ambiguous rather than guessing"
[crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L3-L8). The
action set is:

- `Run(Settings)` — serve a node (the default when a bucket/listener is
  configured).
- `Diagnose { peers, read_only, json }` — fleet inspection; `--read-only`
  skips the write probe for a credential that cannot write.
- Subcommands delegating to arguments: `deploy`, `dev`, `cell`, `d1`,
  `kv`, `queue`, `connect`, `credentials`, `token`, `disconnect`
  [crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L31-L54).
- `Help` and `Version`.

Code Mode / dev-supervisor context is significant in the settings:
`dev_store` is set **only** by the `celld dev` supervisor for its child
node; "No fleet flag or public environment variable selects the local
backend" and a dev store is rejected outside the exact
`celld dev` node configuration
[crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L26-L28)
[crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L248-L256).

Startup validation mirrors the security/consistency rules documented
elsewhere:

- A non-loopback `--listen` requires an explicit `--internal-listen`
  (celld does not reuse the public listener for peers) and `--advertise`
  requires an explicit internal listener.
- Unknown commands/options bail with `celld --help` for usage.
- `CELLD_STORAGE_PROBE` (default on) decides whether the node tests the
  bucket's conditional write before serving; "a store that accepts the
  precondition and ignores it makes the node self-fence in a loop", which
  is why the probe ships enabled
  [crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L22-L25).

Listener defaults come from the settings resolution: a standalone node
without an explicit listen uses `127.0.0.1:8080`; a control-plane node
uses `AutoLoopback`; the internal listener defaults to a random loopback
port; the region defaults to `us-east-1` via `AWS_REGION` /
`AWS_DEFAULT_REGION` [crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L134-L247).

Stream discipline is deliberate: `Action::stdout_is_data` decides whether
this invocation's stdout carries data or a log stream. A node's stdout
*is* its log (Docker/journald read it), while a subcommand's stdout is
its answer — `celld kv get > value` must carry only the value, which is
how this was founded ("an allocator warning landed in front of a value")
[crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L57-L70).

## Listener binding at startup

`bind_ingress_listener` binds the public listener;
`bind_internal_listener` binds the peer/operator listener and enforces
the advertise guardrails (public-IP advertise rejected unless
`--unsafe-public-advertise`; loopback vs network classification)
[crates/celld/main.rs](repo://crates/celld/main.rs#L3095-L3100)
[crates/celld/startup.rs](repo://crates/celld/startup.rs#L217-L246).
The `listen`/`internal listen`/`advertise` lines each log at startup
without being treated as readiness
[crates/celld/main.rs](repo://crates/celld/main.rs#L3107-L3120).

## The internal operator API

The internal listener serves an **alpha** operator API whose surfaces may
change between releases ("keep the operator tooling and the celld release
together") [docs/README.md](repo://docs/README.md#L546-L551):

- `/state` — node state (deployment served, draining deployments,
  objects moving, deployment per resident object; handoff and restore
  counters; pressure inputs).
- `POST /reload` — adopt the deployment pointer now; also rebuilds an
  unchanged deployment so a `CELLD_VARS_FILE` edit takes effect without
  a restart [docs/README.md](repo://docs/README.md#L246-L255).
- `POST /shutdown` — start the same graceful handoff; the
  `handoff=preserve` query prepares a clean same-node reload
  [docs/README.md](repo://docs/README.md#L548-L550).

Operator routes are unauthenticated and must stay off the public
internet [docs/security.md](repo://docs/security.md#L87-L99).

## Shutdown sequence

A node shuts down gracefully on SIGTERM/SIGINT (which `systemctl stop`,
`docker stop`, and a Kubernetes pod delete send). The documented
sequence is [docs/README.md](repo://docs/README.md#L429-L478):

1. Health flips unhealthy so a load balancer stops routing; public
   requests get 503; accepted requests finish; versioned peer traffic
   for not-yet-handed-off cells continues.
2. The node claims the fleet **drain token** (advisory;
   `CELLD_DRAIN_TOKEN_WAIT_MS` default 30000) so concurrent donors hand
   off one at a time.
3. Handoff proceeds in batches paced by `CELLD_RELEASES`,
   `CELLD_ACTIVATIONS`, `CELLD_SHUTDOWN_DRAIN_MS` (progress-clock,
   default 25000), and `CELLD_SHUTDOWN_TOTAL_MS` (40 000 default for the
   complete stop). Orchestrator stop grace must be longer, or SIGKILL
   can cut the handoff.
4. `POST /shutdown?handoff=preserve` runs the same machinery without a
   successor, keeping the ownership records for a clean same-node
   reload, bounded by the drain interval since it has no successor
   acknowledgements.

The internal listener continues serving `/state` during the drain, with
handoff and restore counters; the public health response identifies the
drain with a 503 [docs/README.md](repo://docs/README.md#L504-L506).

## First-readiness gate

A fresh process holds its **first** healthy response until the fleet
settles: live node lease present, no active donor, memory below every
pressure low watermark on each live node, and a restore backlog within
one `CELLD_ACTIVATIONS` budget. Unreadiness holds at most
`CELLD_READY_FLEET_GATE_MS` (default 120 000; 0 disables) before the
process reports healthy with a `ready_gate_expired` event; after the
first healthy response, fleet state never removes readiness again
[docs/README.md](repo://docs/README.md#L479-L494).

## Rolling updates and the upgrade ledger

Rolling update of an orchestrator — stop a node with SIGTERM, wait for
its replacement to report healthy, move to the next node — is the
supported rollout; celld paces handoffs internally and the
first-readiness gate paces against fleet recovery
[docs/README.md](repo://docs/README.md#L508-L512).

Some upgrades are exceptions and are documented with their reasons
[docs/README.md](repo://docs/README.md#L514-L544):

- **v0.1.0 → v0.2.0**: not a rolling update — ownership records from
  v0.1.0 name addresses v0.1.0 peers cannot follow after a v0.2.0
  advertise change, and v0.2.0 block-object compaction is unreadable by
  v0.1.0 restore. A fleet must not mix the two versions.
- **v0.2.1 → v0.3.0**: rolling update OK; the new default
  `CELLD_DURABILITY=fleet` activates automatically with two or more
  nodes. A v0.3.0 node cannot replicate to a v0.2.x peer, so it
  acknowledges through the bucket and retries; do not start a v0.2.x
  binary after it runs v0.3.0 unless the shutdown log contains
  `node-log close: sealed epoch`.
- **v0.3.0 → v0.4.0**: not a rolling update — every proxied call moves
  onto one tunneled plain-HTTP connection and the peer protocol refuses
  a different version, and v0.4.0 stores large KV values under an
  epoch-qualified row reference a v0.3.0 node cannot read.

## Failure signalling at process exit

`exit_flushed(code)` drops the log guard and calls `std::process::exit`
— a deliberate hard exit that skips destructors but guarantees the last
log lines land [crates/celld/main.rs](repo://crates/celld/main.rs#L118-L121)
[crates/celld/main.rs](repo://crates/celld/main.rs#L59-L59).

## Related pages

- [Restore and takeover](/openwiki/data/restore-takeover.md) — the
  handoff machinery's internals.
- [Configuration](/openwiki/operations/configuration.md) — the variable
  reference behind the decision logic here.
- [Fleet model](/openwiki/architecture/fleet-model.md) — listener and
  peer-transport topology.
