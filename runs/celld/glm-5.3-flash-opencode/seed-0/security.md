---
type: security
title: "Security boundaries"
description: "What celld trusts: the trusted private network, the fleet secret, bucket credentials as fleet authority, advertise and forwarded-header guards, and the alpha status."
tags: [security, hmac, trust, boundaries]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-22743a54f7646819f332cb9f
    resource: repo://crates/celld/drain_token.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-0d6e1a1251e54f3519e4e37d
    resource: repo://crates/celld/peer_probe.rs
  - id: openwiki-source-edfb954b706fa7744e175849
    resource: repo://crates/logic/peer.rs
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Security boundaries

The first paragraph of [docs/security.md](../docs/security.md) sets scope:
"celld is an alpha. It is not safe for hostile multi-tenant use. Security
fixes apply to the latest release only."

## The boundary

"One fleet runs one application, and celld trusts the application code, the
fleet nodes, and the operators." Do not run mutually distrusting tenants in
one fleet. celld depends on exactly two external security boundaries
([docs/security.md](../docs/security.md), Security boundary):

1. **A trusted private network protects the internal listener** — "Use an
   encrypted overlay when the private network does not provide
   confidentiality."
2. **Object storage credentials control the fleet** — "Give each credential
   access to one fleet bucket only."

The fleet bucket "is the root of authority for the fleet. It stores the
deployments, the cell state, the ownership leases, the node leases, and the
shared peer-authentication secret. A person who holds the bucket credentials
controls the fleet" ([docs/security.md](../docs/security.md), Protect the
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
fleet bucket). [README](README.md) says the same: "Treat access to the bucket
and its credentials as fleet administrator access."

## What the fleet HMAC does and does not do

The fleet secret (`fleet/peer-auth.json` in the bucket,
`crates/celld/peer_auth.rs:20`) authenticates **tunnel establishment** and
the peer-control/reserved-cell routes. It does **not** sign tunneled inner
calls and does not encrypt anything: "The establishment signature decides who
can open a tunnel … The signature does not authenticate the bytes after the
establishment, and it does not encrypt any traffic. The private network must
therefore stay trusted, and the fleet HMAC does not replace this network
boundary" ([docs/security.md](../docs/security.md)). celld terminates no TLS
on either listener.

Freshness and replay protection are code-enforced, not just documented: a
two-sided 30-second clock window and replay retention ≥ the clock window
(`crates/celld/peer_auth.rs:22-30`, `crates/logic/peer.rs:24-31`), with the
version 5 protocol identifier bound into every signature
(`crates/celld/peer_auth.rs:16-17`, `258-266`).

## Advertise guard

`--advertise` / `CELLD_ADVERTISE` must point at the internal listener on the
trusted network; celld "rejects a literal public IP unless you supply
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
`--unsafe-public-advertise`" ([README](README.md); flag defined at
`crates/celld/main/cli.rs:310-312` and `CELLD_UNSAFE_PUBLIC_ADVERTISE`,
`cli.rs:334`). An explicit advertised address requires an explicit
internal-listener address, and celld cannot verify hostname routing — the
operator must route the advertised name to the internal listener
([docs/security.md](../docs/security.md)).

## Forwarded headers

celld ignores `X-Forwarded-Host` / `X-Forwarded-Proto` unless
`--trust-forwarded-headers` / `CELLD_TRUST_FORWARDED_HEADERS=1` — "Set [it]
only when a trusted proxy replaces both headers", with last-value-wins so a
client cannot override the proxy ([docs/security.md](../docs/security.md);
flag parse at `crates/celld/main/cli.rs:160-161`). The request line's
authority in absolute-form targets is ignored; `Host` is canonicalized or
falls back to `celld.local` — and "these checks … do not make the hostname
trustworthy. An application must not use an unchecked hostname for an
authorization decision" ([docs/security.md](../docs/security.md)).

## Route hardening

- The public listener reserves only `/.well-known/celld/health`
  ([docs/security.md](../docs/security.md)).
- Internal unauthenticated operator routes exist (`/state`, `/cell`,
  `/evict`, `/do`, `/shutdown`) but `/do/<ID>` **refuses every reserved
  runtime class** (D1, Workflows, KV, Queues); those go only through the
  HMAC-authenticated `/runtime/<SCOPE>` route ([docs/security.md](../docs/security.md)).
- `/peer/probe` is a challenge-bound signed diagnostic
  (`crates/celld/peer_probe.rs:7-15`).

## The drain token

`POST /shutdown` handoffs are serialized by the **fleet drain token** — one
bucket object that only one donor holds at a time
(`crates/celld/drain_token.rs:3-5`; decision logic in
`celld_logic::drain`). It is deliberately advisory: "A donor that cannot
claim it within its wait bound proceeds anyway, because the orchestrator
grace is finite and an unserialized handoff is strictly better than a forced
exit" (`drain_token.rs:7-9`). Bound: `CELLD_DRAIN_TOKEN_WAIT_MS`
(`crates/celld/main/cli.rs:355`). `celld_logic::drain` owns the
claim/settled decisions, so this module is the bucket IO executor.

## Deliberately unsupported

- Multi-tenant isolation: "This fencing protects storage consistency, but it
  does not isolate hostile applications"
  ([docs/security.md](../docs/security.md); see also
  [docs/limitations.md](../docs/limitations.md) for the alpha boundary).
- TLS termination on either listener, hostname-based trust — proxy-side
  concern.

## What the repo does not establish

- A production hardening guide beyond the alpha statements above; anything
  beyond [docs/security.md](../docs/security.md) and [docs/limitations.md](../docs/limitations.md)
  is operator policy, not a repository guarantee.
