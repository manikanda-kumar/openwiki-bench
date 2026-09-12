---
type: operations
title: Configuration and Environment Variables
description: The celld CLI surface, storage backends (S3/R2/GS/Azure), bucket prefixes and reserved space, the durability posture, and every CELLD_* environment knob.
tags: [operations, configuration, environment, cli, storage, bucket]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-c63c3ba65eb277d6c4a00723
    resource: repo://crates/celld/machine.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# Configuration and Environment Variables

`crates/celld/main/cli.rs` holds the command-line surface and its help text,
which is the public description of the configuration surface and stays stable
across builds (`crates/celld/main/cli.rs:7-8`). The `Action` enum
(`crates/celld/main/cli.rs:31-54`) distinguishes running a node from the
operator subcommands (`deploy`, `dev`, `cell`, `d1`, `kv`, `queue`, `connect`,
`credentials`, `token`, `disconnect`, `diagnose`, `help`, `version`). CLI and
environment values feed the same `Settings` (`crates/celld/main/cli.rs:9-29`).

## Storage backends and the conditional-write dialect

The node's one object-store client is `crates/celld/bucket.rs`. There are two
conditional-write dialects sharing the same surface (`crates/celld/bucket.rs:7-18`):

- **S3** (`s3://` or bare): the CAS token is the etag, sent as `If-Match` /
  `If-None-Match` with SigV4 credentials.
- **Azure Blob** (`az://`, the NAME is the container): the same etag dialect;
  Put Blob honors both headers, so only the client and the credentials differ.
- **GCS** (`gs://`): the Cloud Storage XML API dialect; the CAS token is the
  object generation, sent as `x-goog-if-generation-match` with OAuth
  credentials.

The distinction is the dialect, not the endpoint — GCS accepts S3-style requests
on the same host but does not apply `If-Match` to a PUT, so only the generation
dialect can fence there. Callers never see the difference: the token is an
opaque `String` a read answers and a conditional write consumes.

The error contract is what the self-fence relies on: `put_cas` answers
`Ok(None)` only for a clean 412/409 rejection; every other failure is ambiguous
(the write may have committed) and surfaces as `Err`; a response that carries no
CAS token is an error, never an empty token a later conditional write would
trust (`crates/celld/bucket.rs:20-24`). For GS and Azure, celld rejects an S3
`--endpoint` and ignores the storage region.

## Node credentials and bucket prefix

Standard AWS credential-chain environment variables (`AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) supply S3 credentials; on Amazon
EKS celld reads Pod Identity credentials from the injected environment and the
authorization-token file (`README.md:118-121`). Azure requires exactly one
credential family (storage account key, managed identity, or workload identity)
with `AZURE_STORAGE_ACCOUNT_NAME`. A `PREFIX` in the bucket spec puts every
object under it, so several fleets can share one bucket
(`crates/celld/main/cli.rs:288-296`).

celld reserves the `probe/`, `cells/`, `nodes/`, `node-cells/`, `fleet/`,
`deploy/`, `deploy-blobs/`, `wake/`, and `telemetry/` prefixes and deletes
objects under some of them, so an application must not write under any of these
prefixes (`docs/guarantees.md:78-81`). An R2 binding uses the fleet bucket under
the additional prefix `r2/<bucket_name>/` (`docs/cloudflare-compat.md:149`).

## CLI options for a node

The important node flags are `--bucket`, `--endpoint`, `--region`, `--listen`
(public Worker listener, default `127.0.0.1:8080`), `--internal-listen` (peer
and unauthenticated operator listener, default `127.0.0.1:0`), `--advertise`
(the address peers can reach, which requires an explicit `--internal-listen`),
`--unsafe-public-advertise`, and `--trust-forwarded-headers`
(`crates/celld/main/cli.rs:274-322`). celld refuses a literal public IP in
`--advertise` unless `--unsafe-public-advertise` is given.

`--listen` / `CELLD_ADDR` resolve the default listener address after command-line
mode flags; in `--control-plane` mode it selects the first free demo port,
otherwise it stays at the standalone default `127.0.0.1:8080`
(`crates/celld/main/cli.rs:223-229`). The CLI is strict: a non-loopback
`--listen` without an explicit `--internal-listen` is refused, and so is an
`--advertise` without one (`crates/celld/main/cli.rs:236-246`). An unknown
command or option stops startup rather than being guessed
(`crates/celld/main/cli.rs:218-220`).

## Durability posture: `CELLD_DURABILITY`

`CELLD_DURABILITY` selects the write-acknowledgement posture and defaults to
`fleet` (`crates/celld/main.rs:3721-3726`, `crates/celld/main/cli.rs:373-378`):

- `fleet` acks when every follower in the ensemble holds the write on disk, or
  when the bucket upload wins, and uploads to the bucket behind either way. It
  needs two or more nodes; a fleet of one node does not get it and every ack
  waits for the bucket, making writes much slower.
- `bucket` always waits for the bucket before acknowledging.

In a parse check `CELLD_DURABILITY` must be exactly `bucket` or `fleet` or
startup errors (`crates/celld/main.rs:3726`).

## Node lease lifetime: `CELLD_TTL_MS`

`CELLD_TTL_MS` sets the node lease lifetime and defaults to 10000 ms
(`crates/celld/machine.rs:53-55`). The node renews after one third of the
lifetime; the lease is how a peer evaluates whether the node is alive and how
the node proves authority to serve cells.

## Resource and tuning knobs

The full set is documented in the CLI help
(`crates/celld/main/cli.rs:348-383`) and validated by `crates/celld/env_vars.rs`.
The significant ones:

| variable | default | effect |
| --- | --- | --- |
| `CELLD_MAX_RESIDENT_CELLS` | none (unbounded) | Hard resident-cell cap enforced at admission |
| `CELLD_ACTIVATIONS` | available parallelism | Concurrent cold activations |
| `CELLD_EVICTIONS` | 4 | Concurrent evictions holding a durability proof |
| `CELLD_RELEASES` | default | Concurrent shutdown handoffs |
| `CELLD_MAX_RSS_MB` | 80% of memory | Active-memory shed threshold; `0` disables |
| `CELLD_V8_HEAP_LIMIT_MB` | 128 | Per-isolate V8 heap limit |
| `CELLD_STORAGE_PROBE` | on | `0` skips the startup conditional-write test |
| `CELLD_OPERATION_DEADLINE_MS` | 15000 | Non-restore operation deadline |
| `CELLD_IDLE_EVICT_S` | disabled unless set | Idle-cell eviction age |
| `CELLD_PRESSURE_OWNERSHIP` | `release` | `release` rebalances, `sticky` caches locally |
| `CELLD_OUTPUT_GATE` | on | `0` removes the durability wait from writes |
| `CELLD_TTL_MS` | 10000 | Node lease lifetime |

Parsing is strict: a boolean accepts only `0`/`1`, a positive variable must be
greater than zero, and every typed production variable is validated before the
runtime starts so a typo cannot silently change the configuration of a running
node (`crates/celld/env_vars.rs:3-8`). The environment also feeds the CLI
surface directly — e.g. `CELLD_BUCKET`, `CELLD_ADDR`, `CELLD_INTERNAL_ADDR`,
`CELLD_ADVERTISE`, and the deployment-related `CELLD_WATCH`, `CELLD_ESBUILD`,
`CELLD_VARS_FILE`, and `CELLD_ASSET_CACHE_DIR` (`crates/celld/main/cli.rs:324-346`).

## Discovery vs the operator subcommands

Subcommands share the flag and dialect machinery. `cell`, `d1`, `kv`, and
`queue` all target a fleet bucket and locate the owning node through the node
leases (`README.md:202-257`). `celld dev` starts one node against a local object
store and keeps its durable state in `.celld/dev`
(`README.md:90-111`). These are covered in more depth on the
[operating a fleet](../operations/fleet.md) page.

## Uncertainty note

The exact default for `CELLD_RELEASES` and the helper constant
`DEFAULT_MAX_CONCURRENT_RELEASES`'s value are not stated on this page because
they are established in `crates/celld/main.rs:3280` and the module constant
respectively; the operator-facing number is the help-text default of
`CELLD_EVICTIONS` (4). Where the CLI help names a default, treat the help text
as authoritative; the actual read is confirmed by the code cited.
