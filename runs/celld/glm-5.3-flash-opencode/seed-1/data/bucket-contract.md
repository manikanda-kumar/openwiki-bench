---
type: data
title: Bucket contract and object-store adapters
description: The object-store properties celld requires, the per-provider conditional-write dialects, key prefixes and reserved prefixes, and the startup storage probe.
tags: [storage, bucket, object-store, conditional-writes]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Bucket contract and object-store adapters

## The three required store properties

The fleet depends on the object store for both authority and long-term
state, so the store must provide
[docs/guarantees.md](repo://docs/guarantees.md#L16-L25):

1. A conditional **create**: the write must fail when the object exists.
2. A conditional **overwrite**: the write must fail when the object changed
   after the read.
3. **Read-after-write** consistency.

Qualified stores: Amazon S3, Cloudflare R2, Tigris, Google Cloud Storage,
and Azure Blob Storage; release tests run against R2 and the S3 path uses
the same client and headers
[docs/guarantees.md](repo://docs/guarantees.md#L26-L34). Backblaze B2,
Hetzner Object Storage, and DigitalOcean Spaces do not implement the
conditional writes — "celld is not correct on such a store: two nodes can
then own one cell" — and a store that silently ignores conditions fails
late, so the storage test below exists
[docs/guarantees.md](repo://docs/guarantees.md#L30-L39). MinIO community
edition passes the test but is not production-qualified, and one release
(RELEASE.2025-09-06T17-38-46Z) rejects the conditional create the first
deploy sends (denoland/celld#162)
[docs/guarantees.md](repo://docs/guarantees.md#L36-L41).

## The two conditional-write dialects

`crates/celld/bucket.rs` is "the engine's single object-store client":
one bucket, bound on top of the `object_store` crate (that `celld-ltx`
already links), replacing aws-sdk-s3, with in-memory `Bytes` bodies. Its
module doc defines the dialects precisely
[crates/celld/bucket.rs](repo://crates/celld/bucket.rs#L1-L24):

- **S3 dialect** (`s3://` or bare spec): the CAS token is the etag, sent as
  `If-Match` / `If-None-Match` with SigV4 credentials.
- **Azure dialect** (`az://`): the same etag headers — Put Blob honors both
  — differing only in client and credentials.
- **GCS dialect** (`gs://`): the CAS token is the object **generation**,
  sent as `x-goog-if-generation-match` with OAuth credentials. The reason
  is that GCS does not apply `If-Match` to a PUT, "so only the generation
  dialect can fence there"
  [crates/celld/bucket.rs](repo://crates/celld/bucket.rs#L616-L631).

Callers never see the difference: the token is an opaque `String` that a
read answers and a conditional write consumes
[crates/celld/bucket.rs](repo://crates/celld/bucket.rs#L17-L18).

## The `put_cas` error contract

`Bucket::put_cas(key, body, token)` maps explicit modes: `None` →
`PutMode::Create`; `Some(token)` → `PutMode::Update(...)` with the backend's
token conversion [crates/celld/bucket.rs](repo://crates/celld/bucket.rs#L838-L848).
The return values are:

- `Ok(Some(new_token))` — the write applied.
- `Ok(None)` — a clean rejection. `is_clean_cas_rejection` treats
  `Precondition` and `AlreadyExists` as clean rejections (Azure reports a
  failed `If-None-Match` as `Precondition`; other stores report the
  create conflict as `AlreadyExists`)
  [crates/celld/bucket.rs](repo://crates/celld/bucket.rs#L179-L186).
- Any other failure is `Err`, because "the write may have committed" — the
  caller must reconcile. A result without a usable CAS token is also an
  error rather than an empty token a later conditional write would trust
  [crates/celld/bucket.rs](repo://crates/celld/bucket.rs#L858-L880).

This contract is relied on by the self-fence (see
[Ownership, epochs, and fencing](/openwiki/data/ownership-fencing.md)):
only a clean rejection is safe to act on; an ambiguous outcome may have
changed the object.

## Bucket specs, schemes, and key prefixes

`split_spec` parses one bucket spec into a backend, a bucket name, and a
normalized key prefix: `gs://` and `az://` select their backends, anything
else is S3-compatible; the spec may carry a `<scheme>://NAME/PREFIX`
prefix. Two fleets can share one bucket via distinct prefixes; without a
prefix objects stay at the bucket root, so an existing fleet's data does
not move [crates/celld/bucket.rs](repo://crates/celld/bucket.rs#L191-L208)
[docs/README.md](repo://docs/README.md#L205-L209).

Constraints enforced at construction:

- The prefix accepts only letters, digits and `-_./`; anything else is
  rejected [crates/celld/bucket.rs](repo://crates/celld/bucket.rs#L549-L555).
- Prefix bytes are spliced into keys as plain text and stripped from
  list results.
- A prefix placed on the deletion array is protected: "the prefix on all
  three schemes" cannot hold account-bearing material — an object placed
  in the prefix directory is a misuse and is cleaned up by the diagnostic
  and the GC rather than trusted
  [crates/celld/bucket.rs](repo://crates/celld/bucket.rs#L191-L199).

## Reserved prefixes

celld reserves `probe/`, `cells/`, `nodes/`, `node-cells/`, `fleet/`,
`deploy/`, `deploy-blobs/`, `wake/`, and `telemetry/`, and it deletes
objects under some of them, so an application must never write under any
of these prefixes [docs/guarantees.md](repo://docs/guarantees.md#L79-L82).

Object layout makes the protocol mechanics visible:

- Cell ownership record: `cells/<cell>/own.json`
  [crates/celld/ownership_store.rs](repo://crates/celld/ownership_store.rs#L288-L420).
- Node lease: `nodes/<node>.json`
  [crates/celld/ownership_store.rs](repo://crates/celld/ownership_store.rs#L433-L433).
- Replicated cell data: `cells/<cell>/ltx/e<epoch>/` — the epoch in the key
  is the fence [docs/guarantees.md](repo://docs/guarantees.md#L122-L128).
- Peer auth secret: `fleet/peer-auth.json`
  [crates/celld/peer_auth.rs](repo://crates/celld/peer_auth.rs#L20-L20).
- Deployments: `deploy/current.json` and versioned manifests
  [crates/celld/protocol.rs](repo://crates/celld/protocol.rs#L11-L13).

## The storage test at startup

Because "no store publishes these properties", celld asks the store
directly. `celld diagnose` sends four conditional writes under `probe/` —
create, reject-create, update, reject-stale — and reports
`ok bucket conditional write (...)`; two of the four must fail. A store
that accepts either one cannot fence a cell, so celld names the store as
the fault and exits with an error
[docs/guarantees.md](repo://docs/guarantees.md#L59-L78).

Each node repeats the test once at startup and a node that finds a broken
store stops; `CELLD_STORAGE_PROBE=0` disables it, and
`celld diagnose --read-only` runs it with a credential that cannot write
[docs/guarantees.md](repo://docs/guarantees.md#L72-L74). The fleet-level
probe is wired through `fleet::probe_storage_before_serving`
[crates/celld/fleet.rs](repo://crates/celld/fleet.rs#L237-L301).

The test writes and deletes one small object under `probe/`; a process
that stops mid-test can leave that object and celld never reads it
[docs/guarantees.md](repo://docs/guarantees.md#L74-L76). celld does not
require ranged reads today — a store that ignores the `Range` header can
still run a fleet [docs/guarantees.md](repo://docs/guarantees.md#L83-L84).

## Credential scoping per provider

Operating and credential setup per provider is documented in detail:

- **S3-compatible**: the standard AWS credential chain (including EKS Pod
  Identity); R2 via `AWS_*` + `S3_ENDPOINT`
  [docs/README.md](repo://docs/README.md#L126-L140).
- **GCS**: Application Default Credentials / service-account key via
  `GOOGLE_APPLICATION_CREDENTIALS`; a Compute Engine instance needs the
  `cloud-platform` access scope because the default scope allows only
  storage reads [docs/README.md](repo://docs/README.md#L142-L156).
- **Azure**: the bucket NAME is the container; exactly one credential
  family — storage account key, managed identity (instance metadata
  service only, not App Service/Container Apps), or workload identity
  (public `https://login.microsoftonline.com` authority only) — with
  data-plane `Storage Blob Data Contributor` level access; Azurite is a
  development store, never fleet-qualified
  [docs/README.md](repo://docs/README.md#L158-L199)
  [docs/guarantees.md](repo://docs/guarantees.md#L53-L57).

The doc page also states the Azure qualification explicitly: conditional
writes and the multipart upload path were tested against a live Azure
account on 2026-08-18 with an account key, a VM managed identity, and an
AKS workload identity, single-node
[docs/guarantees.md](repo://docs/guarantees.md#L53-L57).
