---
type: reference
title: CLI and internal operator API
description: The celld command-line surface (run, dev, deploy, diagnose, cell, d1, kv, queue, connect), the stdout-is-data output rule, and the internal listener operator API routes.
tags: [cli, operator, api, diagnose, reference]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-5582430152973ab16bc08716
    resource: repo://crates/celld/cli_options.rs
  - id: openwiki-source-74510bca427f93999e1bbdd0
    resource: repo://crates/celld/cli_output.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-0d6e1a1251e54f3519e4e37d
    resource: repo://crates/celld/peer_probe.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# CLI and internal operator API

celld has two operator surfaces: the `celld` command line, and an internal
HTTP listener that serves the peer protocol and an operator API. The
operator API is an alpha interface — a release can change its paths or
response formats, so keep operator tooling and the celld release together
(docs/security.md#L83-L85).

## The command line

The CLI parser answers one question — which `Action` to take — and refuses
anything ambiguous rather than guessing. The `Action` enum is: `Run`,
`Diagnose`, `Deploy`, `Dev`, `Cell`, `D1`, `Kv`, `Queue`, `Connect`,
`Credentials`, `Token`, `Disconnect`, `Help`, and `Version`
(crates/celld/main/cli.rs#L9-L54). The parser dispatches each subcommand to
its module (crates/celld/main.rs#L3057-L3089).

### Output rules

Three rules hold across every subcommand, and `cli_output.rs` exists so no
command can implement them differently (crates/celld/cli_output.rs#L7-L20):

1. **stdout carries data, stderr carries everything a person reads.** A
   command that mixes them corrupts the first pipe it meets. The
   `Action::stdout_is_data` predicate decides which stream is which:
   `Run`, `Dev`, `Help`, and `Version` write to stdout as a log stream, and
   every other subcommand's stdout is its answer
   (crates/celld/main/cli.rs#L56-L71). The `note!` macro always writes to
   stderr (crates/celld/cli_output.rs#L56-L67).
2. **A listing is bounded by default** and says on stderr what it withheld
   and how to continue. Cost follows the fleet's size, not the operator's
   question.
3. **A closed pipe ends the output; it is not a failure.**

The `Record` trait enforces the first rule structurally: a row cannot be
printed as text without also declaring its JSON shape, so `--json` cannot be
half-implemented (crates/celld/cli_output.rs#L27-L37). A bounded listing
resumes through the `Resumable` trait, so a listing that forgets its cursor
fails to compile instead of printing a resume line that does not work
(crates/celld/cli_output.rs#L39-L47).

### Command groups

- **`celld` (run)** — start a node. Fleet settings come from `--bucket`,
  `--endpoint`, `--region` or `CELLD_BUCKET`, `S3_ENDPOINT`,
  `AWS_REGION`/`AWS_DEFAULT_REGION`
  (crates/celld/cli_options.rs#L6-L16).
- **`celld dev`** — start one node with a local object store; no Docker or
  cloud bucket required. See the [quickstart](quickstart.md).
- **`celld deploy`** — build a Wrangler project and write the deployment
  objects. See [deployments](deployments.md).
- **`celld diagnose`** — read the node leases and send a signed direct probe
  to each live peer. It does not take a lease and does not change ownership
  (docs/README.md#L553-L557). The report keeps checking after an individual
  failure and distinguishes expired records, malformed or unsafe advertise
  addresses, unreachable peers, and incompatible protocols, and it prints
  each node's coarse resident-cell, WebSocket, RSS, CPU, file-descriptor,
  pressure, and shedding sample (README.md#L204-L215). Use `--peer NODE_ID`
  one or more times to restrict the check, `--read-only` to skip the write
  probe, and `--json` for one JSON object per check
  (docs/README.md#L559-L570).
- **`celld cell list`** — list the Durable Object instances in the fleet
  bucket, one `Class:ID` scope per line. Give a class name to filter, and
  `--json` for one JSON object per line. An instance appears after the first
  event reaches it, because its owner then writes an ownership record
  (docs/README.md#L578-L594). The listing is bounded: one storage request
  returns at most 1000 instances, and the command reports on stderr that more
  exist and gives the `--after SCOPE` to continue; pass `--all` for the whole
  listing or `--limit N` for a different bound
  (docs/README.md#L607-L624). Reserved cells (D1, KV, Workflow, Queue) are
  marked `"reserved": true` (docs/README.md#L596-L605).
- **`celld d1`** — run SQL and migrations against a deployed D1 database. It
  finds a node through the node leases, and that node sends the work to the
  node that owns the database (docs/README.md#L339-L347).
- **`celld kv`** — read and write a deployed KV namespace. The bulk commands
  use the Wrangler file format, so a Wrangler export can migrate directly
  into celld (docs/README.md#L349-L355). `celld kv list` prints at most 1000
  keys by default, reports on stderr that more exist, and supports `--after`,
  `--all`, and `--json` (docs/README.md#L357-L361).
- **`celld queue`** — inspect and control a deployed Queue. A queue can
  continue to accept messages while delivery is paused:
  `celld queue info jobs`, `celld queue pause jobs`, `celld queue resume jobs`
  (README.md#L250-L257).
- **`celld connect` / `credentials` / `token` / `disconnect`** — managed
  control-plane session commands (crates/celld/main/cli.rs#L46-L51,
  crates/celld/main.rs#L3063-L3072).

## The two listeners

A node opens two HTTP listeners (docs/security.md#L21-L34):

- The **public listener** (`--listen`) serves the deployed Worker and
  reserves only `/.well-known/celld/health`. A healthy node returns 200 with
  `{"ok":true}`; an unhealthy node returns 503. The deployed Worker owns
  every other public path (docs/security.md#L40-L42). The route table enforces
  this: `/.well-known/celld/health` is handled before the Worker, and the
  health response is `{"ok":false}` when the node is unhealthy
  (crates/celld/main.rs#L2579-L2611).
- The **internal listener** (`--internal-listen`) serves the peer protocol
  and the operator API. It does not pass an unknown path to the Worker; it
  returns 404, so an operator request cannot become an application request
  (docs/security.md#L44-L45).

## Internal operator routes

The internal listener dispatches by path (crates/celld/main.rs#L2632-L2831):

- `GET /peer/probe` — a signed diagnostic response, challenge-bound to the
  node's probe key (crates/celld/main.rs#L2632;
  crates/celld/peer_probe.rs#L14-L17, crates/celld/peer_probe.rs#L110-L179).
- `GET /state` — reports the node state (crates/celld/main.rs#L2635).
- `POST /reload` — adopt the deployment pointer now
  (crates/celld/main.rs#L2636-L2639).
- `POST /shutdown` — start the same graceful handoff as SIGTERM; the
  `handoff=preserve` query prepares a clean same-node reload
  (crates/celld/main.rs#L2640-L2643).
- `/peer/tunnel` — establishes the tunnel that carries cell fetch, RPC, and
  WebSocket calls (crates/celld/main.rs#L2659).
- `/runtime/<scope>` — the reserved-cell operator route
  (crates/celld/main.rs#L2684-L2686).
- `/do/<id>` — a direct request to an ordinary Durable Object; it refuses
  every reserved runtime class (crates/celld/main.rs#L2750).
- `/cell/<scope>` — resolve or activate a cell
  (crates/celld/main.rs#L2791-L2794).
- `/evict/<scope>` — evict a resident cell
  (crates/celld/main.rs#L2828-L2831).

## Authentication

Most operator routes let an operator inspect or control a node without
request authentication. The exceptions are the peer-control routes, the
reserved-cell `/runtime/<scope>` routes, and `/peer/tunnel` establishment,
which use the fleet HMAC with a clock limit and replay protection
(docs/security.md#L55-L76). The `/do/<ID>` route refuses every reserved
runtime class, because their operator protocols can access application data
or change runtime state (docs/security.md#L96-L99). All three groups require
the trusted private network (docs/security.md#L68).

The internal listener also has an unauthenticated operator API, so it must
not reach the public internet (docs/README.md#L420-L425). See the
[security](security.md) page for the full boundary.

## Forwarded headers

celld ignores `X-Forwarded-Host` and `X-Forwarded-Proto` by default. Set
`--trust-forwarded-headers` or `CELLD_TRUST_FORWARDED_HEADERS=1` only when a
trusted proxy replaces both headers; celld uses the last value in each header
(docs/security.md#L105-L110). celld always takes the path and query from the
request target and ignores the scheme and authority in an absolute-form
target (docs/security.md#L112-L114).
