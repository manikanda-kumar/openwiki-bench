---
type: security
title: Security invariants and review priorities
description: The capability-security rules reviewers enforce in this repo — ambience only via user/admin configuration, the getGatekeeperClassFor chokepoint, env-driven auth config, the MCP trust boundary, secrets-in-logs rules, and frontend error-reporting constraints — with the code locations that enforce each.
tags: [security, invariants, review, capability, change-guide]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-1c512cdc924c5b8c80bd6e0b
    resource: repo://packages/backend-utils/src/logger-core.ts
  - id: openwiki-source-7c3a8d0a7ccea7201f2f73d4
    resource: repo://packages/gatekeeper-cloudflare/README.md
  - id: openwiki-source-2a82cf98957a45d4832b41ec
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare.ts
  - id: openwiki-source-bdf02048d65c73424f38d840
    resource: repo://packages/gatekeeper-google/src/resources.ts
  - id: openwiki-source-1cd7f2c2d4fc486cd3495da5
    resource: repo://packages/mcp-shared/src/sharing-policy.ts
  - id: openwiki-source-899744ea4a395ee6ff25ba0b
    resource: repo://packages/mcp-shared/src/tools.ts
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-def7ad403d9800d292e1ae76
    resource: repo://packages/workshop-frontend/src/errorReporting.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Security invariants and review priorities

Review priority in this repo, highest first: the kernel bar, capability-security invariants, secret
leakage through logs and errors, then everything else (`REVIEW.md:7-8`). This page frames each
invariant as a change guide: what a change must do, where the enforcement lives, and why reviewers
reject violations.

## 1. Ambience is configured, never asserted

A resource becomes "ambient" (auto-injected into chats) **only through user or admin
configuration** — a gatekeeper must never assert its own ambience (`REVIEW.md:27-28`). The
enforcement points: `VendorDescription.autoProvisionsAccount` is what *declares* provisioning
capability, but the **mode** comes from `AdminConfig.ambientGatekeeperModes` resolved only in
`packages/workshop-backend/src/provisioning-policy.ts` (default `optional`), and the actual
installation happens in the Overseer's `ensureAmbientCapsules` driven by the *owner's* stored
account — the capability is the account the user actually holds, never an asserted identity
(`provisioning-policy.ts:1-34`; `overseer.ts:6164-6236`). A gatekeeper whose `describe()` claimed
ambience without an admin/user decision would find no code path honoring it — any attempt to add
one is a rejection.

Related: singleton/UI capability probing is forbidden — the Workshop gates calls on declaration
flags rather than probing stubs, since RPC stubs cannot report optional-method presence
(`gatekeeper.ts:644-668`).

## 2. One chokepoint mints gatekeeper capabilities

`UserDurableObject.getGatekeeperClassFor(accountId, url)` is the single core location where a
`resourceUrl` becomes a capability, reached only via the UI-facing `Overseer.newGatekeeper` and
blueprint instantiation — never from gadget or agent code. It is where admin-disabled gatekeepers
and disabled resource URL patterns are enforced *before* the class is returned
(`packages/workshop-backend/src/user.ts:1666-1691`; `REVIEW.md:29-32`). The picker/agent listings
are separately filtered (`filterEnabledResources`, `user.ts:1123`, `1447`), but blocking at the
chokepoint is what prevents minting a new capability even when a request bypasses the UI.
**Reviewer rule**: flag any new path that mints a gatekeeper capability without going through it.

## 3. Auth config stays out of AdminConfig

`AUTH_GATEKEEPERS` and `DISABLE_PASSWORD_AUTH` are env-var driven in `auth/config.ts`; they must
never move into `AdminConfig`, so a compromised admin session cannot change who can sign in. The
`AdminSettings` DO is the only writer of `AdminConfig`; other code reads through the KV mirror
(`REVIEW.md:33-37`; `admin-settings.ts:49-57`). `signupsEnabled` is the deliberate exception *in*
AdminConfig: it is an access toggle, not authentication config (`admin-config.ts:16-21`).

## 4. The MCP trust boundary

In `packages/mcp-shared/`, **`tools.ts` is the trust boundary: nothing outside it may read a tool's
annotations**. A tool is an observation only when the server declares `readOnlyHint: true` (strict
`=== true`), auto-applying a write additionally requires a `vetted` endpoint
(`MCP_PORTAL_TRUST_ANNOTATIONS=true`), and every SDK OAuth operation must be given `sdkFetch(...)`
so endpoint and SSRF checks survive redirects (`REVIEW.md:38-41`; `tools.ts:1-16`,
`63-80`). MCP bindings are additionally **owner-only** — `addObserver` refuses unconditionally —
because MCP has no per-record authorization oracle (`sharing-policy.ts:1-17`).

## 5. Fail closed on grants and scopes

Grant accounting must never over-record. Examples: an omitted `resourceUrlPatterns` means "all
types" while `[]` means "none" — a billing-only connection must not silently acquire telemetry
access, and recording a wider grant than was made would make `ensureResources` short-circuit into
a binding that 403s with no way to re-prompt (`gatekeeper.ts:433-443`;
`packages/gatekeeper-cloudflare/src/cloudflare.ts:296-302`). Google freezes its
legacy/scope-derived resource lists so grant inference can never report a grant nobody made
(`packages/gatekeeper-google/src/resources.ts:100-129`). The observer check itself is the
gatekeeper's job within its own trust domain, keyed on the sharing graph — never on live sessions
(`docs/observers.md:126-131`).

## 6. Secrets never reach logs, errors, or reports

Server code logs through `@gadgets/backend-utils/logger` with module-scoped loggers; caught values
pass as `error`. Never log or report secrets, prompts, headers, tokens, or request/response bodies
— exception messages and stacks reach the external Reporter, so the same rule applies to anything
thrown or attached as report metadata (`REVIEW.md:47-51`). The logger's type system enforces the
field-name ban (`logger-core.ts:13-43`), and the Cloudflare gatekeeper shows the deep version:
filter *values* stay out of audit entries, provider error *messages* can quote those values back so
only numeric `codes` are logged (`observability-session.ts:32-34`;
`packages/gatekeeper-cloudflare/README.md:90-101`).

Frontend reporting constraints: gatekeeper UIs report via `postMessage` to the Workshop host (which
validates the known frame window with origin `null`) — never directly from their own Worker origin;
`reportedUserId` is client-supplied and unverified, never read as identity or authority;
`pageLocation` is rebuilt to origin+pathname at the boundary because a share link's fragment is a
bearer capability and an `href` retains credentials; automatic capture belongs only in trusted
first-party surfaces, never gadget or user-authored code (`REVIEW.md:52-58`;
`errorReporting.ts:228-248`).

## 7. Kernel review bar

`packages/workshop-backend` and the public API in `workshop-shared/src/api.ts` are read line by
line: every exported member of the public API needs a doc comment; hand-written interfaces mirroring
an RPC interface plus an `as unknown as` cast are rejected (derive from the real type or rethink);
prefer reusing an existing mechanism over adding a parallel one; large kernel changes are split by
concern so backend/shared are reviewable apart from UI (`REVIEW.md:12-23`). RPC promise pipelining
is idiomatic — unawaited RPC promises are **not** floating promises, and stubs held in React state
must be wrapped in objects (`REVIEW.md:61-69`).

## 8. Blueprint ids are immutable

A `blueprintId` is never edited after deploy — install and promotion are keyed on it, so a rename
orphans the old entry; bundled format blueprints carry stable readable ids for exactly this reason
(`REVIEW.md:42-43`; `format-blueprints/README.md`).
