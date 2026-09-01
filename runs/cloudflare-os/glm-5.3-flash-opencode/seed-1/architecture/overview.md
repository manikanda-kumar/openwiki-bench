---
type: "Reference"
title: "Architecture Overview: Kernel, Gatekeepers, and the Worker Topology"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-64b029899e771aec2fb6dfef
    resource: repo://packages/workshop-backend/src/external-message-gateway.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# Architecture Overview: Kernel, Gatekeepers, and the Worker Topology

Cloudflare OS (the "Gadgets Workshop") is a pnpm monorepo of Cloudflare Workers packages. It is described — accurately, not just as marketing — as an operating system: the backend is a kernel that connects users to programs (gadgets) and devices (gatekeepers) while sandboxing the programs and enforcing access control. The mapping the project itself draws is: kernel = `packages/workshop-backend`, device drivers = `packages/gatekeeper-*`, shell = `packages/workshop-frontend`, processes = gadgets, executables = blueprints (README.md:97-110).

## Package map and ownership boundaries

| Package | Role |
| --- | --- |
| `workshop-backend` | The kernel: auth, user accounts, workspaces, the agent, sharing, approvals, blueprints, admin settings (REVIEW.md) |
| `workshop-shared` | The RPC API definitions shared by client and server (`api.ts`, `gatekeeper.ts`, `code-change.ts`) |
| `workshop-frontend` | The SPA shell — React, Kumo UI, Phosphor icons, Vite; pure client-side |
| `router` | The public origin worker: serves frontend assets and routes by path prefix |
| `gatekeeper-*` | One independent Worker per external service integration (GitHub, Google, Slack, Context Library, ...) |
| `mcp-shared` | Library behind the two MCP-speaking gatekeepers |
| `typed-storage`, `backend-utils`, `error-reporting`, `configurator-ui` | Support libraries (storage schema layering, logging, error reporting, configurator UI types) |
| `integration-tests` | End-to-end tests driving real workers over the real RPC transport |

`workshop-backend` and the API surface of `workshop-shared` are held to a higher review bar than UI code — REVIEW.md requires doc comments on every exported member of the `workshop-shared` public API, rejects hand-written interfaces that mirror RPC interfaces (with `as unknown as` casts), and asks that changes be split by concern so the kernel diff stays small. A gatekeeper resource only becomes "ambient" (auto-injected) by user/admin configuration; gatekeeper code must never assert its own ambience, and `getGatekeeperClassFor()` in `packages/workshop-backend/src/user.ts` is the single chokepoint where disabled gatekeepers and resources are enforced before a capability is minted (REVIEW.md, "High-scrutiny areas" / "Capability-based security").

## The worker topology

### The router: public origin

`packages/router/src/index.ts` is the deployment's public origin. Its routing configuration *is* the gatekeeper set: on every request it scans its own environment for keys starting with `GATEKEEPER_` and forwards `/gatekeeper/<name>/*` paths to the matching service binding (router/src/index.ts:24-35). Installing a gatekeeper is therefore purely a binding change — no router code or config edits (router/src/index.ts:3-6). `/api/*` and `/blueprint-screenshot/*` go to the `WORKSHOP_BACKEND` binding; everything else is served from the `ASSETS` binding (the built frontend) in production, or falls through to the backend in dev when there is no assets binding (router/src/index.ts:37-59). The same worker also has an `email()` handler that forwards inbound mail to `GATEKEEPER_EMAIL` (router/src/index.ts:62-68), and gatekeeper OAuth redirects land on the gatekeeper workers themselves at `/gatekeeper/<name>/oauth` — the backend hosts no `/auth/*` callbacks (router/src/index.ts:43-45).

### The backend: one worker, several Durable Object classes

`packages/workshop-backend` is the kernel worker. Its default `fetch` handler (src/server.ts:794-873) serves the site logo, blueprint screenshots, `/api/client-errors`, and — for `/api` — a Cap'n Web RPC session over WebSocket or HTTP batch POST, rooted at `PublicApiImpl` (src/server.ts:866-869). All Durable Object classes are reached through `ctx.exports` and need no explicit `durable_objects` binding (wrangler.jsonc comment near the migrations block; src/server.ts:83-90).

The Durable Object classes (declared with SQLite storage in migrations v0–v2, wrangler.jsonc):

- **`UserDurableObject`** (src/user.ts:282) — one per user, *addressed by name*: `users.idFromName(username)` for password accounts and `idFromName(email)` for Cloudflare Access / gatekeeper sign-in (src/server.ts:686, 702). Owns the profile, session-token hashes, the gadget list, configured AI models, blueprint library, and connected gatekeeper accounts.
- **`OverseerDurableObject`** (src/overseer.ts:8204) — one per workspace, created with `newUniqueId()` (src/server.ts:284, 446). Owns everything about one workspace: the workpiece registry, gadget code as git objects, chat logs, the action/approval log, sharing, observers, and blueprints. It instantiates gadget code and gatekeeper sessions as **facets** of itself (`this.ctx.facets`, src/overseer.ts:4075, 4262).
- **`AdminSettings`** — a singleton reached with `getByName("")` (src/server.ts:599, 823). Owns the deployment's `AdminConfig` and mirrors it to a reserved KV key.
- **`PendingLogin`** — a short-lived rendezvous DO bridging a gatekeeper OAuth pop-up back to the waiting browser (src/server.ts:663-664; created with `newUniqueId()`, no durable storage).
- **`ExternalMessageGateway`** — a `WorkerEntrypoint` exported as a service-binding entrypoint for external channel integrations; it resolves the target workspace by a source-prefixed key and calls `receiveExternalMessage` on the Overseer (src/external-message-gateway.ts:22-28).
- **`LanguageModelGatekeeper`** (src/ai-models.ts) — the entrypoint behind AI-model bindings.

### Gadgets and gatekeepers as facets of the workspace DO

Gadget code does not run in its own deployed worker. The Overseer loads each gadget's *committed* (or chat-proposed) files into a **dynamic worker** through the `LOADER` worker-loader binding (wrangler.jsonc `worker_loaders` stanza; src/overseer.ts:3978-4027), with `globalOutbound: null` so the worker has no internet access, and then exposes the worker's `Gadget` Durable Object class as a named facet (`gadget${id}`) via `ctx.facets.get` (src/overseer.ts:4064-4082). Gatekeeper sessions are facets too (`gatekeeper${id}`, src/overseer.ts:4262), created from the gatekeeper's class obtained through the user's connected-account capabilities. Loopback entrypoints (`GatekeeperLoopback`, `GadgetTailLoopback`, `CodeModeTailLoopback`, `AgentSelfLoopback`, `TransientStubLoopback`, re-exported from src/server.ts:56-59) let sandboxed code call back into the overseer in a controlled way — for example, gadget workers get a `GadgetTailLoopback` tail entrypoint for logging (src/overseer.ts:4025).

### Gatekeepers: separate workers, service bindings

Each `packages/gatekeeper-*` is a fully independent Workers application, provided to the Workshop as a service binding and spoken to over JavaScript RPC (packages/workshop-shared/src/gatekeeper.ts:14-17). The Workshop discovers vendors by scanning its `GATEKEEPER_*` bindings (`buildGatekeeperVendorMap`, src/user.ts:301); the router uses the same naming convention for routing. Gatekeepers handle OAuth themselves, own their own Durable Objects, and present capability-based access to external resources.

## Request entry points

- `GET /` and everything else → frontend assets (router ASSETS binding, or backend in `run-local` mode).
- `/api` → Cap'n Web RPC: `POST` batch or WebSocket upgrade (src/server.ts:866-902). When the deployment uses Cloudflare Access (`CF_ACCESS_AUD`), cross-origin calls are rejected, the JWT is verified, and the verified email rides into `PublicApiImpl` (src/server.ts:840-855).
- `/api/client-errors` → frontend error-report ingest, active only when the `FRONTEND_ERROR_REPORTER`/`FRONTEND_ERROR_RATE_LIMITER` bindings exist (src/server.ts:812-814).
- `/blueprint-screenshot/<id>` → screenshot bytes from R2 (src/server.ts:802-805).
- `/gatekeeper/<name>/*` → the named gatekeeper worker (router binding scan), including its OAuth callback and management UIs.
- `email()` → `GATEKEEPER_EMAIL` (router/src/index.ts:62-68).

The first `/api` request on a fresh deployment also triggers (fire-and-forget, idempotent) installation of the bundled format blueprints into `AdminSettings` (src/server.ts:816-838).

## Where the boundaries bite

- The client never talks to gatekeepers or Durable Objects directly: the SPA speaks Cap'n Web over one persistent WebSocket to `PublicApi`, and everything past authentication flows through capabilities handed back over that session (src/server.ts:75-601; see [The Cap'n Web RPC API Contract](/openwiki/architecture/rpc-api.md)).
- Gadget code (server and client) can reach only what is explicitly bound into its environment — the server worker is loaded with no outbound internet, and the client runs in a sandboxed iframe limited to `postMessage` (README.md:158-162; see [The Gadget Sandbox](/openwiki/workshop/gadget-sandbox.md)).
- Persistence is layered: DO SQLite storage via `typed-storage` for state, KV for small global lookups, R2 for blueprint content (see [Persistence](/openwiki/architecture/persistence.md)).
- The observability stack (Workers Logs/Traces, head sampling) is enabled in wrangler.jsonc's `observability` stanza.
