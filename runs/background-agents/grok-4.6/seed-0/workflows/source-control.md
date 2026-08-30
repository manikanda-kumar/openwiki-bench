---
type: workflow
title: Source Control, Git Auth, and Pull Requests
description: Deployment-wide SCM_PROVIDER, brokered GitHub App installation tokens for git clone/fetch/push, user OAuth for attributed pull requests, and the sandbox git credential helper.
tags: [scm, git, github, gitlab, pull-requests, credentials]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-c96bf7d49c00c4349dd4d97a
    resource: repo://docs/adr/0001-single-provider-scm-boundaries.md
  - id: openwiki-source-95708266900b62a9460b893c
    resource: repo://packages/control-plane/src/session/pull-request-service.ts
  - id: openwiki-source-cc418ae85071e90eb8d81e29
    resource: repo://packages/control-plane/src/session/scm-credentials-service.ts
  - id: openwiki-source-c1cc0e9304c0e13ec9a4cccc
    resource: repo://packages/control-plane/src/source-control/config.ts
  - id: openwiki-source-98be2b2c31c1e4ddbe0f097d
    resource: repo://packages/control-plane/src/source-control/providers/github-provider.ts
  - id: openwiki-source-23c9c11e565ab89c515bb2a6
    resource: repo://packages/control-plane/src/source-control/providers/index.ts
  - id: openwiki-source-06d3b072476cfd51c8cb67f3
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/credentials/git_credential_helper.py
  - id: openwiki-source-11c8139d3e5d8796cce14d68
    resource: repo://packages/shared/src/git.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Source Control, Git Auth, and Pull Requests

Open-Inspect is a **single SCM provider per deployment**. `SCM_PROVIDER` selects `github` (default), `gitlab`, or `bitbucket`. There is no per-session provider column. ADR 0001 (`docs/adr/0001-single-provider-scm-boundaries.md`) is the boundary: provider-specific URLs, push transport, and credential-helper auth live in `packages/control-plane/src/source-control/providers`, not in routers or Slack/Linear handlers.

Related: [Security Model and Authentication](/openwiki/concepts/security-and-auth.md), [Sessions and Workspaces](/openwiki/concepts/sessions-and-workspaces.md), [Sandbox Runtime](/openwiki/data-plane/sandbox-runtime.md), [GitHub Bot and Autofix](/openwiki/integrations/github.md).

## Deployment-wide provider

`resolveScmProviderFromEnv` accepts `github`, `gitlab`, `bitbucket`; empty → `github`; anything else is a permanent `SourceControlProviderError`.

`createSourceControlProvider`:

| Value | Implementation |
| --- | --- |
| `github` | `GitHubSourceControlProvider` (App JWT → installation token) |
| `gitlab` | `createGitLabProvider` when `GITLAB_ACCESS_TOKEN` (and namespace) are configured |
| `bitbucket` | Throws "configured but not implemented" |

The control-plane router maps unimplemented SCM on restricted routes to **HTTP 501**. Unknown `SCM_PROVIDER` is 500 at factory time. GitHub remains the production path; GitLab is the implemented second provider; Bitbucket is a reserved name that must fail closed.

Repo **owners** may contain `/` (GitLab subgroups). `repoName` is one path segment (the `/workspace` checkout directory). Split `owner/name` on the **last** `/`.

## Two credential planes

Git inside the sandbox and pull-request creation on the host API are **not** the same token.

**Clone / fetch / push (brokered App/installation token).** `ScmCredentialsService.getCredentials()` calls `SourceControlProvider.generateCredentialHelperAuth()`. On GitHub that is a cached installation token returned as `username: x-access-token`, `password: token`, plus expiry. Permanent provider errors → 500; transient → 502 so git retries. The password is never logged.

The sandbox never holds a long-lived installation token as an env var for live sessions. Image-build sandboxes (no control plane) get a one-shot `VCS_CLONE_TOKEN` treated as good for one hour.

**Attributed pull requests (user OAuth, App fallback).** `PullRequestService.createPullRequest` uses `input.promptingAuth` (the prompting user's stored GitHub OAuth) when present; otherwise the GitHub App token (`promptingAuth ?? appAuth`). Linear/Google-only/automation sessions typically hit the App fallback, so the PR author is the App bot. The PR body appends a "Created with {appName}" session link. An already-open PR for the same head is reused (`updated: true`) after a force-push rather than doubling.

Commit **author** vs **committer/signer** vs **pusher** are separate identities when commit signing is enabled (see [GitHub Bot](/openwiki/integrations/github.md)); the App still pushes the branch.

## Git credential helper (sandbox seam)

`packages/sandbox-runtime/src/sandbox_runtime/credentials/git_credential_helper.py` implements git's `credential` protocol. On `get`:

1. Protocol must be `https`; host must equal `VCS_HOST` (default `github.com`). Other hosts get no token — a malicious submodule URL must not exfiltrate the installation credential. Scope is **installation-wide**, not the session repo, so setup hooks can clone sibling private repos the App can access.
2. If `CONTROL_PLANE_URL` + `SANDBOX_AUTH_TOKEN` + session id exist, POST to the control-plane SCM-credentials endpoint with the sandbox Bearer token.
3. Cache success in `/run/oi/scm-creds.json` (0600) until `CACHE_REFRESH_BUFFER_SECONDS` (5 minutes) before expiry. Concurrent helpers take an advisory lock.
4. A failed refresh **does not** serve stale cache; the helper exits non-zero.

Stdout is protocol only; diagnostics go to stderr.

## Branch names and PRs

Shared `packages/shared/src/git.ts`: session branches are `open-inspect/{sessionId}` (`BRANCH_PREFIX`). `PullRequestService` sanitizes the head, updates `session_repositories.branch_name`, and broadcasts `session_branch`. PRs are **per repository** in a multi-repo session; the HTTP handler validates `repoOwner`/`repoName` against the session list.

## Invariants

- One `SCM_PROVIDER` per deployment; no session-level override.
- Unimplemented providers fail closed (throw / 501), they do not silently use GitHub.
- Git helper tokens are short-lived App/installation credentials; PR attribution prefers user OAuth.
- Helper never answers non-https or the wrong host.
- Provider-specific URL and token logic stays in the provider module (ADR 0001).

## Extension seams

- New SCM: implement `SourceControlProvider` including `generateCredentialHelperAuth`, register in the factory, add router `supportedScmProviders`, do not leak APIs into Slack/session layers. See `docs/provider-contribution-checklist.md`.

## Focused tests

- Factory / bitbucket 501: `packages/control-plane/src/source-control/providers/index.test.ts`, `config.test.ts`
- Credential helper service: `scm-credentials-service` tests
- GitHub PR mapping: `github-provider` tests
- Helper protocol/host gating: sandbox-runtime credential helper tests
- Branch helpers: `packages/shared/src/git.ts` tests
