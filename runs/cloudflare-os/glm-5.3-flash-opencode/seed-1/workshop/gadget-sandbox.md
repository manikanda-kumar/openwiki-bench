---
type: "Reference"
title: "The Gadget Sandbox: Dynamic Workers and the Client Iframe"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# The Gadget Sandbox: Dynamic Workers and the Client Iframe

Every gadget runs in a dual sandbox: its server code in a network-disabled dynamic worker, its client code in a fully sandboxed iframe. "The server runs in a Dynamic Worker which has had its access to the internet disabled. It can only communicate with specific external resources that you have explicitly designated, via Workers Bindings. The client code runs in a sandboxed iframe… otherwise blocked from accessing the internet (to the maximum extent allowed by browsers, via Content-Security-Policy and iframe sandbox settings)" (README.md:158-162).

## Server side: the dynamic worker

`loadGadgetWorker(gadgetId, chatId?)` (src/overseer.ts:3958-4027) builds a `WorkerLoaderWorkerCode` and loads it through the `LOADER` worker-loader binding with a cache key of `${overseerId}.${codeVersion}[.${chatId}.${sequence}].${gadgetId}`:

- **Modules**: the gadget's committed files (from `gitStore.readCommitFiles(head)`) or, in chat context, the chat's content as of the snapshotted sequence (`buildChatContent`) — only `.js` files become modules, with `server.js` as `mainModule`.
- **`globalOutbound: null`** — the worker's global `fetch` is disabled entirely; it reaches the world only through its `env` bindings.
- **`compatibilityFlags`**: `allow_irrevocable_stub_storage` (makes `ctx.restore()` available).
- **`env`** from `getEnvForLoader(gadgetId, caller, chatId?)`: `GADGET` (a loopback to the gadget's own facet) plus every visible binding edge as a gatekeeper loopback (src/overseer.ts:2734-2742). Bindings validate through `validateBindingName`; entries whose targets no longer exist are skipped (src/overseer.ts:2748-2792 — the agent-env variant, which must be a *plain object* because the loader's serializer rejects others, with prototype-pollution safety coming from the name validator instead).
- **`tails`**: a `GadgetTailLoopback` entrypoint delivering console logs to the UI in real time (src/overseer.ts:4006-4026).

Cache invalidation is deliberate: head movement invalidates committed loads (every merge bumps `codeVersion`), chat-context loads key on the chat's snapshotted sequence so a merge landing mid-load cannot flip the doc out from under the key, and chat↔mainline switches abort the facet via `ctx.facets.abort` when the running chat changes (src/overseer.ts:3964-3985, 4046-4073; `proposedChangesChanged` restarts facets when a chat's proposals change, src/overseer.ts:2798-2805).

The worker's `Gadget` Durable Object class becomes the per-gadget facet (`gadget${id}`) via `ctx.facets.get`; facet stubs can't cross RPC, so they are wrapped in a Proxy marked as a hack (src/overseer.ts:4075-4109).

## Persistent stubs and the restore-forger

<!-- openwiki: broken internal link [params] file "params" does not exist. Fix the href or restore the target, then delete this comment. -->
A gadget registers durable callbacks (hooks) with `ctx.restore(params)`: the gadget implements a symbol-named `[restore](params)` method, and `ctx.restore` returns a *persistent* stub that can be stored in Durable Object storage and re-created later by calling `[restore]` with the same params (gatekeeper.ts:968-1030 documents the pattern; agent.ts:727-776 shows it in the system prompt's example).

Because a *chat's* `executeCode` needs to forge such stubs against a gadget it doesn't own, the overseer loads a one-off **restore-forger** worker whose `forge(params)` calls `this.ctx.restore(params)` while pretending to be the target gadget — "this worker's self-token names the target gadget; the persistent stubs its forge() method creates therefore restore through that gadget's [restore]() method" (src/overseer.ts:108-155). The capability is handed **only to executeCode runs, never to gadget workers**, as a transient stub argument to the harness's `run()`, with binding names resolved overseer-side — "the capability conveys no authority beyond the env it accompanies" (src/overseer.ts:187-211). Until a runtime API for unsealing exists, the forger returns a placeholder that throws if called but becomes the real stub once stored and read back (src/overseer.ts:121-154).

## The code-mode harness (executeCode)

An `executeCode` call loads a separate dynamic worker (src/overseer.ts:7260-7310):

- `harness.js` is the built-in `CODE_MODE_HARNESS`: it wires callback resolvers into `env` (each `PARAMS_<n>` gets `{args, resolve, reject}` so executed code can answer an agent callback), grafts the `restore` symbol onto each service-binding stub in env (only this execution's own bindings offer it), and runs the agent's code as `agent.js` with `(self, env, ctx)` (src/overseer.ts:69-106).
- Its own flags are stricter: `disallow_importable_env` (which also disallows importable `ctx.exports`, "to prevent the code from calling itself in a loop") plus `allow_irrevocable_stub_storage`, with `globalOutbound: null` and a `CodeModeTailLoopback` tail.
- `self` is the `AgentSelfLoopback` entrypoint described in [The AI Agent](/openwiki/workshop/agent.md).
- Startup is verified before running (`entrypoint.verify()`); startup errors are total failures.

## Client side: the sandboxed iframe

`GadgetUI.tsx` renders the gadget's `getUiBundle()` code inside an `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox">` (src/GadgetUI.tsx:493-503). The injected code (src/GadgetUI.tsx:14-103):

- Establishes the RPC session by `postMessage`ing a `"handshake"` with one end of a `MessageChannel`; the parent accepts and the gadget side runs `newMessagePortRpcSession(port1)` to get a stub to its own server-side DO (src/GadgetUI.tsx:28-33). Cap'n Web itself is injected as a *doubly-nested data URL* — the iframe is too sandboxed for regular script sources, so the module import carries a base64-encoded data URL of the capnweb bundle inside an outer URL-encoded data URL script (src/GadgetUI.tsx:14-27).
- Monkey-patches `console` to forward logs to the parent; captures uncaught errors and unhandled rejections as console errors; forwards `Escape` key presses (the sandboxed iframe captures keydown, so the parent never sees them).
- Blocks programmatic `window.open` ("window.open() is disabled in Gadget UIs. Use a link with target=\"_blank\" instead.") while a capture-phase click handler adds `noopener` to `target="_blank"` links (src/GadgetUI.tsx:35-60, 71-84).
- The generated HTML carries a strict CSP: `default-src 'none'; frame-src 'none'; script-src data: 'unsafe-inline'; style-src data: 'unsafe-inline'; img-src data:; media-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'` — notably `connect-src 'none'`, so the iframe itself cannot open any network connection at all (src/GadgetUI.tsx:105-116).

Lifecycle handling in the host: a 20s UI-bundle timeout offers retry instead of an endless spinner, load generations guard against superseded writes, the RPC session is disposed on unmount/reload, and a gadget change during the handshake aborts the load (src/GadgetUI.tsx:130-237).

## Why the sandbox matters

The combination means gadget code — written by AI or users — can only affect: its own files (through the overseer's code-change machinery), its explicitly bound resources (each mediated by a gatekeeper session whose reads are observations and whose writes are queued actions), and its own UI (through the postMessage RPC). It cannot reach the internet, other users' accounts, or the workshop's own API directly.
