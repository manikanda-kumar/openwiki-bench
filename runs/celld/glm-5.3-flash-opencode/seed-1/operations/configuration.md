---
type: operations
title: Configuration
description: How celld parses and validates its environment variables — strict parsing with no silent typos, validated before startup, boolean/positive/optional classes, and the table of primary operational knobs.
tags: [configuration, environment-variables, validation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Configuration

## Strict parsing

`crates/celld/env_vars.rs` implements "strict runtime environment parsing":

- An unset variable selects its caller's documented default.
- A **supplied** variable must contain a valid value, "so a typo cannot
  silently change the configuration of a running node"
  [crates/celld/env_vars.rs](repo://crates/celld/env_vars.rs#L3-L8).

The docs agree: "An unset variable selects its documented default. A
Boolean variable accepts only `0` or `1`. celld exits during startup when a
supplied value is invalid" [docs/README.md](repo://docs/README.md#L706-L708).

## Validation before runtime start

`env_vars::validate()` walks every typed production variable **before** the
runtime starts. The reason some consumers cannot fail at the point of use:
"some consumers cache a value or read it from a synchronous callback, so
they cannot return a configuration error at the point of use. This pass
makes those reads infallible without giving malformed values a default"
[crates/celld/env_vars.rs](repo://crates/celld/env_vars.rs#L15-L25).

Variables fall into typed classes:

- **Flags** (boolean `0`/`1`): `CELLD_CLOUD`,
  `CELLD_CLOUD_RESTART_ON_DEPLOY`, `CELLD_LTX_COMPACTION`,
  `CELLD_OUTPUT_GATE`, `CELLD_PRESENCE_SHADOW`,
  `CELLD_TRUST_FORWARDED_HEADERS`, `CELLD_UNSAFE_PUBLIC_ADVERTISE`
  [crates/celld/env_vars.rs](repo://crates/celld/env_vars.rs#L26-L34).
- **Required-positive integers** (default in caller when unset):
  `CELLD_ACTIVATIONS`, `CELLD_DEPLOY_POLL_S`, `CELLD_IDLE_EVICT_S`,
  `CELLD_LOG_CAPTURE_WORKERS`, `CELLD_LOG_PIPELINE`,
  `CELLD_LTX_COMPACTION*`, `CELLD_LTX_DURABILITY_TIMEOUT_SECS`,
  `CELLD_MAX_LOADED_WORKERS`, `CELLD_MAX_CELL_REQUESTS`,
  `CELLD_MAX_REQUEST_BODY_BYTES`, `CELLD_OPERATION_DEADLINE_MS`,
  `CELLD_RELEASES`, `CELLD_SHUTDOWN_*`, `CELLD_TTL_MS`, and more
  [crates/celld/env_vars.rs](repo://crates/celld/env_vars.rs#L36-L60).
- **Optional integers** (defaulting when unset and validated if present):
  `CELLD_MAX_RESIDENT_CELLS`, `CELLD_MAX_RSS_MB`,
  `CELLD_READY_FLEET_GATE_MS`, `CELLD_DRAIN_TOKEN_WAIT_MS`,
  `CELLD_DEPLOY_MAX_AGE_S`, `CELLD_LTX_TRUNCATE_PAGES`,
  `CELLD_LOG_HEDGE_MS`, and more
  [crates/celld/env_vars.rs](repo://crates/celld/env_vars.rs#L62-L76).
- **Range-constrained**: `CELLD_PRESENCE_HEARTBEAT_MS` must be between 50
  and 30000; `CELLD_V8_HEAP_LIMIT_MB` must be a positive, representable
  megabyte count [crates/celld/env_vars.rs](repo://crates/celld/env_vars.rs#L78-L88).
- **Enumerated**: `CELLD_LOG_TRANSPORT` must be `"http"` or `"stream"`
  [crates/celld/env_vars.rs](repo://crates/celld/env_vars.rs#L90-L94).

## The bucket and listeners

Storage and listener configuration are CLI options with environment
equivalents [docs/README.md](repo://docs/README.md#L663-L679):

- `CELLD_BUCKET` (=`--bucket`) with optional key prefix;
  `S3_ENDPOINT`, `AWS_REGION`/`AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` for an S3-compatible
  bucket; `GOOGLE_APPLICATION_CREDENTIALS` for a `gs://` bucket;
  `AZURE_STORAGE_ACCOUNT_NAME` + exactly one Azure credential family for
  an `az://` bucket.
- `CELLD_ADDR` (=`--listen`), `CELLD_INTERNAL_ADDR`
  (=`--internal-listen`), `CELLD_ADVERTISE` (=`--advertise`).
- `CELLD_UNSAFE_PUBLIC_ADVERTISE=1` permits a literal public IP in
  `CELLD_ADVERTISE`, without resolving DNS names or restricting the
  internal listener.
- `CELLD_NODE` for an explicit node-session ID, `CELLD_WATCH` for the
  local work directory, `CELLD_ESBUILD` for the esbuild binary path.

The provider credential-family rules (three Azure families, one at a time;
no `S3_ENDPOINT` or AWS credentials for `gs://` or `az://`; region
ignored) are covered on the
[bucket contract page](/openwiki/data/bucket-contract.md).

## Primary operational knobs

Table from the docs (defaults included) — this is the change-relevant
subset; `celld -h` shows the complete list
[docs/README.md](repo://docs/README.md#L658-L704):

| Variable | Default | Purpose |
| --- | --- | --- |
| `CELLD_ACTIVATIONS` | CPU count or 128, smaller | Concurrent cold-cell activations |
| `CELLD_DEPLOY_POLL_S` | 30 | Interval reading the deployment pointer |
| `CELLD_DEPLOY_MAX_AGE_S` | 60 | How long a resident DO keeps old code after adoption (0 forces immediately) |
| `CELLD_OPERATION_DEADLINE_MS` | 15000 | Deadline for non-restore operations |
| `CELLD_MAX_LOADED_WORKERS` | 256 | Concurrent loaded workers |
| `CELLD_MAX_CELL_REQUESTS` | 64 | Concurrent fetch limit per DO or queue broker |
| `CELLD_MAX_REQUEST_BODY_BYTES` | 1 GiB | Body limit for public and direct DO requests |
| `CELLD_MAX_RESIDENT_CELLS` | unset | Hard resident-cell limit at admission |
| `CELLD_MAX_RSS_MB` | 80% of available memory; 0 disables | Pressure-shedding threshold (and absolute cap) |
| `CELLD_OUTPUT_GATE` | 1 | Prove each write durable before acknowledging |
| `CELLD_DURABILITY` | `fleet` | Where to prove writes durable (`fleet` or `bucket`) |
| `CELLD_LOG_CAPTURE_WORKERS` | 8 | Concurrent log-capture workers |
| `CELLD_LOG_PIPELINE` | 4 | Fleet log rounds in flight |
| `CELLD_LOG_HEDGE_MS` | adaptive | Wait before a leader re-sends a slow append (0 disables) |
| `CELLD_LTX_TRUNCATE_PAGES` | 128 | WAL truncation size at checkpoint (0 disables) |
| `CELLD_LTX_COMPACTION` | 1 | Additive L1 compaction on |
| `CELLD_LTX_COMPACTION_MIN_TXIDS` | 256 | Durable TXID distance per background L1 attempt |
| `CELLD_LTX_COMPACTIONS` | 2 | Concurrent background L1 attempts node-wide |
| `CELLD_LTX_DURABILITY_TIMEOUT_SECS` | 10 | Durability-proof and final snapshot retry deadline |
| `CELLD_VAR_*` / `CELLD_VARS_FILE` | – | Worker variable overrides |
| `RUST_LOG` | – | Runtime log filter |

## Interacting variables

Two documented interactions are worth flagging as debugging knobs:

- `CELLD_MAX_RSS_MB` is a share of available memory; the absolute cgroup
  cap is a share at 95%, so "a `CELLD_MAX_RSS_MB` value at or above 95%
  makes the cap the effective limit, and celld reports the decision at
  startup"; `CELLD_MAX_RSS_MB=0` disables **both** the threshold and the
  cap; when celld cannot read available memory it applies a cap of 125% of
  an explicit threshold
  [docs/README.md](repo://docs/README.md#L277-L287).
- The deploy-pressure knobs `CELLD_ACTIVATIONS` and
  `CELLD_RELEASES` interplay during a rolling restart: "wait for every
  node to report `restoring=0` before you restart the next node, so one
  restart's cold work finishes before the next restart removes more warm
  capacity" [docs/README.md](repo://docs/README.md#L573-L577).

The V8 heap limit `CELLD_V8_HEAP_LIMIT_MB` (default 128 MB, matching
Durable Objects on Cloudflare) is a **per-isolate** limit distinct from
node memory, governs hibernatable WebSocket client capacity, and also
stops SQL result-set materialization above the limit; celld re-serves an
isolate when its use falls under 75% of the limit
[docs/README.md](repo://docs/README.md#L297-L311).
