---
type: system
title: "Storage backends and credentials"
description: "The bucket adapter's dialects (S3/etag, GCS/generation, Azure/etag, local dev store), qualified vs broken services, and the credential chains per provider."
tags: [object-storage, s3, gcs, azure, credentials]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-927120ddf46d64238ba27c62
    resource: repo://crates/celld/local_store.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Storage backends and credentials

## The single client

`crates/celld/bucket.rs` is "The engine's single object-store client: the
`object_store` crate `celld-ltx` already links, bound to one bucket.
Replaces aws-sdk-s3. No call site streamed a body, so everything is
in-memory `Bytes`" (`bucket.rs:3-6`). The CAS token is an opaque
`String` "a read answers and a conditional write consumes"; callers never
see the provider difference (`bucket.rs:14-15`). The error contract is the
durability load-bearing part, restated on the ownership page: only clean
412/409 rejections are definite, every other error is ambiguous
(`bucket.rs:19-21`).

## Backend selection and dialects

`StorageBackend` has four variants with schemes `s3`, `gs`, `az`, `dev`
(`crates/celld/bucket.rs:70-89`); the dialect split is covered on the
ownership page (etag for s3/az/local; generation for gs). Per
[docs/guarantees.md](../docs/guarantees.md): an `az://` bucket's NAME is the
container, and Azure's Put Blob applies the same `If-` headers, so Azure
needs no third dialect (`bucket.rs:8-12`, `66-72`). GCS "ignores etags on
writes, so its tokens must come from the generation everywhere — reads,
heads, and put results" (`bucket.rs:66-69`).

## Qualified stores — per [docs/guarantees.md](../docs/guarantees.md), do not extend this list without evidence

- **Qualified**: Amazon S3, Cloudflare R2, Tigris, Google Cloud Storage,
  Azure Blob Storage. "celld's release tests run against R2, and the S3 path
  uses the same client and the same headers" (`docs/guarantees.md:26-29`).
- **Not implementable (rejected)**: Backblaze B2, Hetzner Object Storage,
  DigitalOcean Spaces — they do not implement required conditional writes;
  "celld is not correct on such a store" (`docs/guarantees.md:30-32`).
- **MinIO community**: implements the conditional writes and "passes the
  storage test, but celld has not qualified it for production"; one
  release (RELEASE.2025-09-06T17-38-46Z) answers conditional create of an
  absent object with `NoSuchKey`, so first deploy fails —
  "Use RELEASE.2025-09-07T16-13-09Z or later"
  (`docs/guarantees.md:36-44`).
- **Azure qualification detail**: "Azure was qualified on 2026-08-18 under
  an account key, a VM managed identity, and an AKS workload identity,
  single-node. A managed identity on Azure App Service or Azure Container
  Apps does not work" (`docs/guarantees.md:52-56`).
- Azure requires "exactly one credential family: a storage account key, a
  managed identity, or a workload identity", with the AKS workload identity
  requiring the four `AZURE_*` variables and the public-cloud authority
  host; the identity needs data-plane read/write/list/delete — the
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  `Storage Blob Data Contributor` role ([README](README.md)).
- S3-style: "celld uses the standard AWS credential chain. On Amazon EKS,
  celld reads the Pod Identity credentials from the injected environment
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  variables and the authorization-token file" ([README](README.md)).
- GCS: Application Default Credentials with the XML API
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  ([README](README.md)). celld rejects an S3 `--endpoint` for `gs://` or
  `az://` buckets and ignores the storage region there
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  ([README](README.md)).

## Development store

`crates/celld/local_store.rs` is "The persistent object store for `celld
dev`. The development supervisor and its node are separate processes, and
both write the fleet store during a reload. SQLite supplies the cross-process
transaction that a directory of files cannot: a conditional update checks
its ETag and installs the new object in one commit. This backend is local to
one development machine. It is not a shared-filesystem production mode"
(`local_store.rs:3-8`). It is selected only by the dev supervisor through
the internal `dev_store` setting — "No fleet flag or public environment
variable selects the local backend" (`crates/celld/main/cli.rs:10-12`, set
from `CELLD_INTERNAL_DEV_STORE`, `cli.rs:171-174`).

## Bucket as the fleet-root

Because the bucket stores deployments, cells, leases, wake entries, node
log, telemetry, and the peer secret ([docs/guarantees.md](../docs/guarantees.md)
reserved prefixes `cells/`, `nodes/`, `node-cells/`, `fleet/`, `deploy/`,
`deploy-blobs/`, `wake/`, `telemetry/`, `probe/`), credentials are
fleet-admin ([security page](security.md)). `ltx_repl.rs` builds **its own**
object-store clients with the fleet key prefix, separate from `bucket.rs`
(`crates/celld/ltx_repl.rs:10-13`), so two fleets sharing a bucket don't
cross-replicate.

## Uncertainty

- Which exact `object_store` crate versions implement S3 conditional puts is
  pinned in `Cargo.toml` (see the comment on `S3ConditionalPut`); behavior
  for other S3-compatible vendors follows the dialect, not vendor claims.
