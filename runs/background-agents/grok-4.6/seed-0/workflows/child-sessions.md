---
type: workflow
title: Child Sessions
description: Agent-spawned child coding sessions with MAX_SPAWN_DEPTH 2, concurrent and total caps, D1 admission leases, parent/child correlation, and sandbox tools that call the control plane.
tags: [child-sessions, spawn, sandbox-tools, admission-lease]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-ad15a302aac7be1dd07e9481
    resource: repo://packages/control-plane/src/db/session-index.ts
  - id: openwiki-source-e62321bf9fba07278ede2272
    resource: repo://packages/control-plane/src/routes/session-child-spawn.ts
  - id: openwiki-source-1e4e79e91fd32e0d86040be7
    resource: repo://packages/control-plane/src/routes/session-children.ts
  - id: openwiki-source-b394b589cde2e47c93865bd9
    resource: repo://packages/control-plane/src/session/spawn-context.ts
  - id: openwiki-source-83e7f86783bb9f7ca65a64bf
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/child_activity.py
  - id: openwiki-source-27106ae89a994f574ee104f8
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/tools/cancel-child.js
  - id: openwiki-source-f8bb08bb17591f4b685d8bd7
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/tools/send-child-prompt.js
  - id: openwiki-source-96efdce4d527ae3383b7ec9a
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/tools/spawn-child.js
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Child Sessions

A child session is an ordinary coding session created **by an agent** from a parent sandbox. The parent continues; the child has its own Durable Object, sandbox, and prompt. The control plane is the authority for spawn, concurrency, and identity. Sandbox tools are a thin HTTP seam over that API.

Related: [Sessions and Workspaces](/openwiki/concepts/sessions-and-workspaces.md), [Sandbox Runtime](/openwiki/data-plane/sandbox-runtime.md), [Session Lifecycle](/openwiki/workflows/session-lifecycle.md).

## Agent-facing tools

OpenCode tools in `packages/sandbox-runtime/src/sandbox_runtime/tools/` call the sandbox HTTP bridge (`bridgeFetch`). They never talk to D1 or Durable Objects directly.

| Tool | Bridge | Control-plane route |
| --- | --- | --- |
| `spawn-child` | `POST /children` | `POST /sessions/:id/children` |
| `send-child-prompt` | follow-up on a **direct** child | `POST /sessions/:id/children/:childId/prompt` |
| `get-child-status` | list or detail | `GET /sessions/:id/children`, `GET /sessions/:id/children/:childId` |
| `cancel-child` | cancel; nested by default | `POST /sessions/:id/children/:childId/cancel` |

`spawn-child` is only for an explicit user request to create a child session. In-process Task/sub-agent work must use OpenCode's Task tool, not a second sandbox. The child inherits **repository**, not conversation; the prompt argument is the child's entire context.

HTTP 403 is depth or repository restriction; 429 is a concurrency or total cap.

## Spawn API (control plane)

`handleSpawnChild` (`packages/control-plane/src/routes/session-child-spawn.ts`):

1. Require `title` and `prompt`.
2. Load parent from D1. Children inherit the parent's settings **scope** (primary repo plus environment overrides).
3. **`MAX_SPAWN_DEPTH = 2`**: if `getSpawnDepth(parentId) >= 2`, return 403. A root session is depth 0; its children are 1; grandchildren are 2; great-grandchildren are forbidden.
4. If `countTotalChildren(parentId) >= maxTotalChildSessions` (sandbox setting, default `DEFAULT_MAX_TOTAL_CHILD_SESSIONS`), return 429.
5. Fetch parent `GET /internal/spawn-context` from the parent Durable Object. `spawnContextSchema` is **scalar**: `repoOwner` / `repoName` / `repoId` are the parent's **primary** repository even for multi-repo parents. v1 children are single-repo by design.
6. Optional `body.repoOwner`/`repoName` must both be present and **equal** the parent's primary; you cannot add a repo to a repo-less parent or retarget another repository (403).
7. Model must be valid and enabled; reasoning effort must match the model. Defaults come from spawn context.
8. Copy parent provider auth with `inheritedFromSessionId`.
9. `initializeSession` with:
   - `parentSessionId: parentId`
   - `spawnSource: "agent"`
   - `spawnDepth: parentDepth + 1`
   - parent's `automationId` / `automationRunId` if any
   - `managedSkillsSourceSessionId: parentId`
   - prompt author and SCM tokens from spawn context
10. Enqueue the initial prompt on the **child** Durable Object with `source: "agent"`.
11. Best-effort notify the parent (`/internal/child-session-update`) that the child was created.

Routes use sandbox-fallback auth (`GITHUB_SANDBOX_FALLBACK_ROUTE`): the parent's sandbox Bearer token is the caller.

## Admission leases

Concurrent cap is `maxConcurrentChildSessions` from sandbox settings (`DEFAULT_MAX_CONCURRENT_CHILD_SESSIONS` when unset). Counting only D1 `sessions` rows is racy: two spawns can both see "room" before either insert.

`SessionIndexStore.acquireChildAdmissionLease` inserts into `child_admission_leases` only when active children **plus unexpired leases** are below the cap. TTL is `CHILD_ADMISSION_LEASE_TTL_MS` (5 minutes). Spawn holds the lease across `initializeSession` and releases it on success or failure. Follow-up prompts to a **completed/failed** child re-acquire a lease (resume counts as concurrent); cancelled/archived children cannot resume.

A transport error after the child may have accepted a prompt **keeps** the lease until expiry rather than undercounting.

## Parent / child correlation in the sandbox

`ChildActivityCorrelator` (`child_activity.py`) binds child session ids to the parent's OpenCode Task `call_id` so streaming events from the child attach to the right tool. Pending child messages/errors queue up to `MAX_PENDING_CHILD_ACTIVITY` (2000) until the Task association exists; overflow is dropped.

The parent UI learns about children via Durable Object notifications and D1 `listByParent`. Cancel with `cancelNested` (default true) cancels active descendants (depth walk capped at `MAX_DESCENDANT_DEPTH` 10).

## Invariants

- Control plane, not the sandbox, enforces depth, totals, concurrency, and repo identity.
- Children cannot widen repository access beyond the parent's primary.
- `spawnSource` for this path is `"agent"` (distinct from `"user"`, `"automation"`, bot services).
- Depth 2 is a hard 403, not a setting.
- Leases + active-session union is the concurrency source of truth.

## Extension seams

- Multi-repo children would need `spawnContext.repositories` (design §13.13), not a silent extra field on the spawn body.
- New agent operation: add a sandbox tool + control-plane child route that still goes through leases and `isChildOf`.

## Focused tests

- Spawn depth, repo pin, model, lease: `packages/control-plane/src/router.spawn-child.test.ts` and integration D1 lease tests in `test/integration/d1-session-index.test.ts`
- Spawn context schema: `packages/control-plane/src/session/spawn-context.ts`
- Child prompt/cancel: `packages/control-plane/src/routes/session-children.ts` neighboring tests
- Tools: `packages/sandbox-runtime` tests covering spawn-child / correlator
