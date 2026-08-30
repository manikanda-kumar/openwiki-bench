---
type: concept
title: Secrets, Managed Skills, and MCP Servers
description: Encrypted secret scopes injected as sandbox env vars, managed skills pinned at session create and materialized in-sandbox, and MCP server configs passed into OpenCode.
tags: [secrets, managed-skills, mcp, encryption]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-3babc3950feb797c71f905ef
    resource: repo://docs/MANAGED_SKILLS.md
  - id: openwiki-source-414d0a78dd85b57e3bed791a
    resource: repo://docs/SECRETS.md
  - id: openwiki-source-2e1968ff56e36a54c1f81991
    resource: repo://packages/control-plane/src/db/mcp-servers.ts
  - id: openwiki-source-475734dc9ffe03d69d908b54
    resource: repo://packages/control-plane/src/db/scoped-secrets.ts
  - id: openwiki-source-416a2efbd05cc2aaf16d47c6
    resource: repo://packages/control-plane/src/sandbox/lifecycle/manager.ts
  - id: openwiki-source-be6f702918320d7f795e0f66
    resource: repo://packages/control-plane/src/session/session-target-secrets.ts
  - id: openwiki-source-70c52cb3ffacdc2d38e0b10b
    resource: repo://packages/control-plane/src/session/skill-resolution.ts
  - id: openwiki-source-c559e81d571f588426903a18
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/managed_skills.py
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Secrets, Managed Skills, and MCP Servers

Three configuration layers reach a sandbox besides git and the model: **secrets** (env vars), **managed skills** (instruction files), and **MCP servers** (tools OpenCode can call). None of them is a permission boundary. A skill can tell the agent to use secrets and MCP already in the session. Review content before enabling it.

Values are never sent to the browser; the UI shows key names (and skill metadata) only. Encryption uses `REPO_SECRETS_ENCRYPTION_KEY` (AES-256, fail-closed). See [Security Model](/openwiki/concepts/security-and-auth.md).

## Secrets

Scoped stores (`global-secrets`, `repo-secrets`, `environment-secrets`) share `scoped-secrets.ts`: key normalization, per-scope caps, combined-value byte cap, duplicate-key rejection after normalize (`foo` vs `FOO`). All scopes encrypt with the same repo-secrets key.

### What a session receives

`buildSessionTargetSecretSources` is the policy (lowest precedence first):

| Session target | Sources |
| --- | --- |
| Single repository | global, then that repo |
| Ad-hoc multi-repo | global, then each member; **primary (position 0) merges last and wins** collisions |
| Environment | global, then **environment secrets only** |
| No repository | global only |

Environment-launched sessions **do not inherit repository secrets**, even for members of the environment. Environments are curated: a key added to a repo must be imported (copy) or moved to global. OAuth secret **scope** for provider tokens follows the same split (`environment` vs `repo` vs none) in `resolveSessionOAuthSecretScope`.

Repo/environment keys override global keys of the same name. `SECRETS_CAP_ENFORCEMENT` (default `enforce`) fails spawn/build when the merged payload is oversized; `warn` only logs.

Secrets become sandbox environment variables at spawn. Managed OAuth refresh tokens are **not** in this map — they are brokered. See [Models and Provider Accounts](/openwiki/features/model-providers.md) and `docs/SECRETS.md`.

## Managed skills

Shared skills are installation-wide instruction packs (name, description, files, assignments to global / repos / environments). Personal **profiles** store a preferred subset for one user; they never bypass disabled state or assignment scope.

`resolveManagedSkills` runs at session create **before** the sandbox exists:

1. List skills applicable to the target (repos + `environmentId`)
2. Selection: all applicable, none, or a profile owned by the canonical user (403 without a user; 404 if the profile is missing)
3. Retry up to 3 times if `catalogGeneration` changes mid-read so the digest never mixes catalog generations
4. Enforce `MAX_MANAGED_SKILL_MANIFEST_BYTES` on **total content bytes**, not skill count (a count cap would fail every session when global skills grew)
5. Persist `SessionSkillManifestInput` (selection, `resolverVersion`, `manifestSha256`, resolved revision ids)

Editing the catalog later does not change an existing session’s pinned revisions.

The sandbox `ManagedSkillsMaterializer` fetches those revisions with the sandbox token (paged, hashed, size-capped) into OpenCode’s global skills directory **once per boot**. OpenCode restarts reuse the tree and must not depend on control-plane availability. See [Sandbox Runtime](/openwiki/data-plane/sandbox-runtime.md).

## MCP servers

`McpServerStore` holds named servers (stdio command or URL, env map, optional `repo_scope`, enabled flag, revision). Credentials in `env` are encrypted with the same secrets key. Routes in `packages/control-plane/src/routes/mcp-servers.ts` list/get/create/update/delete.

`SandboxLifecycleManager` loads MCP configs for the session’s repositories at spawn/restore and passes them into `CreateSandboxConfig.mcpServers`. `RuntimeConfig` feeds them to OpenCode. A repo-scoped server applies when that repo is in the workspace; unscoped servers apply globally.

MCP revisions exist so a session can keep a consistent tool config across reconnects of the same sandbox; changing a server in D1 does not rewrite an already-running OpenCode process until the next spawn.

## Failure behavior

- Invalid secret keys/values or oversized writes → `SecretsValidationError`
- Skills catalog mutation during resolve → 409
- Profile without canonical user → 403
- Skill selection over the content cap → 400
- MCP unique-name conflict → `McpServerConflictError`
- Missing encryption key → Worker refuses to operate on secrets (see [Control Plane](/openwiki/architecture/control-plane.md))
