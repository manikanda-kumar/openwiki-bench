---
type: "Reference"
title: "Change Guides"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-edfb954b706fa7744e175849
    resource: repo://crates/logic/peer.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-5238b9aafd153b49d22d0084
    resource: repo://crates/logic/queue.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---


# Change Guides

celld has few axioms. The two that decide most review-work are:

- **The pure decision core is the authority.** `crates/logic` decides; the
  effect adapters in `crates/celld` perform. For any behavior change, the
  decision lands in `crates/logic` and the mechanical I/O lands in
  `crates/celld`, and the deterministic simulator must be able to replay it.
- **The peer protocol version gates compatibility.** `PROTOCOL_VERSION` is a
  hard compatibility gate, not a negotiation hint. A protocol change that breaks
  cross-version interoperability refuses older peers rather than degrading
  silently.

This page splits the guidance into four representative tasks: changing a
durability/protocol decision, adding a Worker API surface, tuning runtime
knobs, and operating a rolling upgrade.

# 1. Change a protocol or durability decision

## Find the decision, not the I/O

Behavioral state advances only through `celld_logic::on_event`
(`crates/logic/lib.rs` lines 1-7). Before writing any effect-adapter code,
locate the sans-IO module that already owns the proposition you are changing.
celld distributes decisions by topic, all under `crates/logic`:

- **Durability / fencing / RPO=0** — `gate.rs` (the input gate), `output_gate.rs`
  (the acknowledgement rule), `restore.rs` (restore-source predicates).
- **Replicated-log tier** — `log_tier.rs`, `log_evict.rs`.
- **Fleet drain and readiness** — `drain.rs`.
- **Security fences** — `peer.rs` (identity charset, clock window, replay
  retention), `http.rs` (the authority/`request.url` gate), `cell.rs` (cell
  scope charset).

Each of these modules is deliberately "reified sans-IO" — the whole point is
that a pure predicate and its executor cannot diverge. The module doc comments
name the invariant each predicate defends; read those comments before editing
the function.

## Gate protocol changes behind the version

Peer traffic carries a protocol version. `PROTOCOL_VERSION` is defined once in
`crates/celld/peer_auth.rs` (line 16: currently `5`), and the tunnel
establishment carries the version (`crates/celld/main/peer_tunnel.rs`), so a
later protocol change "can negotiate instead of refuse"
(`docs/README.md` lines 544-545). Today the negotiation is a refusal: a peer
whose version differs is answered `UPGRADE_REQUIRED` (`crates/celld/peer_auth.rs`
lines 78-84).

The upgrade notes in `docs/README.md` (lines 514-545) record the two shapes a
breaking change takes:

- **An incompatible wire change** — e.g. the v0.4.0 move of every proxied cell
  call onto one tunneled connection. Because "the peer protocol refuses a
  different version", the two versions cannot proxy calls to each other and the
  upgrade must not be a rolling update.
- **An on-bucket data-format change** — e.g. v0.4.0 storing large KV values
  under an epoch-qualified reference, or v0.2.0 compacting replicated data into
  block objects. A mixed fleet can make committed data unavailable even when
  the wire protocol still works.

When you change the protocol, decide which of these shapes applies and update
the corresponding upgrade note. If a stored-object format changes, an older
reader must not run against it; if the wire changes, an older peer must not run
against the new node.

## Verify through the model and simulation layers

Before shipping a durability change, exercise it against every layer
(`docs/testing.md`):

- The TLA+ model pins the one-writer-per-epoch and no-acknowledged-write-lost
  invariants, and "most of the verdicts are failures" — a configuration that
  stops failing has lost its tooth.
- The deterministic simulator injects CAS races, lost responses, drift, and
  crash-at-any-await. Keep broken variants against the properties to prove the
  checker cannot fail silently.
- If the change affects cell lifecycle correctness (`Phase`, the queues, the
  gate), the simulation must remain replayable, because `crates/celld/lib.rs`
  gates the internal conformance suites behind `celld_internal_tests` and
  `include!`s the simulated world (lines 300-430).

# 2. Add a new Worker API surface

## Conformance is differential

celld's compatibility promise is enforced by differential execution against
workerd: "We run each Workers and Durable Objects program twice: once on
workerd ... and once on celld, on identical bytes. The two outputs must be
equal" (`docs/testing.md` lines 19-24). A test cannot agree with celld's own
runtime by accident."

## The three places a new API touches

1. **The JS harness.** `crates/celld/js/harness.js` holds the Workers surface,
   and `crates/celld/js.rs` has `install_harness`, `install_prelude`,
   `populate_cf_exports`, `register_class`, and `register_entrypoints`
   (`crates/celld/js.rs` lines 8824-8830). New globals and bindings are
   installed here. The harness reproduces workerd behaviors with matching
   messages so conformance cases pass (e.g. `crates/celld/js.rs` lines
   5663-5664 for the Worker Loader limits, mirroring workerd).
2. **The binding surface.** celld already supports Durable Objects, services,
   variables, assets, D1, KV, Queues, Workflows, and R2 bindings
   (`docs/cloudflare-compat.md` lines 200-202). New binding types add an entry
   in the `apply`/config path and a value in `env`.
3. **A reserved-cell class (for a value that must store state and have one
   writer).** D1, KV, Queues, cron, and Workflows each have a reserved class, a
   stable cell name, and an operator protocol:
   - `__D1Database` (`crates/celld/deploy.rs` line 64)
   - `__Workflow` (`crates/celld/deploy.rs` line 68)
   - `__KvNamespace` (`crates/logic/kv.rs` line 35)
   - `__Queue` (`crates/logic/queue.rs` line 19)
   - the cron `.cron` class (`crates/logic/cron.rs` line 33)

   The reserved classes are deliberately clustered: `RESERVED_CLASSES` in
   `crates/celld/deploy.rs` (line 81), because "adding a class to
   `RESERVED_CLASSES` now" has a naming-on-the-operator-protocol consequence
   (`crates/celld/deploy.rs` lines 152-153). Reserved cells are only reachable
   over the HMAC-authenticated `/runtime/<scope>` route, never `/do/<ID>`
   (`docs/security.md` lines 88-99).

## The deployment gate

`crates/celld/deploy.rs` is fundamentally a config allowlist: "anything we do
not model is refused, never silently dropped". A deployment that requires a
feature must declare it. `Manifest` in `crates/celld/protocol.rs` carries a
`required_features` list, and `SUPPORTED_DEPLOYMENT_FEATURES` (lines 54-64)
names what a build can load — the crash/policy gate exists so a build without
the reserved class "would load the manifest and then fail every `env.DB` call
at request time" (protocol.rs lines 68-71). If a new surface needs a feature
gate, register it here.

## Verify with fixtures

The corpus "only grows. When celld gets a new API surface, we add fixtures for
that surface, and the fixtures must give equal output on the two engines"
(`docs/testing.md` lines 27-32). Port workerd test suites for the new surface
and keep its boundary recorded in `docs/cloudflare-compat.md`, where the rule
is: "celld must reject an unsupported configuration or API at deployment or
first use. An unsupported feature that does not cause an error is a defect"
(`docs/cloudflare-compat.md` lines 11-13). If the new API is a silent stub (per
the Node.js compatibility picture), it must be identified in that page as a
known silent gap.

# 3. Tune a runtime knob

## Every knob is an environment variable validated up front

`crates/celld/env_vars.rs` validates every typed production variable before the
runtime starts ("a supplied variable must contain a valid value, so a typo
cannot silently change the configuration of a running node"). When you add or
retune a knob:

1. Add the read to `env_vars::validate()` so a malformed value fails at startup.
2. Give the default a single source. Read the default beside the enum/struct
   that consumes it (e.g. `command parse` in `crates/celld/env_vars.rs` and the
   defaults in `docs/README.md`'s table).
3. Document it in the environment-variables table and help text because the
   help output is "the public description of the configuration surface and
   remains stable across builds" (`crates/celld/main/cli.rs`).

Where the decision is behavioral (pressure, admission, retry, shedding), the
core reads no environment directly — it receives a `Config` built at the
boundary (`crates/logic/pressure.rs` lines 1-7, 35-40) so the simulator can
feed the same knobs. Keep the pure classifier pure and bubble the parsed value
in from `main.rs`.

## Tune within documented invariants

Some knobs carry a hard invariant you must not break casually:

- `CELLD_OUTPUT_GATE=0` removes the replication wait and "accepts possible loss
  of an acknowledged write" (`docs/README.md` line 690) — a deliberate
  durability downgrade, not a tuning error.
- `CELLD_MAX_RSS_MB=0` disables the pressure threshold and the absolute cap
  together.
- `CELLD_LTX_COMPACTION=0` must be set on every node of a mixed fleet until all
  nodes can read block objects, because an old reader cannot take over a cell
  after its first L1 publication.

Read the env table in `docs/README.md` before changing any default, and keep
the validate-then-consume discipline.

## Measure before tuning performance knobs

Runtime costs that were tuned with measurements (e.g. `DEFAULT_MAX_CELL_REQUESTS`
= 64 via Little's Law, `crates/celld/runtime.rs` lines 43-49; jemalloc over
glibc, `crates/celld/main.rs` lines 44-50) document why the default holds. When
retuning, keep the measurement with the number, because a number without its
conditions has no value (`docs/testing.md` line 160).

# 4. Operate a rolling upgrade

## Match the upgrade shape to the release notes

Upgrade notes live in `docs/README.md` lines 514-545. Not all releases
roll:

- **v0.1.0 → v0.2.0:** stop-all-then-start. New advertise + block-object
  compaction are both incompatible. The fleet must not mix the two versions.
- **v0.2.1 → v0.3.0:** a rolling update is allowed (a default durability
  change). A mixed fleet stays safe, but a v0.3.0 node cannot replicate to a
  v0.2.x peer.
- **v0.3.0 → v0.4.0:** stop-all-then-start. The peer protocol refuses a
  different version and the epoch-qualified KV reference is unreadable by
  v0.3.0.

When you introduce a version, record which shape it takes and keep the note
current.

## Use the drain token and the readiness gate

A draining node claims a fleet drain token in the bucket so simultaneous stop
signals hand off one node at a time (`docs/README.md` lines 470-477). The token
is advisory — a dead holder's claim expires and a handoff without it is still
safe — but it converts a flood into a serialized drain.

A fresh process holds its first healthy response until the fleet is settled
(`docs/README.md` lines 479-494): it needs a live lease, no active donor, memory
below every pressure low watermark, bounded restore backlog, and bounded
ownership skew. The public health endpoint (`/.well-known/celld/health`)
reports unhealthy during the drain (503), so a load balancer stops routing to
the node.

The label of the drain to use for a rolling update: "stop each node with
SIGTERM, wait for its replacement to report healthy, then move to the next
node. celld paces the cell handoffs inside each node shutdown, and the
first-readiness gate paces the update against fleet recovery"
(`docs/README.md` lines 508-512).

## Route through the correct upgrade exceptions

Set a longer orchestrator grace (systemd `TimeoutStopSec` /
`terminationGracePeriodSeconds`) than the process-stop bound, so SIGKILL cannot
arrive before the handoff completes (`docs/README.md` lines 438-443).

## Downgrades are not automatically symmetric

A downgrade can lose acknowledged writes even when the forward upgrade is a
safe rolling update. The v0.2.1→v0.3.0 note warns: do not start a v0.2.x binary
after that node runs v0.3.0 unless the shutdown log contains
`node-log close: sealed epoch` — a v0.2.x binary cannot read writes that wait in
the replicated log (`docs/README.md` lines 530-534). Treat downgrades as a
separate protocol decision from the upgrade.
