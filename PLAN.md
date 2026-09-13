# OpenWiki-Bench — plan to extract a standalone benchmark project

Status: v1 execution and evaluation complete; publication blocked by judge agreement, 2026-09-13. Source of the first data: `background-agents/openwiki-bench/`
(5 runs, repo `background-agents` @ `32470cc2`, openwiki 0.4.3).

## 1. Why this exists

Public coding benchmarks measure short, self-contained, often-memorized tasks. They do not
measure what actually decides whether an agent is useful on a real codebase: sustaining a
multi-hour task, decomposing it, keeping ground truth, calling tools without thrashing, and
finishing. An OpenCode agent driving OpenWiki's MCP generation loop on a real repository is
naturally that task — 20-40 dependent subtasks, hours of wall time, no single correct answer,
and a machine-checkable output.

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
| Reliability | prose ("3 attempts") | deaths, resumes, completion rate over 3 trials |
| Variance | n=1 | n=3 trials, per-axis spread |

## 3. Target project

Name: `openwiki-bench`. Separate from both `openwiki` (the tool) and
`background-agents` (the subject). Remote: public `manikanda-kumar/openwiki-bench`.

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

### 3.1 Official 60-outcome matrix (45-run original cohort + 15-run amendment)

The original official matrix is three OpenCode Go models × three independent trials × five pinned
repositories = **45 outcomes**. A 2026-09-12 protocol amendment adds RouteLLM-hosted Smaug-Flash
as a fourth contestant for three trials on the same five subjects, producing **60 outcomes** total.
The original 45 remain a named cohort and are not rerun or reinterpreted. “Trial” is the statistical
unit; the existing `seed` field is its stable identifier and does not imply that the provider offers
deterministic seeded sampling.

Every contestant uses the **same OpenCode agent runtime**, OpenWiki MCP server/version,
generation prompt, ignore policy, tool permissions, retry/resume policy, and telemetry proxy.
This isolates model behavior better than mixing native OpenWiki, Grok host, and OpenCode host
runtimes. Because the amendment changes both model and inference provider, Smaug comparisons are
system-level comparisons and must not be presented as provider-controlled model effects.

| System ID | OpenCode Go model | Agent runtime | Generation path |
| --- | --- | --- | --- |
| `deepseek-v4-flash-opencode` | `opencode-go/deepseek-v4-flash` | OpenCode | OpenWiki MCP |
| `glm-5.3-flash-opencode` | `opencode-go/glm-5.3-flash` | OpenCode | OpenWiki MCP |
| `qwen3.8-flash-opencode` | `opencode-go/qwen3.8-flash` | OpenCode | OpenWiki MCP |
| `smaug-flash-opencode` | `routellm/abacusai/Smaug-Flash` | OpenCode | OpenWiki MCP |

The repositories deliberately vary language, architecture, maturity, and navigation pressure:

| Subject ID | Repository and pin | Capability axis | Quality profile |
| --- | --- | --- | --- |
| `cloudflare-os` | `cloudflare/cloudflare-os@af56a9d79d8a60ebed8dabb11b075cd88efc1b87` | TypeScript distributed control plane, capabilities, RPC, Durable Objects | highly structured monorepo |
| `smallstep-cli` | `smallstep/cli@f7b2bd24a4a9519b13c91dc37dae49d36b77068d` | Go CLI, certificates, OAuth/JWT/SSH, platform behavior | mature with historical complexity |
| `extractthinker` | `enoch3712/ExtractThinker@66920c9af1b74bd20731ed7ac1cbe4794a0da21b` | Python document pipelines, loaders, extraction and classification | integration-heavy and uneven |
| `celld` | `denoland/celld@a52f9905425bc41134d817694bdc2c50bcc5e856` | Rust ownership, replication, durability and concurrency | clean logic/effect separation |
| `pi-desktop` | `DLYZZT/pi-desktop@08502be45f4f8c22da5ad563c9b6f0e37315cc97` | React/Electron process isolation, IPC, lifecycle and state | modern, defensive, fast-moving |

All five were selected from the owner's GitHub stars after source-level comparison. Public
popularity and existing documentation remain contamination risks and are recorded per subject.
`background-agents` remains the historical pilot dataset, not an official matrix subject;
`web-recap` is excluded because it is small, external-state-heavy, and already benchmark-exposed.

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
tiebreak; never let a contestant judge its own bench. The official judge transport is **Amp**,
not direct OpenRouter calls: GPT-5.5 through Amp's `deep-classic` mode as primary, Grok 4.6 as
secondary, and GPT-6 Astra Medium as disagreement tiebreaker and correctness-probe judge. Run each blind task in a fresh isolated Amp thread with
no contestant repository/project attached, import only its JSON response, and record thread ID,
Amp mode, resolved model/version, and execution time in the private judge manifest. Preflight
exact model availability before the matrix; never silently accept Amp routing to a replacement
model. Gate on linear-weighted Cohen's kappa — appropriate for ordinal 0–4 scores — and report
exact agreement plus unweighted kappa as diagnostics. Below 0.6 weighted kappa the anchors are broken and rankings are not publishable
until they are fixed.

Cost control: judge a fixed 8-page stratified subset per run (quickstart, overview,
control-plane, plus five random), and run the full contradiction probe on those pages only.

### 4.4 Cost and tool calls

OpenWiki records no usage: `src/telemetry/` captures command, provider, outcome and an error
category only, by design. Cost must be captured outside the tool.

- Official OpenCode + OpenWiki MCP runs do not expose native OpenWiki LangSmith traces. Route
  OpenCode Go inference through a usage-recording proxy or normalize OpenCode's own ledger to
  JSONL. Capture OpenCode tool events separately so model tokens, MCP calls, failures, latency,
  retries, and repeated reads land in one comparable per-trial record.

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
- Freeze one non-interactive OpenCode invocation, OpenCode version, OpenWiki MCP version,
  permissions, max turns, timeout, and resume procedure before trial 0.
- OpenCode must use only the selected `opencode-go/*` model for the entire trial; no planner,
  writer, or fallback model substitution.

## 7. Validity

- Contamination: prefer private or post-cutoff subjects with no public wiki. The bench's own
  argument collapses if the subject is memorized, so state the contamination case explicitly
  per subject in `subjects/*.json`.
- n: three independent trials per system per subject across all five subjects. Report per-axis
  variance, worst-subject performance, and cross-subject spread; a one-rank gap inside variance
  is not a gap.
- Macro-average subjects with equal weight so the largest repository cannot dominate.
- Judge bias: blind, multi-judge, kappa reported, contestants excluded.

## 8. Phases

**P0 — complete.** Bootstrap repo, migrate the five
runs, backfill `run.json`, write `grounding.ts` and `structure.ts` plus `bench score`. No LLM
spend. Exit: `results/scores.json` regenerates from a clean clone.

**P1 — complete; official Amp panel evaluated.** `rubric.md`, `judge.ts` (blind,
multi-judge, kappa), and `probe.ts` contradiction rate are implemented. The historical OpenRouter
pilot remains preserved, while all official subjects use isolated Amp threads with exact model and
prompt provenance. The official results expose the rubric's remaining agreement weakness rather
than converting low-agreement scores into a ranking.

**P2 — complete.** `cost.ts` and derived per-page/per-claim economics are implemented. Official
runs preserve OpenCode JSON events and session exports, reject model substitution, and normalize
tokens, reported cost, latency, tool failures, page completions, and verified claims. The five
historical runs stay `null` and are labelled as such.

**P3 — execution complete; publication still gated.** All 60 outcomes across five pinned
repositories are retained. The runner captures immutable artifacts and telemetry, enforces one
model/session with no operator retry, and the leaderboard requires three trials on all five
subjects. The historical dataset cannot satisfy this gate retroactively because its prompt and
telemetry are unavailable.

**2026-09-12 Smaug amendment execution complete.** All 15 RouteLLM-hosted Smaug-Flash outcomes are
retained: 13 completed and two failed for forbidden subagent delegation (`cloudflare-os` seed 0 and
`pi-desktop` seed 2). One pre-matrix instrumentation attempt is preserved under `runs-invalid/`
because the initial custom-provider config omitted pricing and produced incomparable zero-cost
telemetry; its clean rerun uses the frozen catalog rates.

**2026-09-13 Pi Desktop evaluation complete.** In the original cohort, DeepSeek completed two of
three trials, GLM completed one of three, and Qwen timed out in all three. Smaug completed two of
three; seed 2 failed immediately for forbidden subagent delegation. The current non-Claude panel
completed 40 GPT-5.5 judgments, 40 Grok 4.6 judgments, 40 Astra tiebreak judgments, and 80 Astra
probes with exact task/model/prompt provenance. All page tasks crossed the disagreement threshold;
linear-weighted κ = 0.446 and exact agreement = 0.567, with no unresolved tasks. Pi Desktop is
therefore not publishable under the 0.6 agreement gate, and these results cannot support a ranking.

**2026-09-13 official evaluation complete.** The current panel produced 362 GPT-5.5 primary
judgments, 362 Grok 4.6 secondary judgments, 342 disagreement-only GPT-6 Astra Medium tiebreaks,
and 724 Astra correctness probes. Every task ID, prompt hash, requested mode, resolved model,
timestamp, and one-to-one output/provenance count validates. The original 45-outcome cohort misses
the κ gate on all five subjects (weighted κ 0.311–0.576). In the amended 60-outcome cohort,
Smallstep passes at 0.612 while Cloudflare OS, ExtractThinker, Celld, and Pi Desktop remain below
0.6. Both recommendations are therefore withheld in `results/FINAL-REPORT.md`.

OpenCode telemetry capture is mandatory for every official trial; a run without a valid session
export is failed because its cost and loop data are not recoverable afterwards.

## 9. Remaining evaluation work

No v1 execution or evaluation work remains. The frozen artifacts need a rubric-anchor revision and
independent rejudging before either cohort can publish a model recommendation; this is a v2 task,
not permission to mutate or rerun v1 contestant outputs.

## 10. Resolved design questions

- The benchmark reimplements and parity-tests OpenWiki's small `repo-lines-v1` hash contract rather than importing the full application.
- The official subjects are `cloudflare-os`, `smallstep-cli`, `extractthinker`, `celld`, and `pi-desktop` at the pins in section 3.1.
- The original official contestants are DeepSeek V4 Flash, GLM 5.3 Flash, and Qwen 3.8 Flash from OpenCode Go. The 2026-09-12 amendment adds RouteLLM-hosted Smaug-Flash. All use the same OpenCode agent through OpenWiki MCP; provider provenance remains part of the system identity.
- Split-model routing is a distinct agent system if added; it is never merged into a component model's row.

## 11. Version 2 candidates

The reviewed patterns from Warp Factory Benchmarks, SlopCodeBench, Harbor, SWE-bench, and OpenEval
are consolidated in [V2-CANDIDATES.md](V2-CANDIDATES.md). They are explicitly outside the frozen
v1 protocol. The recommended v2 direction is an iterative repository-understanding maintenance
track, backed by replay locks, content-addressed artifacts, append-only rejudging lineage, an
independent verifier, and a read-only trace/evidence viewer.
