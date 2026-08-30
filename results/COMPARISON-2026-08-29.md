# OpenWiki model comparison — host Qwen vs DeepSeek vs Grok vs native flash

Oracle reviews of OpenWiki on **background-agents** (Open-Inspect) at git SHA
`32470cc2`. Flash models used stock `openwiki@0.4.3` via OpenCode Go. Grok 4.6
used the fork's **host-agent** path (`host-agent/grok`). Host Qwen used OpenCode
CLI + OpenWiki MCP (`host-agent/opencode`, `opencode-go/qwen3.8-flash`). Runtime
is not comparable; **wiki quality** is.

This is about **reasoning and code-understanding quality**, not page counts.
Native Qwen (9/38, dead) and GLM (still generating) remain incomplete; their
written samples still count for style and grounding.

## Verdict

**Pick host Qwen 3.8 Flash (OpenCode + MCP) as the wiki author for this repo.**
Narrowly ahead of DeepSeek: it keeps native Qwen's source-level concurrency,
persistence, and security reasoning, but cuts the unusable 38-page forensic
sprawl into a finished 19-page wiki. Pages are 70–120 lines, dense with
`file.ts:Lxx` citations.

**DeepSeek remains the better planner** (broader taxonomy, more user concepts
and workflows). **Grok is the best stylist** and the orientation fallback.
Native Qwen is the deepest forensic sample, not a viable whole-wiki author.
Incomplete GLM is last.

Host Qwen compression is not free: it misses the Worker WebSocket-bypass
consequences, the complete session-status model, and GitHub's PR-head/prompt
contradiction, and it has at least two source-contradicted claims (GitHub
"500 after 200"; DO migrations called "transactionally applied").

Do **not** let native Qwen design the map. Do **not** ensemble-merge pages.

## Rankings

| Dimension | 1st | 2nd | 3rd | 4th | 5th |
| --- | --- | --- | --- | --- | --- |
| Taxonomy / information architecture | **DeepSeek** | Grok | Host Qwen | GLM | Native Qwen |
| Code-grounding | **Native Qwen** | Host Qwen | Grok | DeepSeek | GLM |
| Reasoning depth per unit of prose | **Host Qwen** | Native Qwen | DeepSeek | Grok | GLM |
| Usefulness for a real coding change | **Host Qwen** | DeepSeek | Grok | Native Qwen | GLM |
| Page style / clarity | **Grok** | Host Qwen | GLM | DeepSeek | Native Qwen |
| Overall wiki author | **Host Qwen** | DeepSeek | Grok | Native Qwen | GLM |

## Runtime

| Model | Started | Finished | Phase | Plan | Complete | Wiki size |
| --- | --- | --- | --- | --- | --- | --- |
| qwen3.8-flash-opencode | 16:39Z | 19:26Z | complete | 19 | 19 | 25 md, [quickstart](qwen3.8-flash-opencode/quickstart.md) |
| qwen3.8-flash | 05:37Z | died 15:08Z | generating | 38 | 9 | ~284K (9 md) |
| glm-5.3-flash | 06:58Z (3rd attempt) | — | generating | 28 | ~11 | still crawling |
| deepseek-v4-flash | 05:37Z | 09:38Z | complete | 26 | 26 | 33 md, [quickstart](deepseek-v4-flash/quickstart.md) |
| grok-4.6 | ~14:40Z | 15:39Z | complete | 24 | 24 | 32 md, [quickstart](grok-4.6/quickstart.md) |

GLM attempt 1 died on undici `headersTimeout` after ~63 min of planning;
attempt 2 with HTTP streaming died in 17s (`wrapModelCall` / GLM
`reasoning_content`). Attempt 3: no streaming, patched 1h headersTimeout, then
a restore-missing-file death; manual restart is the current generating run.
Grok's first host-agent pass hit `Max turns reached` at 12/24; resume with
`--max-turns 200` finished. Host Qwen hung mid-`write` at 17/19 (~18:23Z);
resume with `--session` accidentally called `openwiki_begin mode=init` and
regenerated the same 19-page plan as run `582e44cd` (finished 19:26Z).

Flash models scheduled `quickstart.md` last — a shared planning-order mistake.
Grok's and host Qwen's quickstarts are last in generation order too, but they
are **routing tables**, not long documents.

## Host Qwen 3.8 Flash (OpenCode) — best overall finished wiki

**Taxonomy:** 19 pages with ownership folders (`control-plane/`, `data-plane/`,
`clients/`, `integrations/`, `operations/`). Quickstart mixes runnable
commands, deployment traps, and job routing (120 lines). Missing vs DeepSeek:
standalone sessions/workspaces/status, source-control/PR, media/attachments,
model-providers. Control-plane-heavy, but finished and navigable.

**Strengths**

1. Solved native Qwen's editorial failure without losing its technical
   signature. Same model, host session + native tools, 19 pages instead of 38.
2. Best compact SessionDO page in the bench: nine-tier composition,
   fail-at-construction, sql-storage port, shared internal paths,
   persisted-deadline alarms.
3. Exceptional concurrency grounding: FIFO, one-in-flight claim, queue cap,
   request-fingerprint idempotency, stop-confirmation, CAS completion,
   post-hash admission re-reads.
4. Security key domains are correct (`REPO_SECRETS_ENCRYPTION_KEY`,
   `TOKEN_ENCRYPTION_KEY`, `PROVIDER_ACCOUNTS_ENCRYPTION_KEY`). No DeepSeek
   `BROWSER_AUTH_SECRET` slip.
5. High density still readable. 70–100 line pages with `file.ts:Lxx` citations.

**Failure modes**

1. Sees WS upgrade before the router; does not derive native Qwen's
   consequence (no route policy / preflight / correlation headers /
   `http.request` log).
2. Misses Grok's GitHub finding: session create does not pass PR head, but the
   review prompt claims the sandbox is already on it.
3. GitHub page invents "500 after the 200" for malformed JSON; `JSON.parse`
   actually runs before `waitUntil` and the 200.
4. Omits the session-status model (`created|active|completed|failed|archived|cancelled`)
   rather than getting it wrong like Grok.
5. Calls DO migrations "transactionally applied"; `applyMigrations` records
   after each step with no enclosing transaction.
6. Quickstart has an unresolved broken-link diagnostic despite
   `docs/GETTING_STARTED.md` existing.

**Style:** Closest to Grok's operator voice, denser. Less elegant than Grok,
far more scannable than native Qwen or DeepSeek.

Samples: [quickstart.md](qwen3.8-flash-opencode/quickstart.md),
[architecture.md](qwen3.8-flash-opencode/architecture.md),
[session-durable-object.md](qwen3.8-flash-opencode/control-plane/session-durable-object.md),
[prompt-and-event-pipeline.md](qwen3.8-flash-opencode/control-plane/prompt-and-event-pipeline.md).

## Grok 4.6 — best human-facing finished wiki

**Taxonomy:** 24 pages with real ownership boundaries. Unique folders:
`data-plane/`, `features/`, dedicated `architecture/realtime-protocol.md`.
Quickstart is a job-routing table. Missing vs DeepSeek: standalone persistence,
`session-diffs`, media/attachments, testing as its own section (Grok put testing
under `operations/`). All checked wiki links resolve; no invented destinations.

**Strengths**

1. Best task-oriented IA. Quickstart routes by job (understand a session, follow
   a prompt, debug a sandbox, deploy, extend bots) instead of narrating the repo.
2. Strong compression of the control-plane contract. 178 lines still has
   Worker/DO split, D1-before-DO, exact crons, queue-prefix routing, D1 vs DO
   SQLite, failure behavior, extension seams, tests.
3. Correct secret-domain treatment: `requireTokenEncryptionKey` /
   `requireRepoSecretsEncryptionKey`. Does **not** repeat DeepSeek's
   `BROWSER_AUTH_SECRET` encryption-at-rest slip.
4. Sessions/workspaces page extracts four exclusive targets, primary-repo
   mirroring, nested GitLab owners, environment snapshot semantics.
5. GitHub page catches a real bug: session create does not pass PR head, but the
   review prompt pretends the sandbox is already on that branch. Cleanly
   separates direct sessions, Autofix, and automation forwarding.

**Failure modes**

1. **Wrong session status model.** Writes `Created → Active → Archived` and says
   unarchive restores `active`. Source settles from existing messages and warns
   that forcing `active` falsely claims work exists. Also omits `completed` /
   `failed` / `cancelled`. Clearest under-research from compression.
2. Sees the WebSocket upgrade split before `handleRequest`, never derives Qwen's
   operational consequence: no route policy, preflight, correlation headers, or
   `http.request` log on that path.
3. Lifecycle page is orientation, not enough to change the subsystem (no D1
   compensation on failed DO init, CAS dispatch, two-phase sandbox identity,
   stop-confirmation).
4. Compact map leaves persistence, session-diffs, and media implicit.
5. "Quickstart" is intentionally only navigation — setup stays in `docs/`.
   Correct for a wiki, weak if a new operator expected a runnable onboarding.

**Style:** Best writer for humans. Headings, tables, invariants, then stop.
Quickstart 84 lines vs DeepSeek 242; overview 115 vs DeepSeek 292.

Samples: [quickstart.md](grok-4.6/quickstart.md),
[architecture/overview.md](grok-4.6/architecture/overview.md),
[architecture/control-plane.md](grok-4.6/architecture/control-plane.md),
[integrations/github.md](grok-4.6/integrations/github.md).

## DeepSeek V4 Flash — best overall

**Taxonomy:** Compact noun-based map. Architecture (`control-plane`, `overview`,
`persistence`, `sandbox-providers`, `sandbox-runtime`, `session-do`,
`web-client`). Concepts are nouns (sessions, secrets, environments, automations,
managed-skills, models-providers, prebuilt-images). Unique:
`workflows/session-diffs.md`.

**Strengths**

1. Best top-level mental model. `architecture/overview.md` covers single-tenant
   trust, package graph, canonical prompt path, DO/D1 split, change-routing.
2. Compression without usually going shallow. `architecture/control-plane.md` is
   221 lines and still has exact crons, queue dispatch, route policies,
   D1-before-DO.
3. Excellent invariant extraction. `concepts/sessions.md`: four exclusive
   targets, primary-repo semantics, nested `repo_owner`, D1-before-DO.
4. Broad written coverage — quality is less sample-sensitive.
5. Cross-language hazards: stale credential cache, argv git,
   `SESSION_DIFF_VERSION` sync.

**Failure modes**

1. Compression can invent. `architecture/overview.md` named `BROWSER_AUTH_SECRET`
   as an encryption-at-rest domain; scoped secrets use
   `REPO_SECRETS_ENCRYPTION_KEY`. Fix before publishing.
2. No standalone Qwen-style protocol pages (service-auth, SCM providers,
   sandbox-runtime-protocol, websocket-reconnect).
3. Missed Qwen's WebSocket bypass warning (upgrade path skips `handleRequest` →
   no CORS / correlation headers / HTTP log).
4. Weaker related-page graph than Grok's routing tables.

**Style:** Best briefing. Walls of bullets, few tables. Invariant dump at the
end is gold for an agent.

Samples: [architecture/control-plane.md](deepseek-v4-flash/architecture/control-plane.md),
[architecture/overview.md](deepseek-v4-flash/architecture/overview.md),
[quickstart.md](deepseek-v4-flash/quickstart.md).

## Qwen 3.8 Flash — deepest reader, over-expanded editor

**Taxonomy:** 38 pages, finest grain. Extra unique pages:
`sandbox-runtime-protocol.md`, `service-auth-and-boundaries.md`,
`source-control-providers.md`, `websocket-streaming-and-reconnect.md`,
`adding-a-sandbox-provider.md`, `control-plane-integration-tests.md`.
Instructions are procedural (file names, regexes, ESLint rules, Mermaid types).

**Strengths**

1. Best hidden-boundary reasoning. Control-plane worker page derives that the
   WebSocket branch bypasses `handleRequest` (no route policy, preflight,
   `x-request-id`/`x-trace-id`, HTTP log); admission splits Worker D1 check vs
   DO socket auth.
2. Best persistence ownership. DO SQLite vs D1 projections vs R2 payloads vs
   disposable KV; D1 `session_repositories` has identity, not git state.
3. Concurrency/durability, not just schemas (derived automation status, queue
   leases, compensating R2 cleanup).
4. Strongest provider/runtime boundary: `/app/sandbox_runtime` as a hard
   contract (`OpenCodeServer` absolute paths).
5. Best specialist destinations for real maintenance tasks.

**Failure modes**

1. Over-splitting. Sandbox concerns spread across six pages.
2. Bad generation order: `system-overview.md` sixth, `quickstart.md` last.
   Unfinished init is not useful. Died 15:08Z restoring a missing file.
3. Pages mirror implementation too closely (357–558 line samples). High drift
   cost.
4. Throughput: ~1 page / 45–50 min. 38-page plan is impractical for a first wiki.

**Style:** Forensic dump. Highest insight per sentence, lowest scannability.
Giant table cells, `defineRoute` snippets. Fine for a specialist page, terrible
as default house style.

Samples: [control-plane-worker.md](qwen3.8-flash/architecture/control-plane-worker.md),
[data-model-and-persistence.md](qwen3.8-flash/architecture/data-model-and-persistence.md),
[sandbox-data-plane.md](qwen3.8-flash/architecture/sandbox-data-plane.md).

## GLM 5.3 Flash — best workflow planner, thin written evidence

**Taxonomy:** ~28 pages, workflow-heavy. Unique: `media-and-attachments.md`,
automations as workflow not concept, model-provider-accounts as integration.

**Strengths**

1. Best workflow decomposition: `session-creation`, `prompt-lifecycle`,
   `sandbox-lifecycle`, `image-builds`, `git-and-pull-requests`,
   `media-and-attachments`.
2. Generated control-plane page is excellent: numbered `handleRequest` pipeline,
   exact crons, queue-prefix dispatch (`open-inspect-github-autofix-` so a
   similarly named image-build queue is not stolen).
3. Plans trace convergence (web/Slack/GitHub/Linear/automations/child spawn →
   one init path).
4. Only dedicated media/attachments workflow.
5. Operational constants (`MAX_SPAWN_DEPTH=2`, scheduler budgets) instead of
   "describe limits".

**Failure modes**

1. Written quality still rests on a handful of pages. Cannot claim repo-wide
   consistency yet.
2. Category boundaries less coherent (provider accounts as integration;
   automations as workflow).
3. Protocol boundaries underexposed vs Qwen.
4. Same WebSocket-bypass miss as DeepSeek.
5. Throughput and restore-missing-file deaths make a finished GLM wiki uncertain.

**Style:** Best writer among the flash models. Numbered pipeline, tables, then
depth. Headings every ~15 lines. Diagrams earn their keep. Dense but scannable.
Grok now occupies that slot with a finished wiki; GLM remains the fallback if
host-agent Grok is unavailable.

Sample: [control-plane-worker.md](glm-5.3-flash/architecture/control-plane-worker.md),
[architecture/overview.md](glm-5.3-flash/architecture/overview.md).

## Style on the same topic (control plane)

| | Grok | GLM | DeepSeek | Qwen |
| --- | --- | --- | --- | --- |
| Length | 178 lines | 294 lines | 221 lines | 356 lines |
| First 30s | You know ownership + failure modes | You know the pipeline | You know the system | You're in `index.ts` |
| Structure | Tables + invariants + seams | Headings + tables + lists | Prose + mermaid + invariants | Nested `###` + giant tables |
| Voice | Operator writing a contract | Operator explaining a system | Senior eng compressing a design doc | Staff eng narrating the source |
| Agent-useful | Copy the failure table | Follow the numbered steps | Copy the invariant list | Only if you already know where to look |

## Overlaps, gaps, unique discoveries

| Area | Shared | Best distinctive observation |
| --- | --- | --- |
| Control plane | Entrypoints, policies, crons, queues, D1 | **Qwen:** WS/router bypass consequences |
| Persistence | D1 vs DO SQLite, R2, KV | **Qwen:** D1 identity vs DO git state |
| Orientation | Three tiers, package graph | **DeepSeek:** single-tenant trust + change-routing map; **Grok:** job-routing quickstart |
| Sessions | Targets, lifecycle, children | **DeepSeek:** exclusive targets, nested owner, D1-before-DO; **Grok:** same, more compressed; **Grok miss:** unarchive status |
| Sandbox | Providers, lifecycle, images | **Qwen:** `/app/sandbox_runtime` packaging contract |
| Workflows | Prompt, sandbox, images, PRs | **GLM:** clearest workflow IA |
| GitHub | Bot vs Autofix | **Grok:** create-session does not pass PR head vs prompt claiming it does |
| Media | Indirect elsewhere | **GLM:** only dedicated page |
| Diff protocol | Runtime mention | **DeepSeek:** standalone `session-diffs.md` |
| Extension tasks | Embedded | **Qwen:** `adding-a-sandbox-provider.md` |

**Common gaps:** quickstart last in generation order; control-plane/backend
heavy; no strong "change the client socket/reducer safely" workflow (Qwen's
reconnect page is the closest). Grok's realtime page exists but does not replace
that specialist page.

Ideal taxonomy: DeepSeek's 26-page structure + Grok's routing/quickstart +
Qwen's highest-value specialist pages only.

## Throughput vs quality

DeepSeek is **not** cheaper thinking. Control-plane and sessions pages keep
constants, ownership, ordering invariants, failure semantics. Speed is selection
and compression. The encryption-key slip is the cost of that compression.

Grok is faster *and* more scannable, but the unarchive error shows the same
compression tax on state machines.

Qwen is not padding — the detail is usually real — but 38 pages at ~50 min/page
is the wrong first-wiki granularity.

GLM has the best flash-model workflow IA and page style; the snapshot still does
not prove it across persistence, runtime, integrations, and frontend.

Host Qwen is faster *and* denser than native Qwen because one OpenCode session
keeps context. The hung `write` at 17/19 and the accidental re-init are the
host-path tax.

## How to leverage the five

Stock OpenWiki cannot split models. The fork can
(`manikanda-kumar/openwiki`: planner/page/specialist + Grok/OpenCode host-agent).

| Role | Model | Env |
| --- | --- | --- |
| Planner | DeepSeek | `OPENWIKI_PLANNER_MODEL_ID` |
| Default page writer | **Host Qwen** (OpenCode MCP) | OpenCode `-m opencode-go/qwen3.8-flash` |
| Style / orientation fallback | Grok | Grok MCP |
| Specialist | Host Qwen (not unstable native Qwen) | same host session |
| Workflow fallback | GLM | only if host Qwen/Grok unavailable |

One page, one writer. No ensemble merge.

**Reverse host-Qwen-as-pages if** broader review finds a recurring pattern of
source-contradicted guarantees at async, state-machine, or security boundaries
— more instances like "500 after 200" and "transactionally applied migrations,"
not merely omitted detail. Then restore Grok as default writer.

## Plan inventories

Full plan dumps: [plans/](plans/).

- Host Qwen 19 pages (finished manifest) — [plans/qwen3.8-flash-opencode.summary.json](plans/qwen3.8-flash-opencode.summary.json)
- DeepSeek 26 pages — [plans/deepseek-v4-flash.summary.json](plans/deepseek-v4-flash.summary.json)
- GLM ~28 pages — [plans/glm-5.3-flash.summary.json](plans/glm-5.3-flash.summary.json)
- Native Qwen 38 pages — [plans/qwen3.8-flash.summary.json](plans/qwen3.8-flash.summary.json)
- Grok 24 pages (finished manifest) — [plans/grok-4.6.summary.json](plans/grok-4.6.summary.json)
