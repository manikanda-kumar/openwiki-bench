---
type: concept
title: "Object storage: bucket providers, credentials, and conditional writes"
description: The single object-store client, the three conditional-write dialects (S3/Azure etag, GCS generation), provider credentials, reserved bucket prefixes, the storage qualification test, and fleet key prefixes.
tags: [object-storage, s3, gcs, azure, conditional-writes, credentials]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-d271645e8d40f1fc2d0c8902
    resource: repo://crates/celld/dev.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# Object storage: bucket providers, credentials, and conditional writes

The fleet bucket is the root of authority. celld talks to it through one
client — "the engine's single object-store client: the `object_store` crate
`celld-ltx` already links, bound to one bucket" — and every call site uses
in-memory `Bytes`, because no call site streamed a body
(crates/celld/bucket.rs#L3-L5).

## The conditional-write contract

celld needs three properties from the object store
(docs/guarantees.md#L18-L24):

- a conditional create (the write must fail when the object exists),
- a conditional overwrite (the write must fail when the object changed after
  the read), and
- read-after-write consistency (a read after a successful write must return
  that write).

The qualified stores are Amazon S3, Cloudflare R2, Tigris, Google Cloud
Storage, and Azure Blob Storage; celld's release tests run against R2, and
the S3 path uses the same client and the same headers
(docs/guarantees.md#L26-L28). Backblaze B2, Hetzner Object Storage, and
DigitalOcean Spaces do not implement the required conditional writes, so
celld is not correct on them: two nodes can then own one cell
(docs/guarantees.md#L30-L34). MinIO (community edition) passes the storage
test but is not qualified for production; release
`RELEASE.2025-09-06T17-38-46Z` answers the conditional create of an absent
object with `NoSuchKey`, so the first deploy fails (denoland/celld#162)
(docs/guarantees.md#L36-L41).

## Three conditional-write dialects

`bucket.rs` describes two dialects sharing one surface, plus Azure which
reuses the S3 etag dialect (crates/celld/bucket.rs#L3-L24):

- **S3** (`s3://` or a bare name): the CAS token is the etag, sent as
  `If-Match` / `If-None-Match` with SigV4 credentials.
- **Azure** (`az://`): the same etag dialect on Azure Blob Storage, because
  Put Blob honors both headers, so only the client and the credentials
  differ. The bucket NAME is the container and the storage account comes from
  `AZURE_STORAGE_ACCOUNT_NAME` (crates/celld/bucket.rs#L190-L214).
- **GCS** (`gs://`): the Cloud Storage XML API dialect, where the CAS token
  is the object generation sent as `x-goog-if-generation-match` with OAuth
  credentials. Cloud Storage accepts S3-style requests on the same host but
  does not apply `If-Match` to a PUT, so only the generation dialect can
  fence there.

The backend is chosen by `split_spec`, which parses
`[s3://|gs://|az://]NAME[/PREFIX]` into the backend, the bucket name, and a
normalized key prefix (empty or slash-terminated). A spec without a scheme
stays S3-compatible, and a spec without a PREFIX keeps every key at the
bucket root, so a fleet provisioned before either existed never moves its
objects (crates/celld/bucket.rs#L190-L214).

The `Bucket` type keeps a separate `cas_store` built with retries OFF: a
retried CAS put can land on the first attempt's own token change and report a
clean 412 — converting "may have committed" into a false rejection — so the
ambiguity must surface as `Err` for the caller to reconcile
(crates/celld/bucket.rs#L155-L159). It also keeps a paginated-listing handle,
because `ObjectStore::list_with_delimiter` drains every continuation page
into one buffer and cannot answer "the first N" without paying for all of
them (crates/celld/bucket.rs#L146-L154).

## Error classification

The error contract is relied on by the self-fence: `put_cas` answers
`Ok(None)` only for a clean 412/409 rejection, and every other failure is
ambiguous because the write may have committed and surfaces as `Err`
(crates/celld/bucket.rs#L20-L24). `is_clean_cas_rejection` treats
`Error::Precondition` and `Error::AlreadyExists` as a clean lost race;
Azure reports a failed `If-None-Match` as `Precondition` while some stores
report the same create conflict as `AlreadyExists` (crates/celld/bucket.rs#L178-L188).
A response that carries no CAS token is an error, never an empty token a
later conditional write would trust (crates/celld/bucket.rs#L93-L109).

## Credentials

- **S3-compatible**: celld uses the standard AWS credential chain. On Amazon
  EKS it reads Pod Identity credentials from the injected environment
  variables and the authorization-token file (docs/README.md#L128-L132).
  Explicit credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_SESSION_TOKEN`) are also accepted
  (crates/celld/bucket.rs#L59-L65). The environment endpoint is resolved from
  `AWS_ENDPOINT_URL` then `AWS_ENDPOINT`, the same variables
  `AmazonS3Builder::from_env` injects (crates/celld/bucket.rs#L216-L226).
- **Google Cloud Storage**: Application Default Credentials; create a
  bucket, authenticate with `gcloud auth application-default login`, or
  point `GOOGLE_APPLICATION_CREDENTIALS` at a service-account key. A `gs://`
  bucket takes no `S3_ENDPOINT` and no `AWS_*` credentials, and celld ignores
  the storage region (docs/README.md#L142-L156).
- **Azure Blob Storage**: celld accepts exactly one of three credential
  families — a storage account key, a managed identity, or a workload
  identity. A system-assigned managed identity needs only the account name; a
  user-assigned managed identity needs exactly one selector among
  `AZURE_CLIENT_ID`, `AZURE_OBJECT_ID`, and `AZURE_MSI_RESOURCE_ID`. The AKS
  workload identity uses `AZURE_AUTHORITY_HOST`, `AZURE_CLIENT_ID`,
  `AZURE_TENANT_ID`, and `AZURE_FEDERATED_TOKEN_FILE`, and the authority host
  must identify the public Azure cloud. celld rejects a managed identity from
  Azure App Service or Azure Container Apps; use a workload identity or an
  account key there (docs/README.md#L158-L199).

## Bucket key prefixes

A bucket value can add a key prefix: `s3://YOUR-BUCKET/PREFIX`. Every object
of the fleet then goes below `PREFIX/`, so two fleets can share one bucket; a
bucket value without a prefix keeps the objects at the root, so an existing
fleet does not move its data (docs/README.md#L205-L208). The replication
backend builds its own object-store clients and "carries the fleet's key
prefix itself: without that, two fleets sharing one bucket would replicate
over each other" (crates/celld/ltx_repl.rs#L11-L15).

## Reserved prefixes

celld reserves the prefixes `probe/`, `cells/`, `nodes/`, `node-cells/`,
`fleet/`, `deploy/`, `deploy-blobs/`, `wake/`, and `telemetry/`, and it
deletes objects under some of them, so an application must not write under
any of these prefixes (docs/guarantees.md#L76-L81). The drain token lives at
`drain/token.json`, deliberately outside `nodes/` so lease listings and
dead-node GC never see it (crates/celld/drain_token.rs#L18-L20).

## The storage qualification test

No store publishes these properties, so `celld diagnose` asks the store
directly: it sends four conditional writes (create, reject-create, update,
reject-stale) to the bucket and reports the result. Two of the four writes
must fail; a store that accepts either one cannot fence a cell, so celld
names the store as the fault and the command exits with an error. Each node
repeats the test once at startup, and a node that finds a broken store stops.
Set `CELLD_STORAGE_PROBE=0` to disable the startup test, or run
`celld diagnose --read-only` with a credential that cannot write
(docs/guarantees.md#L59-L75).

The test writes and deletes one small object under `probe/`; a process that
stops mid-test can leave the object behind, and celld never reads it
(docs/guarantees.md#L76-L78). celld does not require a ranged read today, so
a store that ignores the `Range` header can still run a fleet
(docs/guarantees.md#L83-L84).

## Local development store

`celld dev` uses a local SQLite object store instead of a cloud bucket
(docs/README.md#L274-L279). The narrow bridge is `Bucket::open_dev`, reached
only through `CELLD_INTERNAL_DEV_STORE`; the public fleet parser never
receives that path, so no regular subcommand can select the local backend
(crates/celld/dev.rs#L27-L32). A regular node or an operator subcommand must
use a supported cloud bucket (docs/README.md#L325-L327).
