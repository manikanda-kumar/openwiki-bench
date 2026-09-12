---
type: "Reference"
title: "celld quickstart"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-c8b39dcd2a245cd9301a976a
    resource: repo://examples/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---


# celld quickstart

celld runs Cloudflare Workers and Durable Objects on machines you own. A
**node** is one `celld` process; the nodes that share one bucket are a
**fleet** (docs/README.md#L17-L20). This page gets you from zero to a running
application.

## Install

The installer downloads the `celld` binary:

```sh
curl -fsSL https://celld.dev/install.sh | sh
```

Put `~/.local/bin` on your `PATH` if the installer asks you to. To install
one exact release, set `CELLD_VERSION` to its tag; the releases are on GitHub
and each has a GitHub Actions build attestation, verifiable with
`gh attestation verify <asset> --repo denoland/celld`
(README.md#L36-L48; docs/README.md#L110-L124). Worker projects deployed with
`celld deploy` need [esbuild](https://esbuild.github.io) on `PATH`;
asset-only projects do not (README.md#L46-L48).

There is also a container image published for Linux x86-64 and ARM64:
`ghcr.io/denoland/celld` (README.md#L58-L65).

## Run an application locally: `celld dev`

The fastest path needs no Docker and no cloud bucket:

```sh
cd examples/counter
celld dev
```

The command opens a local SQLite object store, deploys the application, and
starts one celld node. The Worker listener uses `http://127.0.0.1:9876` by
default; use `--port PORT` to select a different port and `--host IP` to
select a different interface (a non-loopback IP exposes the Worker listener
to the network while the internal operator listener stays on loopback)
(docs/README.md#L274-L299).

The command keeps the application state in `.celld/dev` below the project
directory, so a later invocation uses the same durable data; a normal
shutdown keeps the directory, and deleting it while `celld dev` is stopped
resets the state (docs/README.md#L320-L324). The default display highlights
the application URL and hides node warning and information logs; use
`--logs` to show them, and set `NO_COLOR` (or `FORCE_COLOR` when the output
is not a terminal) to control color, with `NO_COLOR` always taking priority
(docs/README.md#L301-L311).

`celld dev` watches the project directory and rebuilds the application after
a source or configuration change; the current application keeps running
during a build, a failed build does not replace it, and a successful restart
retains the durable state (docs/README.md#L329-L337). The watcher ignores
`.celld`, `.git`, `node_modules`, and `target` at each depth. The local
object store is not exposed through a fleet flag — a regular node or an
operator subcommand must use a supported cloud bucket
(docs/README.md#L325-L327).

## Deploy to a bucket

Configure a bucket first. The bucket holds the deployments, the cell state,
the ownership records, the node leases, and the peer-authentication secret
(docs/security.md#L137-L145). Set the standard AWS credential chain and the
bucket:

```sh
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=auto
export S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
export CELLD_BUCKET=s3://YOUR-BUCKET
```

`gs://` buckets use Google Application Default Credentials, and `az://`
buckets use one Azure credential family (the account key, a managed
identity, or a workload identity); see the
[object storage](object-storage.md) page for the credential details
(docs/README.md#L126-L199).

Then, from an applicable Wrangler project, build and write the deployment:

```sh
cd examples/counter
celld deploy . --bucket "$CELLD_BUCKET"
```

`celld deploy` accepts module Workers, Durable Object bindings, service
bindings, variables, cron triggers, D1 databases, KV namespaces, Workflows,
WebAssembly modules, and static assets; an unknown Wrangler configuration key
stops the deploy with an error (docs/README.md#L235-L243). See the
[deployments](deployments.md) page for the full contract.

## Start fleet nodes

Start a node against the same bucket. For a fleet node, bind the public and
internal listeners separately:

```sh
celld \
  --bucket s3://my-cells-bucket \
  --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 \
  --advertise node-a.internal:8081
```

The public listener serves the deployed Worker; the internal listener serves
the peer protocol and the operator API, and every advertised address must be
on a trusted private network or an encrypted overlay such as WireGuard or
Tailscale — do not publish the internal port (README.md#L190-L200). An
explicit advertised address requires an explicit internal-listener address,
and celld rejects a literal public IP unless you supply
`--unsafe-public-advertise` (README.md#L190-L196).

Start a second node against the same bucket and each write is sent to it as
well, so a write finishes as soon as the second node holds the data on disk
instead of waiting for the storage round trip. The second node needs no extra
configuration, because a node finds the other nodes through the bucket
(README.md#L134-L146). `CELLD_DURABILITY` selects the behavior and defaults
to `fleet` (docs/README.md#L58-L59).

## Try the examples

The `examples/` directory has small Wrangler projects that demonstrate
progressively more of the supported surface: `hello` (stateless fetch),
`counter` (SQLite-backed Durable Object), `d1`, `r2`, `kv`, `async`, `body`,
`router`, `wsecho`, `wsclient`, `alarm`, `cron`, `workflow`, `rpc`, `wasm`,
and `vectordb` (examples/README.md#L3-L24). The `counter` example uses the
`name` query parameter as the Durable Object name, so different names show
independent cells:

```sh
curl 'http://127.0.0.1:8080/increment?name=alpha'
curl 'http://127.0.0.1:8080/increment?name=beta'
curl 'http://127.0.0.1:8080/increment?name=alpha'
```

A fleet can place the named cells on different nodes, and each cell keeps an
independent counter (examples/README.md#L26-L44).

## Operate a fleet

- `celld diagnose --bucket ...` — enumerate every node lease and perform a
  signed direct probe of each live peer (README.md#L204-L215).
- `celld cell list --bucket ...` — list the Durable Object instances in the
  fleet bucket (README.md#L217-L232).
- `celld d1`, `celld kv`, and `celld queue` — run SQL and migrations against
  a deployed D1 database, read and write a deployed KV namespace, and inspect
  and control a deployed Queue (README.md#L234-L257).

See the [operator CLI](operator-cli.md) page for the command surface and the
[node lifecycle](node-lifecycle.md) page for running a fleet safely.

## Next

- [What celld guarantees](https://github.com/denoland/celld/blob/main/docs/guarantees.md)
  describes the storage requirements, the durability protocol, and the
  supervisor contract you must provide.
<!-- openwiki: broken internal link [limitations.md] file "limitations.md" does not exist. Fix the href or restore the target, then delete this comment. -->
- Read the [security](security.md) and [limitations](limitations.md) pages
  before operating a public fleet (README.md#L333-L334).
