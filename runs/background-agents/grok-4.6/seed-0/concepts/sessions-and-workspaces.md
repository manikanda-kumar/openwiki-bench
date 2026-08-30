---
type: concept
title: Sessions, Environments, and Repository Identity
description: Session as the unit of work, four mutually exclusive workspace targets, environments as snapshotted repository sets, primary-repo rules, and nested repository owners.
tags: [sessions, environments, repositories, multi-repo, workspace]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-83a5c69723e8f477e9b7dcbd
    resource: repo://docs/HOW_IT_WORKS.md
  - id: openwiki-source-daba99857a278725e8db415c
    resource: repo://packages/control-plane/src/repos/resolve.ts
  - id: openwiki-source-afdf6f72a667eba883658ee7
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/repo_config.py
  - id: openwiki-source-4c7ade2353252d234bb2d447
    resource: repo://packages/shared/src/types/environments.ts
  - id: openwiki-source-f000fa0dd3efa6df8cfb9a25
    resource: repo://packages/shared/src/types/repositories.ts
  - id: openwiki-source-2c8a8a06e5ce406af202b725
    resource: repo://packages/shared/src/types/session-api.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Sessions, Environments, and Repository Identity

A **session** is the unit of work. It is tied to a workspace, persists across client disconnects, is multiplayer, and stores messages, events, artifacts, participants, and sandbox state in one Durable Object. See [Session Durable Object](/openwiki/architecture/session-durable-object.md) and [Session Lifecycle](/openwiki/workflows/session-lifecycle.md).

## Four mutually exclusive targets

`createSessionInputSchema` allows **at most one** of:

1. Scalar `repoOwner` / `repoName` / optional `branch` — a single repository
2. `repositories` — an ad-hoc ordered list (1–10)
3. `environmentId` — a saved environment whose members are copied at create time
4. None of the above — no repository (scratch sandbox)

An empty `repositories: []` is not a fourth encoding of “no repo”; the list schema rejects empty arrays so `[]` cannot smuggle another mode through. `repoOwner` and `repoName` must appear together. `branch` requires that scalar pair.

`initializeSession` still requires that when a repo is present, `repoOwner`, `repoName`, and `repoId` travel together, and that `repositories[0]` matches the scalar primary mirror.

## Primary repository and checkout layout

In a multi-repo session the **first repository is primary**. It is mirrored into `session.repo_owner` / `session.repo_name`. Integration settings that are session-scoped (sandbox, code-server) resolve global → primary-repo → environment.

Each clone lives at `/workspace/{repoName}`. That is why session (and environment) lists reject **duplicate `repoName` even across different owners**. Pushes and pull requests are per-repository; one session can open a PR in several repos. The agent sees all checkouts side by side.

## Repository identity (nested owners)

Identity is `(repoOwner, repoName)`, not a naive split on the first `/`.

- `repoName` is a **single path segment**. It is the checkout directory. The sandbox rejects names that are not `^[A-Za-z0-9._-]+$` or that are `.` / `..`.
- `repoOwner` is a **namespace**. GitHub owners are one segment (`octocat`). GitLab subgroups nest (`group/subgroup`). The owner is **never** a filesystem path. `is_safe_repo_owner` allows `/` between safe segments and rejects empty segments and traversal (`a//b`, `/etc`, `a/`).

TypeScript helpers in `@open-inspect/shared` (`parseRepositoryFullName` splits on the **last** `/`, `encodeRepositoryPathSegments` encodes the owner as one API segment) are the contract. See [Shared Contracts](/openwiki/architecture/shared-contracts.md).

The sandbox writes a repo manifest once from `SESSION_CONFIG`. Bridge push targeting and the JS create-PR tool **read that manifest** instead of re-deriving `/workspace/<repo_name>`, so layout has one authority (`repo_config.py`).

## Environments

An **environment** is a named, reusable, prebuildable repository set (1–10 members, first = primary). Ids match `env_[A-Za-z0-9_-]+`. They carry optional Slack `channelAssociations` (max 50) and `prebuildEnabled`.

Create/update uses the **same list rules** as a session (`environmentRepositoriesInputSchema` aliases `sessionRepositoriesInputSchema`).

`resolveEnvironmentTarget` loads members in position order and feeds them into `resolveSessionRepositories`. That SCM check is **all-or-nothing**: if a member lost App access after the environment was saved, session create fails rather than booting a partial workspace. A missing environment is `404`; an environment with zero members is `500` (schema always requires ≥1).

Sessions **snapshot** the member list at creation (`environment_id` is provenance). Editing or deleting the environment does not change an existing session. The live `environmentName` on snapshots is resolved at read time and becomes null when the environment is gone (“Environment deleted” in the UI).

Ad-hoc multi-repo is the unsaved counterpart: same workspace shape, **no** environment secrets and **no** environment prebuild.

Environment-launched sessions receive **global + environment** secrets, not repository secrets. See [Secrets, Managed Skills, and MCP Servers](/openwiki/features/secrets-skills-and-mcp.md).

## How bots pick a target

- **GitHub bot** — webhook repository, unless repo metadata `defaultEnvironmentId` still contains that repo, then the environment workspace.
- **Slack** — routing rule, environment `channelAssociations`, or classifier (repos and environments); clarification lists both.
- **Linear** — team/project mappings may store `{ "environmentId": "env_…" }` beside repository entries.

## Resolution against SCM

`resolveSessionRepositories` checks App access for every member concurrently. Unlike automation fan-out (one session per repo), a coding session is one sandbox for the whole set, so any unresolvable member fails create (`400` if the provider reported no access, `500` if a lookup threw).

No-repo sessions omit branch context. SQL on the Durable Object enforces the same pairing of `repo_owner` / `repo_name`.
