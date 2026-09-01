---
type: "Reference"
title: "Workshop Backend Kernel"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-7d998e90fa57b94a489f8a64
    resource: repo://packages/workshop-backend/src/access.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-cc617cac997161f6d93b8947
    resource: repo://packages/workshop-backend/src/do-retry.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---


# Workshop Backend Kernel

`packages/workshop-backend` is the kernel package — every line is reviewed (see
[Architecture Overview](./overview.md#the-kernel-bar)). It is one Cloudflare Worker whose
entrypoint module exports the HTTP handler plus every Durable Object (DO) and `WorkerEntrypoint`
class that wrangler binds (packages/workshop-backend/src/server.ts#L14-L66).

## Fetch routing

The `fetch` handler dispatches by path (packages/workshop-backend/src/server.ts#L795-L885):

- `/api` → the Cap'n Web session endpoint (WebSocket or batched POST,
  [RPC and Shared API](./rpc-and-shared-api.md)). Each `/api` request first fires a one-time
  idempotent install of the bundled format blueprints into the `AdminSettings` DO — "a fresh
  deployment is provisioned by its first visitor" — with explicit retry-on-failure bookkeeping
  (packages/workshop-backend/src/server.ts#L816-L845).
- `/api/client-errors` → the frontend error-reporting endpoint
  (packages/workshop-backend/src/server.ts#L812-L814; see
  [Observability](../operations/observability.md)).
- `/blueprint-screenshot/*` → screenshot serving; site logo path is served separately.
- Everything else 404s in standalone mode; in production the *router* package fronts this worker
  and serves assets (packages/router/src/index.ts#L36-L44).

If `CF_ACCESS_AUD` is configured, requests must be same-origin and carry a verified Cloudflare
Access JWT whose email claim is present, verified remotely against the team's JWKS
(packages/workshop-backend/src/server.ts#L847-L860; packages/workshop-backend/src/access.ts#L13-L25).

## Sessions and login

- A session token is `username:secret`; `authenticate()` derives the user id with
  `users.idFromName(username)`, and the user DO checks the secret as a SHA-256 hash of the token
  against its stored sessions, mapping any bad/corrupt token to `AUTH_ERROR_CODES.invalidSessionToken`
  (packages/workshop-backend/src/server.ts#L681-L695; packages/workshop-backend/src/user.ts#L304-L320).
- The user DO is keyed by name — username/password accounts by username, Access and
  gatekeeper-OAuth sign-ins by **verified email** (`idFromName(email)`), so the same email across
  providers resolves to one account (packages/workshop-backend/src/user.ts#L402-L406).
- Gatekeeper sign-in (`startGatekeeperLogin`) creates a short-lived `PendingLogin` DO as the
  rendezvous between the browser RPC and the separate OAuth-callback invocation (the callback
  lands on the gatekeeper worker at `/gatekeeper/<name>/oauth`, never on the backend); the client
  only receives a `LoginAttemptImpl` wrapper whose `wait()` blocks on the DO
  (packages/workshop-backend/src/server.ts#L652-L679, packages/router/src/index.ts#L41-L43,
  migration v2 at packages/workshop-backend/wrangler.jsonc#L53-L57). Signing in with Cloudflare is
  the exception that requests "full"/billing scopes up front to link AI Gateway billing
  (packages/workshop-backend/src/server.ts#L664-L671).
- Password auth can be disabled (`DISABLE_PASSWORD_AUTH=true`) only while at least one auth
  gatekeeper is allowlisted — otherwise the flag is ignored to avoid locking everyone out
  (packages/workshop-backend/src/auth/config.ts#L24-L33).
- Session abort is implemented by closing the WebSocket ("HACK"), via an `abortSignal`-extended
  clone of capnweb's `newWorkersRpcResponse` (packages/workshop-backend/src/server.ts#L857-L864,
  L875-L913).

## Durable Object topology

All DO classes are reached through `ctx.exports` — no explicit `durable_objects` binding needed
(packages/workshop-backend/wrangler.jsonc#L62-L63). The core actors:

| Object | Scope | Responsibilities |
| --- | --- | --- |
| `UserDurableObject` (user.ts#L282) | per user | profile, password hash hash, session tokens, connected gatekeeper accounts, model configs, workspace list; **the `getGatekeeperClassFor()` chokepoint** |
| `OverseerDurableObject` (overseer.ts#L8204) | per workspace | gadgets, chats, git object store, gatekeeper sessions, agent runs ([Agent Runtime](./agent-runtime.md), [Gadgets & Code](./gadgets-and-code.md)) |
| `AdminSettings` (admin-settings.ts) | singleton | sole writer of `AdminConfig`, mirrored to one reserved KV key ([Configuration](../operations/configuration-and-admin.md)) |
| `PendingLogin` (auth/login-flow.ts) | per login attempt | bridges the OAuth callback to the waiting browser |

The user DO builds its vendor map from the `GATEKEEPER_*` service bindings and stores connected
accounts as records holding the account *capability* (`Fetcher<GatekeeperUser>`) plus description
and expiry bookkeeping; auto-provisioned accounts are protected from manual disconnect because
deleting one destroys the user's gatekeeper-side data (packages/workshop-backend/src/user.ts#L24-L46,
L284-L302). Credential expiry is pushed to the DO via `markCredentialsExpired` /
`markCredentialsRestored` (packages/workshop-backend/src/user.ts#L1650-L1665).

`getGatekeeperClassFor()` in the user DO is *the* core-side chokepoint where a resource URL becomes
a capability: it re-reads the admin config and rejects disabled gatekeepers and disabled resource
types even if the caller bypassed the (separately filtered) listings, and it is reachable only via
the user/UI-facing `Overseer.newGatekeeper` and blueprint instantiation — never from gadget or
agent code (packages/workshop-backend/src/user.ts#L1666-L1690). See
[Capability Security Model](../security/capability-security-model.md).

## Loopback entrypoints

Dynamic workerd isolates (gadget workers, executeCode workers) can hold `ServiceStub`s in their
`env` but not `RpcStub`s. The overseer therefore exposes a family of `WorkerEntrypoint`s whose
constructor resolves the live target from props and returns a Proxy — "Horrible hack" is the code's
own description (packages/workshop-backend/src/overseer.ts#L8756-L8789):

- `GatekeeperLoopback` — a binding slot that resolves `startGatekeeperSession(target, caller)` on
  every method call.
- `GatekeeperHookLoopback` — the `HookInitiator` handed to gatekeepers with connected hooks
  (packages/workshop-backend/src/overseer.ts#L8802-L8810).
- `AgentSelfLoopback` — the `self` object for executeCode callbacks
  (packages/workshop-backend/src/overseer.ts#L8839+).
- `TransientStubLoopback` — forwards to an in-memory overseer stub that expires when its
  delivering RPC ends (packages/workshop-backend/src/overseer.ts#L8878-L8897).
- `GadgetTailLoopback` / `CodeModeTailLoopback` — tail workers delivering console/trace streams.

## Durable Object resets

DO reset rejections carry workerd-attached flags: `retryable`/`overloaded` describe *this call hop*
(from the KJ exception type), while `durableObjectReset` describes *the object* whose incarnation
died, poisoning every stub to it — the production storage-timeout reset is
`{remote, overloaded, durableObjectReset}` with **no** `retryable`, so message matching is unsafe
and flags are authoritative (packages/workshop-backend/src/do-retry.ts#L1-L15). Policy:
`retryOnDoReset` retries **only pure-read delegations once** ("writes never do")
(packages/workshop-backend/src/server.ts#L120-L121), and `wrapDoStubForTelemetry` proxies a stub to
surface resets for telemetry while rethrowing unchanged, invoking methods through the stub itself
because native RPC method handles are themselves proxies
(packages/workshop-backend/src/do-retry.ts#L34-L50). `AuthenticatedApiImpl` deliberately creates a
fresh user-DO stub per request rather than caching one
(packages/workshop-backend/src/server.ts#L93-L97).

## Storage and bindings

Per the package's `wrangler.jsonc`: `nodejs_compat` (capnweb, @google/genai, puppeteer), a
`BROWSER` binding for exports, `BLUEPRINTS`/`AVATARS` KV namespaces, `BLUEPRINT_CONTENT` R2, and a
`LOADER` worker-loader binding that runs gadget/agent code (packages/workshop-backend/wrangler.jsonc#L26-L86).
Gatekeeper service bindings and Workers AI are injected dynamically by the dev-server script and
the production wrangler generator (packages/workshop-backend/wrangler.jsonc#L41-L44).
State layout is covered in [Persistence and Blueprints](../data/persistence-and-blueprints.md).
