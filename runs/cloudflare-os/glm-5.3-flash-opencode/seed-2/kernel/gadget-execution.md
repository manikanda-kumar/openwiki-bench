---
type: "Reference"
title: "Gadget execution: facets, sandboxing, and exports"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-82fc262c6e105f27444f2f9b
    resource: repo://packages/workshop-backend/src/browser-export.ts
  - id: openwiki-source-67f91299c1003f4ab21542ba
    resource: repo://packages/workshop-backend/src/gadget-export.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# Gadget execution: facets, sandboxing, and exports

A gadget is one workpiece in a workspace whose code runs as a **Durable Object facet of the
Overseer**, backed by a dynamic worker compiled on demand. The same machinery serves three
consumers: the gadget's own UI, the agent's file previews, and the sandboxed iframe — they all
follow the same mainline-vs-chat-code split (`overseer.ts:3951-3956`).

## Loading a gadget worker

`loadGadgetWorker(gadgetId, chatId?)` compiles the gadget's files through the `LOADER` binding,
cache-keyed `<overseerId>.<codeVersion>[.<chatId>.<sequence>].<gadgetId>`
(`overseer.ts:3958-4028`):

- **Which code**: a gadget pinned in the chat (or created there, with no commit yet) loads from the
  chat's content as of the snapshotted sequence; an unpinned committed gadget loads from its head
  commit. Every merge bumps the `codeVersion` counter in the cache key, so head movement
  invalidates cached loads (`overseer.ts:3965-3997`).
- **The worker definition**: `mainModule: "server.js"` (gadget code's own entrypoint), all `.js`
  files as modules, `compatibilityFlags: ["allow_irrevocable_stub_storage"]` (persistent stubs),
  and **`globalOutbound: null`** — the gadget's worker has no internet access at all
  (`overseer.ts:4012-4026`).
- **The env**: `getEnvForLoader` builds a plain object with `GADGET` (a loopback to the gadget's
  own DO) plus one loopback per visible binding edge, each carrying the `caller`
  `{from: "gadget", chatId, gadgetId}` so observations and actions taken by gadget code are
  attributed correctly (`overseer.ts:2734-2742`). The agent's `executeCode` env is built the same
  way from the chat's binding map, with `{from: "agent", chatId}` callers
  (`overseer.ts:2748-2792`).

The loader's serializer requires a *plain* object for `env`, so prototype-pollution safety comes
from `validateBindingName` instead of a null prototype: names that collide with `Object.prototype`
members are rejected at every chokepoint (`overseer.ts:2750-2755`; `api.ts:192-220`).

## Facet lifecycle and restarts

The facet is named `gadget${id}` (the migrated default gadget keeps `"gadget"`), instantiated as a
Durable Object class exported by the loaded worker (`overseer.ts:1990-2002`, `4075-4082`).
Restarts are aborts — deliberate, because what changed is the code or the authority:

- **Code updates**: `bumpVersion` increments `codeVersion` and aborts the affected facets
  ("Gadget restarted due to code update"); binding-only changes pass just the touched gadget
  (`overseer.ts:4964-4978`).
- **Proposed-changes switches**: `getGadgetFacetFetcher` tracks `#runningChatIds` — when the
  requested chat context differs from what is running (mainline ↔ a chat's proposed changes, or
  chat ↔ chat), the facet is aborted first so the new code actually loads
  (`overseer.ts:4046-4073`). `proposedChangesChanged` aborts any facet running the modified chat's
  code whenever the chat's changes change (`overseer.ts:2798-2805`).
- **Revocation**: `removeCollaborator`/`revokeShareLink` restart the whole Overseer DO (after a
  `storage.sync()`, delayed ~100 ms so the triggering response lands) — authorization is only
  checked at `open()`, so a session that lost access must be forcibly disconnected
  (`docs/sharing.md:147-159`).

The gadget's UI code is served as the raw `client.js` text (`getGadgetUiBundle`) and executed
client-side in the sandboxed iframe (see [the gadget-iframe page](/openwiki/frontend/gadget-iframe.md)).

## The gadget DO and persistent stubs

`server.js` exports a class extending `DurableObject`; `connectToGadget()` hands clients a stub to
the running facet (wrapped in a Proxy because facet stubs can't cross RPC directly — see the RPC
page). Gadgets that register **hooks** create persistent callback stubs via `ctx.restore(params)`,
<!-- openwiki: broken internal link [params] file "params" does not exist. Fix the href or restore the target, then delete this comment. -->
which calls the gadget's own `[restore](params)` method; the params must be serializable, and the
agent can forge such stubs on a gadget's behalf via the executeCode-only restore-forger capability
(`agent.ts:727-776`; `overseer.ts:7320-7325`).

## Gadget console logs

Every gadget worker carries a `GadgetTailLoopback` tail with props identifying the overseer,
gadget, and chat; it delivers console logs to the product UI in real time (and is told not to
`console.log` the events themselves, which would spam wrangler dev)
(`overseer.ts:4006-4025`, `8912-8931`).

## Exports

Two export modes exist (`packages/workshop-backend/src/gadget-export.ts`):

- **Default formats**: `html` and `pdf`, both `mode: "browser"` (`gadget-export.ts:78-98`).
- **Custom formats**: a gadget may export an `ExportHandler` entrypoint listing its own formats;
  the returned metadata is validated against a schema, and a missing entrypoint cleanly falls back
  to the defaults (`gadget-export.ts:7-15`, `110-133`).

Browser-mode exports render the gadget in a **headless browser** via the `BROWSER` Puppeteer
binding (`renderGadgetInBrowser`, `browser-export.ts:162-196`). The export document is served
through request interception from a synthetic URL with a strict CSP header (a meta CSP would be
ignored in the sandbox context), with connect-src 'none' and `sandbox allow-scripts`; exports run
under deadlines and byte caps (`export-limits.ts`), and the client code talks to the gadget's own
server through an RPC session the export harness provides — the same capability model as the
iframe, minus the network.
