---
type: "Reference"
title: "Shared API and Cap'n Web RPC"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-567e8af8974648e0754d5d1f
    resource: repo://packages/workshop-shared/src/code-change.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---


# Shared API and Cap'n Web RPC

`packages/workshop-shared` defines the entire application's RPC contract. It is not a runtime
package of its own — it exports TypeScript interfaces and constants that both the frontend and the
backend implement. Because the kernel ("every line" in `workshop-backend`, plus API changes in
`workshop-shared`) is reviewed carefully, shared API additions carry a high bar: doc-comment every
exported memberchers, never hand-write an interface that mirrors an RPC interface plus an
`as unknown as` cast, and prefer reusing existing mechanisms (`AGENTS.md`).

The API is split into named module exports: `api`, `gatekeeper`, `code-change`, `feature-flags`,
`limits`, `theme`, `cloudflare-gatekeeper`, `external-message-gateway`
(`packages/workshop-shared/package.json` `exports`).

## The capability hierarchy

`src/api.ts` defines the top-level capability interfaces:

- `PublicApi` — the unauthenticated surface (`ping`, `getServerConfig`,
  `startGatekeeperLogin`, `authenticate`, `authenticateFromCfAccess`, `login`, `createAccount`,
  blueprint lookups).
- `AuthenticatedApi` — everything a signed-in user can do (profile, models, gadgets, connected
  accounts, gatekeeper apps, admin capability), obtained by calling `authenticate`/`login`.
- `Overseer` — the per-workspace capability returned by `openGadget`/`newGadget`, exposing the
  gadget's chat, code, gadgets, gatekeepers, sharing, approvals, and presence
  (`src/api.ts:360`).

The connection model is described in the file's opening comment: the entire API is RPC over a
WebSocket the client opens at startup and keeps open for the whole session, reconnecting if needed;
gadgets speak RPC from a sandboxed iframe over `postMessage` (`src/api.ts:14`).

Because these are Cap'n Web interfaces, `openGadget` returns a promise that can be used directly as
an `Overseer` stub (pipelining), and `getAdminApi()` returns a capability stub whose access check
happens once when minted — so its methods need no per-call authorization checks (`src/api.ts:706`).

## Cap'n Web conventions

The project's `AGENTS.md` codifies three protocol conventions:

1. **`@validateRpc()`** — all RPC interfaces are annotated to install auto-generated runtime type
   validation matching the interfaces' TypeScript signatures. Do not write redundant validation.
2. **Promise pipelining** — if an RPC returns a stub, no `await` is needed; use the promise
   directly in another call. Cap'n Web also lets you use a promise for a future result in the
   arguments of another call; it replaces the promise with its resolution server-side before
   delivering arguments.
3. **Stub disposal** — RPC stubs must be disposed (`stub[Symbol.dispose]()`) when no longer needed
   to prevent server-side resource leaks. In React components that obtain a stub in `useEffect`,
   the cleanup should dispose it. (A `using` declaration works where possible.)

(These are general conventions established by the workspace docs; the capnweb dependency is a
catalog entry in `package.json` with its own README referenced by `AGENTS.md`.)

## Error-code families

`src/api.ts` builds **stable machine-readable error codes** through a small `codedErrorFamily`
helper (`src/api.ts:301`). Families are defined per operation domain:

- `OPEN_GADGET_ERROR_CODES` — `WORKSPACE_NOT_FOUND` / `WORKSPACE_ACCESS_DENIED`, with
  `createOpenGadgetError` / `getOpenGadgetErrorCode` (`src/api.ts:315`).
- `AUTH_ERROR_CODES` — `INVALID_SESSION_TOKEN` / `NOT_AUTHENTICATED_WITH_ACCESS`, with
  `createAuthError` / `getAuthErrorCode`. Messages double as the classification fallback for older
  deployments that lost the code in transit, so changing a message is a compatibility break
  (`src/api.ts:336`).

## Binding-name validation

`validateBindingName()` (`src/api.ts:207`) is the **one shared validator** applied at every
chokepoint that writes a binding name: gadget binding edges, the workspace default binding list,
chat binding maps, spawner env configs, and agent tools. It rejects anything that is not a JS
identifier, excludes ECMAScript reserved words, and rejects dangerous/confusing property names that
would collide with inherited members on plain-object binding maps (e.g. `__proto__`,
`constructor`). `ALL_CAPS_WITH_UNDERSCORES` is style guidance only, not enforced
(`src/api.ts:177`).

## Code-change wire types

`src/code-change.ts` is the single owner of the operational-transform representation of uncommitted
code changes. Its invariants live only here: the wire types, application, composition,
transformation, diffing, ingestion validation, and the priority convention.

- Wire types are plain-JSON and self-describing: `TextChange` is a `ChangeSet`-shaped section list,
  `FileChange` is `{edit} | {set} | {remove}`, and `CodeChange` maps canonical gadget ids to a list
  of `[path, FileChange]` (`src/code-change.ts:56`).
- The text-OT core is `@codemirror/state`'s ChangeSet; `fast-diff` is used for change generation.
  Both are private to this module so the invariants stay in one place (`src/code-change.ts:14`).
- **Priority convention**: for two concurrent changes against the same revision, the change the
  server ordered earlier comes first — identical to ChangeSet's transform law
  (`src/code-change.ts:37`).
- **Trust boundary**: `validateCodeChangeSchema` runs *before* any transform; `validateCodeChangeContent`
  runs *after* transforming to the server's current revision. The stages must stay in this order
  (`src/code-change.ts:49`).
- Gadget entries are a list, not a path-keyed object, because paths can be any non-empty string —
  including names like `__proto__` that would be deleted by Cap'n Web's deserializer if used as
  object keys (`src/code-change.ts:78`).

## Validation philosophy

RPC edge types are established by capnweb-validate at the RPC boundary and by the compiler for
in-process producers (`src/code-change.ts:45`). The validation stages check invariants a TS type
cannot express — canonical gadget keys, path rules, size caps, integer section lengths — rather
than re-checking structural object validity. Validation's resource-exhaustion goal is deliberately
modest: reject anything the caps rule out in at most one linear pass, because a change producer who
can edit the workspace can already burn its CPU, and the isolate memory limit bounds the blast
radius (`src/code-change.ts:53`).

## Gatekeeper contract

`src/gatekeeper.ts` defines the RPC surface between the Workshop and each adapter/gatekeeper. The
root interface is `GatekeeperVendor` (the service binding), with connected `GatekeeperUser`
accounts minting verification via `GatekeeperUserVerifier`, and per-resource `Gatekeeper` /import
facets exposing actions and observations (see [Gatekeepers: The Capability-Security
Model](/openwiki/architecture/the-gate-by-model.md)). It also carries bounded discovery metadata
(`AgentCatalogEntry` / `AgentCatalog`) that is injected into the agent as untrusted, size-capped
data (`src/gatekeeper.ts:89`).
