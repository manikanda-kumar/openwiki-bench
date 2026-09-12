# OpenWiki Bench v2 candidates

This document consolidates the benchmark systems reviewed while building v1. It is a backlog for
v2, not permission to change the frozen v1 matrix, rubric, run contract, or judge panel.

## Decision

Keep OpenWiki Bench's Node/TypeScript harness and JSON artifact contract as the source of truth.
Borrow the strongest reproducibility and evaluation patterns below; do not migrate the benchmark
onto another framework. A migration during the current study would invalidate comparisons and
would discard capabilities that the general-purpose frameworks do not have.

The distinctive v2 track should measure **repository-understanding maintenance**: generate a wiki,
apply ordered repository or documentation requirements, reset model context between checkpoints,
and measure whether understanding stays correct as the codebase changes.

## Sources and disposition

| Source | What it contributes | Disposition |
| --- | --- | --- |
| [Warp Factory Benchmarks](https://www.warp.dev/blog/warp-factory-benchmarks) | Task × configuration matrices, historical-task replay, multidimensional scorers, Pareto views, and model-routing recommendations | Borrow the experiment and reporting model. WarpBench's runner, tasks, traces, and scorer implementation are hosted and not publicly reproducible. |
| [Warp Factory examples](https://github.com/warpdotdev/warp-factory-examples) | Definitions as code, structural validation, agent/runner configurations, and focused scorer examples | Borrow configuration ergonomics only. These examples configure Warp's hosted product and contain no public WarpBench implementation. |
| [SlopCodeBench](https://github.com/SprocketLab/slop-code-bench) and its [problem corpus](https://github.com/gabeorlanski/scb-problems) | Ordered specification checkpoints, persistent output with context resets, regression tests at every checkpoint, task/runner separation, contamination canaries, and repeated-run variance | Adopt the checkpoint concept in a new maintenance track; borrow corpus conventions and variance summaries. Do not copy code-sloppiness formulas onto Markdown. |
| [Harbor](https://github.com/harbor-framework/harbor) | Content-addressed dataset manifests, replay locks, typed trial/artifact results, network policy, isolation, and provider-independent adapters | Primary architecture reference for v2 replay locks and artifact manifests. Borrow patterns rather than adding Harbor as a runtime dependency. |
| [SWE-bench](https://github.com/SWE-bench/SWE-bench) and [experiments](https://github.com/SWE-bench/experiments) | Compact immutable task instances, reproducible container evaluation, explicit infra/error classifications, public trace contracts, and independent regrading | Adopt the public-submission and independent-verifier principles. Its patch/test task model does not fit wiki generation directly. |
| [OpenEval](https://github.com/Hona/openeval) | Content-addressed evidence, append-only execution/judgment lineage, active result selections, input/runtime fingerprints, rejudging, and a trace/evidence viewer | Borrow storage, lineage, fingerprint, and viewer ideas. Do not adopt its backend: v0.2 is young and assumes Bun, containers, OpenCode, one binary judge, and a 45-minute ceiling. |

## Candidate workstreams

### 1. Replay lock and artifact manifest — highest priority

Create one canonical lock per trial that hashes every replay-affecting input:

- subject URL and full Git SHA;
- prompt and ignore policy;
- system configuration and selected model;
- OpenCode, OpenWiki MCP, and harness versions;
- agent, permissions, environment policy, timeout, and resource limits;
- rubric, judge configurations, sampling seed, and task manifests.

Create a content-addressed artifact manifest covering raw events, exported sessions, generated
wiki files, claims, plans, normalized telemetry, judgments, probes, and reports. Verification must
recompute every digest and reject missing, changed, or unlisted files.

References: Harbor's
[`lock.py`](https://github.com/harbor-framework/harbor/blob/main/src/harbor/models/job/lock.py) and
OpenEval's
[`evidence/index.ts`](https://github.com/Hona/openeval/blob/main/packages/openeval/src/infra/evidence/index.ts).

### 2. Execution and rejudging lineage

Store attempts append-only. Keep the distinction between:

- a contestant trial;
- an infrastructure-invalid attempt;
- a judge attempt;
- a selected valid judgment;
- a superseded selection.

Rejudging must create a new record over immutable contestant evidence. It must never overwrite the
old panel or imply that a contestant was rerun. A frozen publication snapshot selects exact trial,
judgment, probe, and scorer artifact hashes.

Reference: OpenEval's
[`sqlite/index.ts`](https://github.com/Hona/openeval/blob/main/packages/openeval/src/infra/sqlite/index.ts)
and
[`rejudge.ts`](https://github.com/Hona/openeval/blob/main/packages/openeval/src/app/rejudge.ts).

### 3. OpenWiki Maintenance Bench — defining v2 feature

For a pinned base repository:

1. Generate and score the initial wiki.
2. Apply an authored, pinned repository change or a new documentation requirement.
3. Start a fresh model context while preserving the agent's wiki.
4. Ask the agent to identify and repair affected documentation.
5. Repeat for several ordered checkpoints.

Each checkpoint needs a reference impact set and deterministic regression checks. Candidate
metrics:

- stale or contradicted claim rate after the change;
- impacted-page recall: expected affected pages actually updated;
- edit precision: changed pages that genuinely required revision;
- evidence repair rate and exact-hash recovery;
- broken-link and taxonomy regressions;
- unnecessary content churn and duplicate-claim growth;
- convergence, failures, latency, tokens, and cost per repaired claim.

This adapts SlopCodeBench's iterative-degradation experiment without pretending that source-code
verbosity or cyclomatic-complexity formulas measure documentation quality.

### 4. Judge robustness and human calibration

Keep deterministic grounding and structural checks primary. For semantic axes:

- retain blind independent judges and disagreement-only tiebreaks;
- swap anonymous A/B ordering on a calibration subset to detect position bias;
- repeat a fixed subset to measure judge self-consistency;
- maintain a small expert-human gold set;
- report judge/human agreement separately from judge/judge agreement;
- version rubric anchors and prohibit mixing panels in one ranking.

SlopCodeBench's critique of naive scalar LLM judging reinforces the current κ gate; it does not
justify removing semantic evaluation altogether.

### 5. Public result bundle and independent verifier

Publish two layers:

1. a compact leaderboard entry containing system identity, selected artifact hashes, metrics,
   uncertainty, costs, failures, and publication-gate status;
2. a complete trace/evidence bundle that a third party can verify and rescore without rerunning
   inference.

The verifier should derive reported scores from immutable outputs, detect incomplete execution,
distinguish contestant/provider/infra failures, and refuse unknown schema versions. This follows
SWE-bench's public artifact contract while retaining OpenWiki-specific evidence checks.

### 6. Results and trace viewer

Build a read-only viewer over OpenWiki Bench's neutral JSON schema rather than importing another
framework's database. Initial views:

- matrix progress and terminal outcome by repo, system, and seed;
- trace timeline with model/tool calls, failures, page submissions, cost, and latency;
- generated page beside claims and exact cited source excerpts;
- judge rationale, disagreement, tiebreak, and provenance drilldown;
- quality/cost/reliability Pareto plots;
- repository, language, architecture, and complexity slices;
- publication blockers displayed before any winner.

OpenEval's
[`viewer`](https://github.com/Hona/openeval/tree/main/packages/viewer) is the best UI reference,
but an adapter should consume OpenWiki artifacts rather than require `runner.db`.

### 7. Recommendations and routing — downstream, not part of scoring

Generate recommendations per repository/task class only when evidence supports them. A future
router may use language, repository scale, architecture, or task type to choose a system, but it
must be validated prospectively with an A/B test. Benchmark results alone do not prove that future
tasks have the same distribution.

Warp's routing loop is the reference. The benchmark should emit machine-readable recommendations;
it should not silently change production routing.

## Delivery order

1. **Freeze v1:** finish all 45 outcomes, current-panel judging, verification, and publication-gated report.
2. **v2.1 — reproducibility:** replay lock, artifact manifest, schema versions, append-only attempt/selection lineage, publication snapshot.
3. **v2.2 — independent review:** portable result bundle and standalone verifier.
4. **v2.3 — maintenance pilot:** authored checkpoint sequence on two contrasting repositories before expanding the matrix.
5. **v2.4 — analysis UI:** trace/evidence viewer and Pareto/slice visualizations.
6. **v2.5 — routing experiment:** recommendations followed by prospective A/B validation.

## Explicit non-candidates

- Replacing the active v1 harness with Warp, Harbor, SWE-bench, SlopCodeBench, or OpenEval.
- Mixing maintenance-track scores with one-shot v1 scores.
- Treating one weighted aggregate as sufficient without cost, reliability, variance, and worst-subject results.
- Using LOC or code-complexity formulas as documentation-quality scores without independent validation.
- Allowing retries to erase provider/model failures or allowing rejudging to overwrite provenance.
- Building a router before the benchmark has a publishable, independently verifiable result.

## v2 exit criteria

V2 is ready for publication when:

- every selected execution can be reproduced from one validated lock;
- every published number can be rederived from a hashed public artifact bundle;
- maintenance checkpoints detect stale understanding and regressions, not only initial quality;
- judge robustness is calibrated against expert labels;
- uncertainty, failures, and repository slices accompany every recommendation;
- the viewer is read-only over the same artifacts consumed by the CLI verifier.
