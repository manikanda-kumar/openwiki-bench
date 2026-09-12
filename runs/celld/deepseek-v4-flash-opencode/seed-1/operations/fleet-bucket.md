---
type: operations
title: The fleet bucket and object storage
description: The object-store adapter behind every fleet, the three conditional-write dialects (S3, Google Cloud Storage, Azure Blob Storage), the reserved key prefixes, the startup storage probe, provider qualification, and credential handling.
tags: [object-storage, s3, gcs, azure, bucket]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-927120ddf46d64238ba27c62
    resource: repo://crates/celld/local_store.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# The fleet bucket and object storage

The fleet bucket is the root of authority for a fleet: it holds the
deployments, the cell state, the ownership records, the node leases, and the
peer-authentication secret. The engine's single object-store client is
`Bucket` (`crates/celld/bucket.rs`), one bucket optionally scoped to a key
prefix.

## The Bucket type

`Bucket` (`crates/celld/bucket.rs:140-167`) is cheap to clone and holds: the
`Arc<dyn ObjectStore>` for ordinary traffic, a separate `PaginatedListStore`
so a listing can be bounded by page size and a resumption token rather than
paying for every page, a dedicated `cas_store` for conditional writes, the
`StorageBackend`, the bucket name, and a slash-terminated key prefix. Every
`Bucket::open` builds its own HTTP transport, so a dedicated instance also
isolates its traffic — the node-lease client is built on its own connection
pool so lease traffic never queues behind ownership, deployment, or replica
requests (`lease_bucket_client_with_credentials`, `crates/celld/fleet.rs:118-131`).

The `cas_store` is built with retries **off**, deliberately
(`crates/celld/bucket.rs:155-159`): a retried conditional write can land on
the first attempt's own token change and report a clean 412, converting "may
have committed" into a false rejection. The ambiguity must surface as `Err` so
the caller reconciles.

## Bucket spec and key prefix

`split_spec` (`crates/celld/bucket.rs:190-214`) splits a
`[s3://|gs://|az://]NAME[/PREFIX]` value into the backend, the bucket name, and
a normalized key prefix (empty, or slash-terminated). A spec without a scheme
stays S3-compatible, and a spec without a PREFIX keeps every key at the bucket
root, so a fleet provisioned before either existed never moves its objects. On
`az://` the NAME is the container and the storage account comes from
`AZURE_STORAGE_ACCOUNT_NAME`. Every object of a fleet goes below its prefix,
so two fleets can share one bucket.

## Conditional-write dialects

The conditional-write surface is one API with two dialects
(`crates/celld/bucket.rs:67-137`):

- **S3 and Azure Blob Storage** — the CAS token is the etag, sent as
  `If-Match` / `If-None-Match`. Azure Put Blob honors both headers, so only
  the client and credentials differ.
- **Google Cloud Storage** — the CAS token is the object generation, sent as
  `x-goog-if-generation-match` with OAuth credentials. GCS accepts S3-style
  requests on the same host but does not apply `If-Match` to a PUT, so only
  the generation dialect can fence there.

`is_clean_cas_rejection` (`crates/celld/bucket.rs:178-188`) treats a
`Precondition` (HTTP 412 on Azure) or `AlreadyExists` as a clean
conditional-write rejection and keeps every other error ambiguous, because an
ambiguous write can have changed the object.

## What the store must provide

celld needs three properties from the object store: a conditional create, a
conditional overwrite, and read-after-write consistency (`docs/guarantees.md`).
The qualified stores are Amazon S3, Cloudflare R2, Tigris, Google Cloud
Storage, and Azure Blob Storage; Backblaze B2, Hetzner Object Storage, and
DigitalOcean Spaces do not implement the required conditional writes, and
celld is not correct on such a store — two nodes can then own one cell. MinIO
(community edition) passes the storage test but is not qualified for
production; one release (`RELEASE.2025-09-06T17-38-46Z`) rejects the
conditional create of an absent object with `NoSuchKey`.

Because no store publishes these properties, `celld diagnose` sends four
conditional writes to the bucket — two must fail — and every node repeats the
test once at startup (`probe_storage_before_serving`, `crates/celld/fleet.rs:281-305`);
a node that finds a broken store stops. `CELLD_STORAGE_PROBE=0` disables the
startup test, and `celld diagnose --read-only` runs with a credential that
cannot write. The probe writes and deletes a small object under `probe/`.

## Reserved key prefixes

celld reserves `probe/`, `cells/`, `nodes/`, `node-cells/`, `fleet/`,
`deploy/`, `deploy-blobs/`, `wake/`, and `telemetry/`, deletes objects under
some of them, and an application must not write under any of them
(`docs/guarantees.md:76-81`). The ownership records live at `cells/<cell>/own.json`
and the node leases at `nodes/<node>.json` (`crates/celld/ownership_store.rs`),
the replicated cell state under `cells/<cell>/ltx/e<epoch>/`
(`crates/celld/ltx_repl.rs`), deployments under `deploy/` (`crates/celld/fleet.rs`,
`protocol.rs`), alarm wake entries under `wake/` (`crates/celld/wake.rs`), and
Parquet telemetry under `telemetry/` (`crates/celld/telemetry.rs:31-33`).

## Credentials

- **S3-compatible** buckets use the standard AWS credential chain, including
  the Pod Identity credentials on Amazon EKS. An explicit `--endpoint` selects
  another S3-compatible service and `--region` when it cannot be inferred.
- **`gs://`** buckets use Application Default Credentials. celld rejects an S3
  `--endpoint` for a `gs://` bucket and ignores the storage region.
- **`az://`** buckets require exactly one credential family — a storage
  account key, a managed identity, or the standard AKS workload identity — and
  the authority host must identify the public Azure cloud. celld rejects each
  recognized `AZURE_*` configuration variable outside these families, and an
  identity must hold the Blob data-plane permission to read, write, list, and
  delete blobs. `AZURE_STORAGE_USE_EMULATOR=true` selects Azurite for local
  development; Azurite is a development store, so celld does not qualify it
  for a fleet.

The bucket credentials give full control of the fleet, so they are the primary
secret to protect (`docs/security.md`). A credential should have access to one
fleet bucket only.

## The local development store

`celld dev` uses a persistent local object store instead of a cloud bucket
(`crates/celld/local_store.rs:1-10`). The development supervisor and its node
are separate processes that both write the store during a reload, so the
backend is a SQLite database: a conditional update checks its ETag and installs
the new object in one commit, which a directory of files cannot do. The backend
is local to one development machine and is not a shared-filesystem production
mode; a regular node or an operator subcommand cannot select it.

## Related pages

- [Durability, fencing, and the output gate](../architecture/durability-protocol.md) — the conditional-write protocol this storage enables.
- [SQLite replication and the LTX log tier](../architecture/replication.md) — the object layout under `cells/<cell>/ltx/`.
- [Deployments and in-place code adoption](../architecture/deployments.md) — the deployment objects under `deploy/`.
- [Security and networking boundaries](security.md) — protecting the bucket and its credentials.
