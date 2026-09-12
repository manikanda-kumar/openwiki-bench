---
type: storage
title: Object Store Adapter
description: The single bucket client that backs every fleet — the S3, Google Cloud Storage, and Azure Blob conditional-write dialects and credentials, the reserved key prefixes and object layout, and the SQLite-backed local development store.
tags: [object-store, bucket, s3, gcs, azure, local-store]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-927120ddf46d64238ba27c62
    resource: repo://crates/celld/local_store.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-d623ebf5ac6a6289a978bd78
    resource: repo://crates/ltx/src/client/object_store.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Object Store Adapter

The fleet's long-term state lives in one object store. celld uses a
single bucket client — the `object_store` crate that `celld-ltx` already
links, bound to one bucket — which replaced aws-sdk-s3. No call site
streamed a body, so everything is in-memory `Bytes`
(crates/celld/bucket.rs#L3-L6).

## The conditional-write dialects

The store must provide conditional writes and read-after-write
consistency, because the ownership records depend on them. Three
conditional-write dialects share one surface (crates/celld/bucket.rs#L7-L18):

- An `s3://` (or bare) spec speaks the **S3 dialect**: the CAS token is
  the etag, sent as `If-Match`/`If-None-Match` with SigV4 credentials.
- An `az://` spec speaks the same etag dialect on Azure Blob Storage:
  Put Blob honors both headers, so only the client and the credentials
  differ.
- A `gs://` spec speaks the **Cloud Storage XML API dialect**: the CAS
  token is the object generation, sent as `x-goog-if-generation-match`
  with OAuth credentials. The distinction is the dialect, not the
  endpoint — GCS accepts S3-style requests on the same host but does not
  apply `If-Match` to a PUT, so only the generation dialect can fence
  there.

Callers never see the difference: the token is an opaque `String` a read
answers and a conditional write consumes.

The error contract is relied on by the self-fence: `put_cas` answers
`Ok(None)` only for a clean 412/409 rejection, and every other failure is
ambiguous — the write may have committed — and surfaces as `Err`. In the
same spirit, a response that carries no CAS token is an error, never an
empty token a later conditional write would trust
(crates/celld/bucket.rs#L20-L24).

## Credentials

- **S3-compatible** buckets use the standard AWS credential chain; on
  Amazon EKS, celld reads the Pod Identity credentials from the injected
  environment variables and the authorization-token file
  (README.md#L118-L120).
- **Google Cloud Storage** uses Application Default Credentials. A `gs://`
  bucket takes no `S3_ENDPOINT` and no `AWS_*` credentials, and celld
  ignores the storage region (docs/README.md#L151-L156).
- **Azure Blob Storage** requires exactly one credential family — a
  storage account key, a managed identity, or a workload identity — and
  the authority host must identify the public Azure cloud. celld rejects
  each recognized Azure configuration variable outside these families and
  ignores an `AZURE_*` name that `object_store` 0.12 does not recognize.
  For local development against Azurite, set
  `AZURE_STORAGE_USE_EMULATOR=true`; Azurite is a development store, so
  celld does not qualify it for a fleet (docs/README.md#L162-L199).

The bucket credentials give full control of the fleet — the bucket holds
the deployments, the SQLite replicas, the ownership records, the node
leases, and the peer-authentication secret — so keep them safe
(docs/README.md#L201-L203).

## Key layout and reserved prefixes

A bucket value can add a key prefix (`s3://BUCKET/PREFIX`), placing every
fleet object below `PREFIX/` so two fleets can share one bucket
(docs/README.md#L205-L208). The celld-owned key layout includes:

- `cells/<cell>/own.json` — the per-cell ownership record
  (crates/celld/ownership_store.rs#L289).
- `cells/<cell>/ltx/e<epoch>/` — each cell's replicated LTX segments,
  mirroring the local `<watch>/<cell>/ltx/e<epoch>/db.sqlite` tree
  (crates/celld/ltx_repl.rs#L11-L15, crates/celld/ltx_repl.rs#L1190).
- `nodes/<node>.json` — node leases
  (crates/celld/ownership_store.rs#L350).
- `fleet/peer-auth.json` — the shared peer-authentication secret
  (crates/celld/peer_auth.rs#L20).
- `deploy/current.json` and `deploy/<script>/<version>/...` — the
  deployment pointer and manifests (crates/celld/fleet.rs#L628).
- `deploy-blobs/assets/sha256/...` — content-addressed asset bodies
  (crates/celld/protocol.rs#L386-L399).
- `kv/blobs-v2/<cell>/e<epoch>/<digest>` — large KV values
  (crates/logic/kv.rs#L177-L184).
- `r2/<bucket_name>/` — R2 binding blobs (crates/celld/js/r2_ops.rs#L3-L8).
- `wake/<YYYY-MM-DDTHH:MM>/<cell>` — the alarm wake index
  (crates/logic/wake.rs#L30-L39).
- `telemetry/traces` and `telemetry/logs` — Parquet telemetry
  (crates/celld/telemetry.rs#L31-L33).
- `drain/token.json` — the fleet drain token
  (crates/celld/drain_token.rs#L20).

celld reserves `probe/`, `cells/`, `nodes/`, `node-cells/`, `fleet/`,
`deploy/`, `deploy-blobs/`, `wake/`, and `telemetry/`, and it deletes
objects under some of them, so an application must not write under any of
these prefixes (docs/guarantees.md#L78-L81). The storage probe writes and
deletes one small object under `probe/`.

## The LTX object-store client

The replication client maps the five `ReplicaClient` operations onto
`object_store::ObjectStore`, keeping the behavioral invariants from the
upstream Litestream conformance suite: the key scheme
`{path}/{level:04x}/{min}-{max}.ltx`, the 5 MiB single-PUT versus
multipart threshold, list with seek-skip on `min_txid`, the `NoSuchKey`
error mapping, and batch DELETE up to 1000 keys per call
(crates/ltx/src/client/object_store.rs#L3-L19).

## The local development store

`celld dev` uses a persistent local object store backed by SQLite. The
development supervisor and its node are separate processes, and both
write the fleet store during a reload; SQLite supplies the cross-process
transaction that a directory of files cannot — a conditional update
checks its ETag and installs the new object in one commit. This backend
is local to one development machine; it is not a shared-filesystem
production mode, and no fleet flag selects it
(crates/celld/local_store.rs#L3-L9, docs/README.md#L320-L327).

## Storage qualification

Amazon S3, Cloudflare R2, Google Cloud Storage, Tigris, and Azure Blob
Storage qualify for a fleet. Backblaze B2, Hetzner, and DigitalOcean
Spaces do not implement the required conditional writes. MinIO (community
edition) passes the storage test but celld has not qualified it for
production, and one release (RELEASE.2025-09-06T17-38-46Z) rejects the
conditional create the first deploy sends (docs/README.md#L210-L218,
docs/guarantees.md#L16-L42).
