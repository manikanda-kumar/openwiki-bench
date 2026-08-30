# OpenWiki-Bench — plan to extract a standalone benchmark project

Status: draft, 2026-08-30. Source of the first data: `background-agents/openwiki-bench/`
(5 runs, repo `background-agents` @ `32470cc2`, openwiki 0.4.3).

## 1. Why this exists

Public coding benchmarks measure short, self-contained, often-memorized tasks. They do not
measure what actually decides whether an agent is useful on a real codebase: sustaining a
multi-hour task, decomposing it, keeping ground truth, calling tools without thrashing, and
finishing. OpenWiki `--init` on a real repository is naturally that task — 20-40 dependent
subtasks, hours of wall time, no single correct answer, and a machine-checkable output.

The bench measures **wiki quality and the process that produced it**, across three axes the
user cares about: reasoning, code understanding, tool calling.

Why the output is scorable without a human key: OpenWiki emits `.claims/**.json` where every
claim carries evidence pinned to `repo://<path>#L<a>-L<b>` plus a `repo-lines-v1` content
hash. Grounding is therefore verifiable by machine, not by taste.

## 2. What the current snapshot proves and what it does not

Proves: the task discriminates models sharply. Host Qwen 3.8 Flash (OpenCode + MCP) produced
the best finished wiki; DeepSeek V4 Flash the best taxonomy; Grok 4.6 the best writing; GLM
5.3 Flash the best workflow IA but never finished; native Qwen died at 9/38.

Does not prove anything reproducible. Every ranking is n=1, scored as oracle prose, with no
cost, no token counts, no tool-call data, and failure history recorded only in README English.

Concrete gaps this plan closes:

| Gap | Today | After |
| --- | --- | --- |
| Scoring | prose verdict | rubric + per-page scores + inter-judge agreement |
| Grounding | asserted | `resolvable% / in_range% / exact%` from claim hashes |
| Correctness | anecdotes ("500 after 200") | sampled contradiction rate with CI |
| Cost | absent | $ per finished page / per verified claim |
| Tool calls | absent | calls per page, failed-call %, redundant-read % |
| Reliability | prose ("3 attempts") | deaths, resumes, completion rate over 3 seeds |
| Variance | n=1 | n=3 seeds, per-axis spread |

## 3. Target project

Name: `openwiki-bench`. New repo, separate from both `openwiki` (the tool) and
`background-agents` (the subject). UNCONFIRMED: remote `manikanda-kumar/openwiki-bench`,
public vs private.

Node + TypeScript, ESM, no framework. Scripts are the product; the write-up is generated on
top of the scores, not the other way round.

```
openwiki-bench/
  README.md                 # what the bench is, how to run it
  METHODOLOGY.md            # rubric, judging protocol, validity limits
  rubric.md                 # the 6 axes with 0-4 anchors (judge reads this verbatim)
  package.json
  src/
    schema.ts               # run.json / scores.json / leaderboard.json types
    grounding.ts            # claim evidence resolution
    structure.ts            # deterministic wiki metrics
    probe.ts                # sampled statement-vs-cited-lines contradiction probe
    judge.ts                # blind rubric judging, multi-judge, kappa
    cost.ts                 # LangSmith + proxy ledger -> per-run economics
    report.ts               # leaderboard.json + markdown tables
  bin/
    bench.ts                # single CLI: bench score|probe|judge|cost|report
  runs/
    <subject>/<model>/<seed>/    # wiki output + .claims + run.json
  subjects/
    background-agents.json  # repo url, pinned sha, ignore file hash, notes
  results/
    scores.json  leaderboard.json  COMPARISON.md
```

Migration of existing data: move the five model dirs to
`runs/background-agents/<model>/seed-0/`, keep `plans/*.summary.json` beside each run as
`plan.summary.json`, and preserve `COMPARISON.md` as `results/COMPARISON-2026-08-29.md` —
the first write-up becomes a dated artifact, not the live one. ~5.3 MB, safe to commit.

The subject repo is NOT vendored. Scoring needs the source at the pinned SHA; the CLI clones
or takes `--repo <path>` and asserts `git rev-parse HEAD` matches `subjects/*.json`.

## 4. Metrics

### 4.1 Deterministic (no LLM, no cost)

Grounding, from `.claims/**.json`, reusing OpenWiki's own resolver
(`openwiki/src/claims/evidence/repository/resolver.ts`, `RepositoryEvidenceResolver`) rather
than reimplementing the `repo-lines-v1` hashing:

- `resolvable%` — cited path exists at the pinned SHA
- `in_range%` — cited line range exists in that file
- `exact%` — `repo-lines-v1` hash matches (no drift, no invented range)
- `claims_per_page`, `evidence_per_claim`

Structure, from the pages plus `plan.summary.json`:

- `completeness` = `statuses.complete / plan_page_count`
- `link_integrity` = internal wiki links that resolve
- `coverage` = share of subject packages/top-level dirs cited at least once; also
  `seedPaths` coverage
- `density` = citations per 100 lines; lines per page; pages per plan
- `redundancy` = mean pairwise Jaccard over each page's cited-file set — this turns "38-page
  sprawl" into a number instead of an opinion

### 4.2 Correctness probe (cheap LLM)

Sample K claims per page, stratified. Give the judge only the claim `statement` and the exact
cited lines — no repo access, so it cannot drift into general knowledge. Label
`supported | unsupported | contradicted`. Report `contradiction_rate` with a Wilson interval.

This is the metric that catches the two known host-Qwen slips ("500 after the 200",
"transactionally applied migrations") automatically. Keep `contradicted` (falsifiable, hard
fail) strictly separate from `omitted` (soft, a coverage question).

### 4.3 Rubric judging (expensive LLM)

Six axes, scored 0-4 **per page**, anchors written out in `rubric.md`:

| Axis | 0 | 4 |
| --- | --- | --- |
| Taxonomy fit | page overlaps two or more others | one owner, no overlap |
| Code grounding | uncited non-obvious claims | every non-obvious claim cited and exact |
| Reasoning depth | restates identifiers | derives consequences and invariants |
| Change usefulness | cannot act on it | names files, order, failure modes for a real change |
| Style | undifferentiated prose | scannable; tables; stops |
| Correctness | source-contradicted | no contradiction found |

Wiki score = mean of page scores, penalised by `coverage` and `completeness`.

Protocol: strip model identity and shuffle directory labels before judging; two judges plus a
tiebreak; never let a contestant judge its own bench. Judges: Fable 5 primary, Opus 4.8
second, gpt-5.5 (via `codex exec -s read-only`) as an independent third. Report Cohen's kappa
— below ~0.6 the anchors are broken and rankings are not publishable until they are fixed.

Cost control: judge a fixed 8-page stratified subset per run (quickstart, overview,
control-plane, plus five random), and run the full contradiction probe on those pages only.

### 4.4 Cost and tool calls

OpenWiki records no usage: `src/telemetry/` captures command, provider, outcome and an error
category only, by design. Cost must be captured outside the tool.

- Native `--init` runs: OpenWiki is LangChain-based, and `LANGCHAIN_TRACING_V2` is already in
  the env passthrough (`openwiki/src/config/env.ts`). Setting
  `LANGSMITH_TRACING=true LANGSMITH_PROJECT=openwiki-bench-<model>-<seed>` yields per-run
  tokens, tool calls, tool errors, latency and retries for free.
- Host-agent runs (Grok Build, OpenCode + MCP): LangSmith sees nothing. Route
  `OPENAI_COMPATIBLE_BASE_URL` through a local LiteLLM proxy that appends usage to JSONL.
  Point native runs at the same proxy so both paths land in one comparable ledger and no
  number depends on a provider dashboard.

Derived:

- `$ / finished page`, `$ / verified claim`
- `tokens / plan page`, split planning vs writing
- `tool_calls / page`, `failed_tool_call %`, `redundant_read %` (same file read more than twice)
- `completion_rate` over seeds; `deaths`, `resumes`

Tool-call quality is currently the axis with zero data, yet every observed failure was a tool
or loop pathology rather than a reasoning one: Grok hit max turns, host Qwen hung mid-`write`
and then accidentally re-ran `openwiki_begin mode=init`, GLM died twice on `headersTimeout`
and streaming. Those belong in the table, not the footnotes.

## 5. Run manifest

Every run directory gets a committed `run.json`. Backfill the five existing runs from README
and `plan.summary.json`; mark anything not recoverable as `null`, never guessed.

```jsonc
{
  "subject": "background-agents",
  "repo_sha": "32470cc2",
  "model": "qwen3.8-flash",
  "runtime": "native | host-grok | host-opencode",
  "openwiki_version": "0.4.3",
  "seed": 0,
  "started_at": "2026-08-29T16:39:17Z",
  "finished_at": "2026-08-29T19:26:15Z",
  "wall_seconds": 10018,
  "outcome": "complete | incomplete | died",
  "deaths": [{ "phase": "generating", "error": "headersTimeout", "at": "..." }],
  "resumes": 1,
  "env": {
    "provider": "openai-compatible",
    "base_url": "https://opencode.ai/zen/go/v1",
    "streaming": false,
    "headers_timeout_ms": 3600000
  },
  "prompt_sha": null,
  "ignore_sha": null,
  "cost": { "input_tokens": null, "output_tokens": null, "usd": null, "source": "none" }
}
```

## 6. Harness rules (so runs stay comparable)

- Pinned subject SHA; detached git worktree per run, as the current bench already does.
- `CLAUDE.md` symlink to `AGENTS.md` must be replaced by a real file before init, otherwise
  OpenWiki duplicates its managed markers. (Learned on `background-agents`.)
- Identical prompt and identical ignore file across models; record both hashes.
- One writer per page. No ensemble merges — merged output is unattributable.
- Runtime is not comparable across native and host-agent paths; cost per unit of output is.

## 7. Validity

- Contamination: prefer private or post-cutoff subjects with no public wiki. The bench's own
  argument collapses if the subject is memorized, so state the contamination case explicitly
  per subject in `subjects/*.json`.
- n: three seeds per model per subject. Report per-axis variance; a one-rank gap inside
  variance is not a gap. The current host-Qwen-over-DeepSeek call is explicitly narrow and is
  exactly the claim seeds will confirm or dissolve.
- Second subject with a different shape (the first is Cloudflare Workers + Durable Objects).
- Judge bias: blind, multi-judge, kappa reported, contestants excluded.

## 8. Phases

**P0 — reproducible numbers from data already on disk.** Bootstrap repo, migrate the five
runs, backfill `run.json`, write `grounding.ts` and `structure.ts` plus `bench score`. No LLM
spend. Exit: `results/scores.json` regenerates from a clean clone.

**P1 — scoring that survives disagreement.** `rubric.md`, `judge.ts` (blind, multi-judge,
kappa), `probe.ts` contradiction rate. Exit: kappa >= 0.6 and a leaderboard whose ordering is
traceable to per-page scores.

**P2 — economics and tool calls.** LangSmith on for native runs, LiteLLM proxy for host-agent
runs, `cost.ts`, derived per-page and per-claim economics. Exit: every future run has a cost
row; the five existing runs stay `null` and are labelled as such.

**P3 — statistical weight.** Three seeds per model, second subject, variance reported,
`results/COMPARISON.md` generated from `leaderboard.json`.

Do P2's LangSmith switch before the next run regardless of phase order — that run's cost data
is unrecoverable afterwards.

## 9. Immediate next actions

1. Create the repo and the layout in section 3; migrate the five runs; commit.
2. Backfill five `run.json` files from README plus `plan.summary.json`.
3. Implement `bench score` (grounding + structure) and publish the first machine table.
4. Write `rubric.md` before any further judging so the existing prose verdict can be re-derived
   rather than trusted.

## 10. Open questions

- Repo visibility and remote name. UNCONFIRMED.
- Whether `openwiki-bench` vendors OpenWiki's claim resolver, imports it as a dependency, or
  reimplements the `repo-lines-v1` check. Importing keeps the definition of "grounded" owned
  by the tool under test, which is a bias worth naming.
- Second subject repo. UNCONFIRMED.
- Whether the fork's split-model routing (DeepSeek planner + host Qwen writer + Grok fallback)
  becomes a bench contestant in its own right.
