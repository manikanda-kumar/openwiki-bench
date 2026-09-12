---
type: quickstart
title: celld Quickstart
description: The fastest path from clone to a running Worker — installing celld, local development with celld dev, deploying to a Cloud bucket fleet, and starting a node.
tags: [quickstart, install, development, deploy, fleet]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---

# celld Quickstart

celld is a self-hosted, distributed durable-object runtime. This page is the
fastest path from nothing to a running Worker, in two modes: local
development with `celld dev`, and a Cloud bucket fleet.

For how the system fits together, see the [architecture page](architecture.md);
for daily operations, see [operations](operations.md).

## Install

The installer downloads the `celld` binary; provenance is verifiable with
`gh attestation verify`:

```sh
curl -fsSL https://celld.dev/install.sh | sh
```

Put `~/.local/bin` on your `PATH` if the installer asks. Worker projects that
are not asset-only need [esbuild](https://esbuild.github.io) on `PATH` for
`celld deploy` (`README.md` lines 44-48). To install an exact release set
`CELLD_VERSION` to its tag, and verify a downloaded file with
`gh attestation verify <asset> --repo denoland/celld` (`docs/README.md` lines
115-124).

## Local development: `celld dev`

The command starts an application locally without Docker or a cloud bucket. It
opens a local object store, deploys the application, and starts one celld node
(`docs/README.md` lines 276-284). Ready for local workers:

```sh
celld dev
```

The Worker listener uses `http://127.0.0.1:9876` by default. Use `--port` to
select a different port and `--host` to select an interface (a non-loopback IP
exposes the Worker listener to the network while the internal operator listener
stays on loopback) (`docs/README.md` lines 284-299).

A normal shutdown keeps `.celld/dev` below the project directory, "so the next
invocation uses the same durable application state. Delete `.celld/dev` while
`celld dev` is stopped to reset that state" (lines 320-324). The command
watches the project directory and rebuilds/restarts the local node after a
source or configuration change; a failed build does not replace the current
application, and a restart retains the durable state (lines 328-332). The
watcher ignores `.celld`, `.git`, `node_modules`, and `target` at each depth.

The default display hides warning and info logs; use `--logs` to show them.
Errors stay visible without the flag. `NO_COLOR` / `FORCE_COLOR` control color.

## Deploy to a bucket fleet

For a Cloud bucket, configure storage first (`docs/README.md` lines 126-199). In
summary:

- **S3-compatible:** the standard AWS credential chain (or explicit
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`); for R2 also set `AWS_REGION=auto`
  and `S3_ENDPOINT`.
- **Google Cloud Storage:** Application Default Credentials; the bucket is
  `gs://YOUR-BUCKET`.
- **Azure:** `AZURE_STORAGE_ACCOUNT_NAME` (the NAME is the container) plus
  exactly one credential family: account key, managed identity, or workload
  identity; the bucket is `az://YOUR-CONTAINER`.

Then deploy an application from a Wrangler project
(`docs/README.md` lines 221-233):

```sh
celld deploy . \
  --bucket "$CELLD_BUCKET" \
  --endpoint "$S3_ENDPOINT" \
  --region "$AWS_REGION"
```

Worker code is bundled with esbuild from `PATH`; asset-only projects need no
esbuild. `celld deploy` accepts the Wrangler config allowlist (see the
[compatibility page](compatibility.md)) and writes the deployment objects
directly using the documented types in `crates/celld/protocol.rs`.

## Start a node

Run a node against the same bucket (`README.md` lines 122-132):

```sh
celld \
  --bucket s3://my-cells-bucket \
  --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 \
  --advertise 10.0.0.12:8081
```

- `--listen` is the public Worker listener (expose through a load balancer).
- `--internal-listen` and `--advertise` are the private peer/operator listener
  and its reachable address. An explicit advertised address requires an
  explicit internal-listener address, and you must route the advertised
  address to the internal listener.
- Put every advertised address on a trusted private network or an encrypted
  overlay such as WireGuard or Tailscale; do not publish the internal port.

Each subsequent node needs no extra configuration: nodes find each other
"through the leases in the bucket; there is no join command and no fixed
membership list" (`docs/README.md` lines 415-418). A second node also makes
writes much faster, because the owner can prove a write durable by sending it
to a follower instead of waiting for a bucket round trip
(`README.md` lines 134-147). A node picks its followers automatically; run two
or more nodes if write latency matters.

## The fastest end to check the health

The public health endpoint is `/.well-known/celld/health`: `{"ok":true}` (200)
when healthy, `{"ok":false}` (503) when draining or unready
(`docs/security.md` lines 40-43). The internal listener serves the operator API
(`/state`, `/reload`, `/shutdown`, `/cell/<SCOPE>`, etc.) — see
[operations](operations.md).

## Environment the quickstart relies on

The primary settings are documented in the README env table
(`docs/README.md` lines 658-708). The shortest set to remember for a fleet:
`CELLD_BUCKET`, `S3_ENDPOINT`, `AWS_REGION`, `CELLD_ADDR`, `CELLD_INTERNAL_ADDR`,
`CELLD_ADVERTISE`. Every typed variable is validated at startup, so a malformed
value exits instead of silently changing behavior.
