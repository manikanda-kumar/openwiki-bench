---
type: integration
title: Object store integrations
description: The conditional-write dialects for S3/R2, Google Cloud Storage XML API, and Azure Blob Storage — credential chains, endpoint rules, and the startup storage probe.
tags: [object-store, s3, gcs, azure, credentials, conditional-writes]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-d271645e8d40f1fc2d0c8902
    resource: repo://crates/celld/dev.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Object store integrations

## The three dialects

One surface, `crates/celld/bucket.rs`, binds every provider into a single
bucket client used by the whole node. The module header states the dialect
split:

> Two conditional-write dialects share the surface. An `s3://` (or bare)
> spec speaks the S3 dialect: the CAS token is the etag, sent as
> If-Match / If-None-Match with SigV4 credentials. An `az://` spec speaks
> the same etag dialect on Azure Blob Storage: Put Blob honors both
> headers, so only the client and the credentials differ. A `gs://` spec
> speaks the Cloud Storage XML API dialect: the CAS token is the object
> generation, sent as x-goog-if-generation-match with OAuth credentials.
> The distinction is the dialect, not the endpoint — GCS accepts S3-style
> requests on the same host but does not apply `If-Match` to a PUT, so
> only the generation dialect can fence there.

(repo://crates/celld/bucket.rs#L8-L16)

The backend is `StorageBackend::{S3, Gcs, Azure, Local}` with scheme
strings `s3`, `gs`, `az`, and the local dev store
(repo://crates/celld/bucket.rs#L76-L88). Callers see only an opaque CAS
token: a read answers a token and a conditional write consumes it; the
GCS token is `x-goog-generation`, the S3/Azure/Local token `ETag`
(repo://crates/celld/bucket.rs#L100-L106). The precondition header matched
to each dialect is `If-Match / If-None-Match` or
`x-goog-if-generation-match`, and an error message names the dialect's
header — the docs note that a message naming only one header sends half
the fleet looking in the wrong place during a probe failure
(repo://crates/celld/bucket.rs#L126-L138).

A failed conditional create maps to clean `AlreadyExists` / `Precondition`
rejections; a failed conditional update can appear as either
`AlreadyExists` or `Precondition` depending on provider (`Precondition` on
Azure's failed `If-None-Match`), both treated as clean conditional-write
failures (repo://crates/celld/bucket.rs#L172-L179).

Callers never see the dialect; the CAS token abstraction is what keeps
the durability and fencing logic portable.

## Credential chains

Credentials come from the environment per provider:

- **S3**: standard AWS credential chain — `AWS_ACCESS_KEY_ID`/
  `AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` plus region; explicit
  credentials are for managed installs (`StaticCredentials`).
  `S3_ENDPOINT` selects an S3-compatible endpoint such as R2
  (repo://docs/README.md#L672-L672).
- **GCS** (`gs://`): Application Default Credentials via
  `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_SERVICE_ACCOUNT_KEY`
  (repo://docs/README.md#L673-L674).
- **Azure** (`az://`): exactly one credential family required — a storage
  account key (`AZURE_STORAGE_ACCOUNT_KEY` plus
  `AZURE_STORAGE_ACCOUNT_NAME`), a managed identity, or a workload
  identity (`AZURE_AUTHORITY_HOST`, `AZURE_CLIENT_ID`,
  `AZURE_TENANT_ID`, `AZURE_FEDERATED_TOKEN_FILE`, authority must be the
  public Azure cloud); mixing families is refused
  (repo://docs/README.md#L675-L677, repo://README.md#L161-L170).

## Which stores actually qualify

The guarantees page is explicit that conditional-write support is the
binding constraint, not API surface:

> The qualified stores are Amazon S3, Cloudflare R2, Tigris, Google Cloud
> Storage, and Azure Blob Storage. celld's release tests run against R2,
> and the S3 path uses the same client and the same headers.
>
> Backblaze B2, Hetzner Object Storage, and DigitalOcean Spaces do not
> implement the required conditional writes. celld is not correct on such
> a store: two nodes can then own one cell. A store can also accept the
> conditional headers and ignore the condition, and that store fails late
> and silently — so run the storage test.

(repo://docs/guarantees.md#L40-L49)

MinIO community edition implements the conditionals and passes the probe
but is not qualified for production, and one known release answers a
conditional create with `NoSuchKey` so the first deploy fails
(repo://docs/guarantees.md#L50-L58).

## The storage probe

Each node qualifies its store once at startup with four conditional writes
(below `probe/`), two of which must *fail*; a store that accepts both
cannot fence a cell so celld names the store as the fault and stops
(repo://docs/guarantees.md#L83-L89,
repo://crates/celld/bucket.rs#L1378-L1420). `CELLD_STORAGE_PROBE=0`
disables the startup test; `celld diagnose --read-only` skips the write
probe for a read-scoped credential (repo://docs/guarantees.md#L88-L88 for
the flag; the startup test repeat is also documented at repo://crates/
celld/machine.rs).

## Local dev store and prefix scoping

`celld dev` uses a local SQLite-backed object store instead of a cloud
bucket, selected automatically in dev mode and not selectable by a
production node or CLI (repo://docs/limitations.md#L6-L8). In production,
the bucket may carry a key prefix — `CELLD_BUCKET` accepts an optional
prefix after the bucket name, and `Bucket::prefix` is the one place that
knows where in the bucket a fleet lives (repo://crates/
celld/bucket.rs#L146-L152).

## Error contract for fencing

The `put_cas` error contract is load-bearing for the self-fence: a clean
412/409 rejection answers `Ok(None)`, while every other failure is
ambiguous (the write may have committed) and surfaces as `Err`, so the
caller reconciles instead of trusting a single-sided outcome
(repo://crates/celld/bucket.rs#L22-L27). Conditional-write clients are
also built with retries OFF, because a retried CAS put can land on the
first attempt's own token change and report a clean 412 — converting
"may have committed" into a false rejection
(repo://crates/celld/bucket.rs#L138-L145).

## Listing behavior

Listing is bounded: `Bucket` keeps both the standard store and a separate
paginated-listing trait handle, because `ObjectStore::list_with_delimiter`
would drain every continuation page into one buffer; the paginated
enumerator takes a page size and a resumption token, which is what bounds
a listing's cost rather than only its output
(repo://crates/celld/bucket.rs#L123-L141).
