---
type: "Reference"
title: "Change guides for common maintenance tasks"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-2ea4abd833d1e17f4ec74f58
    resource: repo://crates/celld/js/harness.js
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-d2d7d8ace8d959adef6686ac
    resource: repo://crates/logic/kv.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---


# Change guides for common maintenance tasks

These guides point at the exact files and seams to touch. They assume the
`celld-logic` boundary from the [architecture](architecture.md) page: all
behavioral decisions live in `crates/logic`, and `crates/celld` only
executes effects. When in doubt, follow the crate contract stated in
`Cargo.toml` (Cargo.toml#L1-L2).

## Add a new environment variable

Environment parsing is strict by design: "an unset variable selects its
caller's documented default. A supplied variable must contain a valid value,
so a typo cannot silently change the configuration of a running node"
(crates/celld/env_vars.rs#L3-L7).

1. Choose the parser in `crates/celld/env_vars.rs`:
   - `flag(name, default)` for a Boolean that accepts only `0` or `1`
     (crates/celld/env_vars.rs#L110-L122).
   - `positive::<u64>` for a value that must be greater than zero
     (crates/celld/env_vars.rs#L154-L174), or `optional::<u64>` when zero is
     meaningful.
   - `value(name)` for a string, or `with_default` for a string with a
     documented default.
2. Add the variable to the matching list in `validate()`
   (crates/celld/env_vars.rs#L16-L99) so the process refuses a malformed
   value at startup, before any consumer caches it. Some consumers read a
   value from a synchronous callback and cannot return an error at the point
   of use; the validation pass exists exactly for them.
3. Read the value where the decision is made. Prefer the core: if the
   variable changes a behavioral decision, pass it through
   `celld_logic::Config` (crates/logic/types.rs#L62-L136) or a pure
   classifier such as `PressureConfig::from_limits`
   (crates/logic/pressure.rs#L133-L177). Keep the shell mechanical and the
   core replayable.
4. Document it in `docs/README.md`'s environment table and in the
   `celld --help` output (the help text is the public description of the
   configuration surface; crates/celld/main/cli.rs#L3-L8).
5. Add a focused test that supplies both a valid and an invalid value; a
   Boolean accepts only `0` or `1` and `env_vars::parse_flag` rejects
   anything else.

## Add a new Workers API binding

A binding flows: Wrangler config key → deploy allowlist → deployment
`Manifest`/feature gate → generation build → Worker `env`.

1. **Config key**: add the key to `SUPPORTED_KEYS` in
   `crates/celld/deploy.rs` (crates/celld/deploy.rs#L36-L56). Anything not
   modeled is refused, never silently dropped — "refusing is compat-safe,
   guessing produces confusing activation failures later".
2. **Deployment object**: extend the `Manifest` in `crates/celld/protocol.rs`
   (crates/celld/protocol.rs#L14-L44) and define any new durable object types
   there. Add a `FEATURE_*_V1` constant and include it in
   `SUPPORTED_DEPLOYMENT_FEATURES`
   (crates/celld/protocol.rs#L54-L99). The feature gate exists to move a
   failure from request time to deploy time: a node that cannot load a
   feature must refuse the manifest up front rather than fail on first use.
3. **Runtime binding**: the isolate-side binding surface is built in
   `crates/celld/js.rs` (the `WorkerConfig` bindings lists start at
   crates/celld/js.rs#L1747-L1778) and the JS adapter in
   `crates/celld/js/harness.js` (for example, the R2 binding is implemented
   as `globalThis.__makeR2Bucket`, harness.js#L1001). Add the binding shape
   to `WorkerConfig`, construct it in the generation build
   (`crates/celld/generation.rs`), and implement the JS surface in the
   harness. Keep the key-size and limit checks in the shared harness or in
   the pure logic crate, not duplicated in both — the KV bounds deliberately
   ship as data that the harness compares against
   (crates/logic/kv.rs#L9-L17).
4. **Reserved cell** (for a stateful service such as D1, KV, Queues, or
   Workflows): register a reserved class and cell scope. The existing
   reserved classes are `__D1Database`, `__Workflow`, `__KvNamespace`, and
   `__Queue` (crates/celld/deploy.rs#L58-L81); `celld cell list` marks cells
   in these classes `"reserved": true`.
5. **Compatibility surface**: add the API to
   `docs/cloudflare-compat.md` with a **Yes/Partial/No** status and note the
   gaps. celld must reject an unsupported configuration or API at deployment
   or first use — an unsupported feature that does not cause an error is a
   defect (docs/cloudflare-compat.md#L11-L13).
6. **Feature test**: add a fixture to the differential conformance corpus
   (docs/testing.md#L17-L33), which must give equal output on workerd and
   celld.

## Modify the coordination protocol

The coordination protocol lives in the decision core, and the rules for
changing it are the same rules that keep it testable:

1. **Change the vocabulary first**: add the new input to `Event`, the new
   output to `Effect`, and any new record shapes to `crates/logic/types.rs`
   (types.rs#L401-L920). `Event` is the only way in and `Effect` the only
   way out, and "no decision is made in this file — that is `State` in the
   crate root" (crates/logic/types.rs#L3-L8).
2. **Add the transition in `on_event`** (`crates/logic/lib.rs`): update the
   `Phase` machine (crates/logic/lib.rs#L113-L190) and the per-cell `Cell`
   struct (crates/logic/lib.rs#L304-L358). Every phase has a stable reported
   name in `phase_name` that `/state` and `celld diagnose` publish
   (crates/logic/lib.rs#L212-L240) — keep it stable across internal renames.
3. **Implement the effect in an adapter**: the ownership effects are
   executed by `crates/celld/ownership_store.rs`, which deliberately contains
   "serialization, wall-clock sampling, SDK configuration and error
   classification only" (crates/celld/ownership_store.rs#L3-L7). If the
   change touches write acknowledgement, respect the error contract:
   `put_cas` answers `Ok(None)` only for a clean 412/409 rejection and every
   other failure is ambiguous (crates/celld/bucket.rs#L20-L24).
4. **Version the effect**: every asynchronous effect is versioned, and
   completion events with an obsolete `op` are ignored
   (crates/logic/types.rs#L737-L744). New effects must follow that contract
   or late completions will corrupt state.
5. **Update the verification companions**:
   - the TLA+ specifications are a hand-synced snapshot that deliberately
     does not run in CI; updates land in the same changes that move the
     protocol, and a delta ledger records what the model does not yet
     describe (docs/testing.md#L73-L79);
   - run the deterministic simulation: a seeded scheduler drives each run, so
     a failure replays exactly, and properties must survive tens of thousands
     of seeds (docs/testing.md#L96-L103);
   - test the checkers with deliberately broken variants — a suite that stays
     green against a broken protocol is a broken suite (docs/testing.md#L105-L108).
6. **Record upgrade constraints**: if the change affects the peer protocol
   or the replicated object layout, document whether the upgrade is a
   rolling update or a full stop/start in the upgrade notes in
   `docs/README.md` (docs/README.md#L514-L544). The v0.1→v0.2, v0.2.1→v0.3,
   and v0.3→v0.4 transitions each had distinct constraints.

## Update the compatibility surface

1. **Runtime API gap**: implement the surface in `crates/celld/js.rs` and
   its harness modules, then update the `docs/cloudflare-compat.md` runtime
   API table with the status. A stub is a known silent gap and must be
   documented as such (docs/cloudflare-compat.md#L279-L303).
2. **Compatibility flag**: flags are honored through the `Compat` struct
   built from the manifest metadata (`worker_compat` in
   `crates/celld/lib.rs#L483-L522`). Add the flag to that switch logic; the
   `compatibility_date` gate is `switch(enable, disable, since)`.
   `Cloudflare.compatibilityFlags` reports only the flags celld honors
   (docs/cloudflare-compat.md#L305-L317).
3. **Wrangler config**: add the key to `SUPPORTED_KEYS` and the deployment
   path in `crates/celld/deploy.rs`, then add it to the accepted-key list in
   `docs/cloudflare-compat.md` (docs/cloudflare-compat.md#L321-L334). An
   unknown top-level key stops the deployment.
4. **Node.js compat module**: the implemented `node:` modules live under
   `crates/celld/js/` (node_assert.js, node_buffer.js, node_crypto.js,
   node_zlib.js, and so on). Each other Node.js module returns an inert stub,
   and that behavior is a known silent gap documented in the compat page
   (docs/cloudflare-compat.md#L279-L291).

## Verification

After any of these changes, run the crate's test suite. The test gate is the
`celld_internal_tests` cfg, which switches in the simulated asyncrt and the
conformance suites (crates/celld/lib.rs#L300-L320); a change that breaks a
deterministic invariant should surface there before a live-fleet run.
