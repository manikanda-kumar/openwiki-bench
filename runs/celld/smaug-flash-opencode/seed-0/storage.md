---
type: storage
title: Object Storage Backends and Bucket Contract
description: The bucket abstraction across S3-compatible, Google Cloud Storage, and Azure Blob Storage — conditional-write dialects, credential sources per provider, reserved prefixes, the storage probe, and the fleet key prefix scheme.
tags: [storage, object-store, bucket, s3, gcs, azure]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---

# Object Storage Backends and Bucket Contract

The fleet bucket is "the engine's single object-store client ... bound to one
bucket" (`crates/celld/bucket.rs`). It speaks the object_store crate dialect
and exposes conditional-write primitives that the ownership protocol depends
on. No call site streams a body, so everything is in-memory `Bytes`
(`crates/celld/bucket.rs`).

This page covers the dialect per provider, the credentials each family accepts,
the reserved bucket layout, the storage probe, and the fleet key prefix scheme.

## Two conditional-write dialects

The bucket surface serves one of two conditional-write dialects
(`crates/celld/bucket.rs`):

- **`s3://` (or bare) and `az://`** speak the *same* etag dialect: the CAS
  token is the etag, sent as `If-Match` / `If-None-Match`, with SigV4 (S3) or
  Azure Put Blob credentials. Only the client and the credentials differ.
- **`gs://`** speaks the Cloud Storage XML API dialect: the CAS token is the
  object generation, sent as `x-goog-if-generation-match` with OAuth
  credentials.

> GCS accepts S3-style requests on the same host but does not apply `If-Match`
> to a PUT, "so only the generation dialect can fence there"
> (`crates/celld/bucket.rs`).

The distinction is the dialect, not the endpoint. Callers never see the
difference: "the token is an opaque `String` a read answers and a conditional
write consumes".

The error contract is load-bearing for the self-fence: `put_cas` answers
`Ok(None)` only for a clean 412/409 rejection; "every other failure is
ambiguous — the write may have committed — and surfaces as `Err`". A response
that carries no CAS token is an error, "never an empty token a later
conditional write would trust". This is the RPO=0 safety foundation described
on the [durability page](durability.md).

## Credential sources per provider

- **S3-compatible** uses the standard AWS credential chain; on EKS celld reads
  the Pod Identity credentials from the injected environment variables and the
  authorization-token file (`docs/README.md` lines 128-130). `--endpoint`
  selects another S3-compatible service; `--region` applies when it cannot be
  inferred.
- **Google Cloud Storage** uses Application Default Credentials
  (`GOOGLE_APPLICATION_CREDENTIALS` or `gcloud auth application-default
  login`). A `gs://` bucket takes no `S3_ENDPOINT` and no `AWS_*` credentials,
  and celld ignores the storage region.
- **Azure Blob Storage** requires exactly one credential family: a storage
  account key, a managed identity, or a workload identity
  (`docs/README.md` lines 161-179). `AZURE_STORAGE_ACCOUNT_NAME` names the
  account; the bucket NAME is the container. A user-assigned managed identity
  needs exactly one selector among `AZURE_CLIENT_ID`, `AZURE_OBJECT_ID`, and
  `AZURE_MSI_RESOURCE_ID`. An identity must hold the Blob data-plane permission
  to read, write, list, and delete blobs (the `Storage Blob Data Contributor`
  role). celld rejects each recognized Azure configuration variable outside
  these families and ignores an `AZURE_*` name that `object_store` 0.12 does
  not recognize ("because that name cannot change the client").

An `az://` bucket takes no `S3_ENDPOINT` and no `AWS_*` credentials, and the
storage region is ignored. Azure was qualified for a production fleet against a
live account on 2026-08-18; Azurite (`AZURE_STORAGE_USE_EMULATOR=true`) is a
development store not qualified for a fleet (`docs/README.md` lines 193-199).

## Reserved bucket prefixes and the storage probe

celld reserves `probe/`, plus `cells/`, `nodes/`, `node-cells/`, `fleet/`,
`deploy/`, `deploy-blobs/`, `wake/`, `drain/`, `log/`, and `telemetry/`
(`docs/guarantees.md` lines 78-81), and it deletes objects under some of them —
so "an application must not write under any of these prefixes".

The storage test verifies the bucket provides the required conditional-write
contracts. `celld diagnose` sends four conditional writes; two must fail
(`docs/guarantees.md` lines 61-73). "A store that accepts either one cannot
fence a cell, so celld names the store as the fault and the command exits with
an error." Each node repeats the test once at startup (`CELLD_STORAGE_PROBE=0`
disables). The test writes and deletes one small object under `probe/`.

celld does not require a ranged read today, so "a store that ignores the
`Range` header can still run a fleet" (`docs/guarantees.md` line 84).

## The fleet key prefix scheme

A bucket value can carry a key prefix: `s3://YOUR-BUCKET/PREFIX`. "Every object
of the fleet then goes below `PREFIX/`, so two fleets can share one bucket. A
bucket value without a prefix keeps the objects at the root of the bucket,
therefore an existing fleet does not move its data" (`docs/README.md` lines
205-207).

The in-process LTX replica carries this prefix itself rather than going through
`bucket::Bucket`, "so two fleets sharing one bucket would replicate over each
other" otherwise (`crates/celld/ltx_repl.rs`).

## Object layout

The durable cell data lives under `cells/<cell>/ltx/e<epoch>/` in the bucket,
mirroring the local `<watch>/<cell>/ltx/e<epoch>/db.sqlite` tree
(`crates/celld/ltx_repl.rs`). Deployments are read from `deploy/current.json`
and the deployment objects live under `deploy/` and `deploy-blobs/`. Peers
authenticate through the secret at `fleet/peer-auth.json`, leases live under
`nodes/`, the drain token at `drain/token.json`, the fleet log root at
`log/<node>.json`, and telemetry Parquet under `telemetry/`.

Ownership records are written by the conditional-write adapter
(`crates/celld/ownership_store.rs`), which deliberately contains "serialization,
wall-clock sampling, SDK configuration and error classification only. Ownership
decisions remain in `celld-logic`."

## MinIO and qualification

MinIO (community edition) implements the conditional writes and passes the
storage test, but celld has not qualified it for production; one release —
`RELEASE.2025-09-06T17-38-46Z` — rejects the conditional create of an absent
object with `NoSuchKey`, so the first deploy fails. Use
`RELEASE.2025-09-07T16-13-09Z` or later (`docs/guarantees.md` lines 36-41).
