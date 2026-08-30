# Methodology

## Evaluation unit

A row is an agent system: model + runtime + subject + seed. Native OpenWiki, Grok host-agent, and OpenCode host-agent runs are not collapsed into “the same model,” because tool APIs, orchestration, retry behavior, and context management materially affect results.

## Reproducibility boundary

Each subject manifest pins a full Git SHA. Scoring rejects a supplied checkout whose `HEAD` differs. Without `--repo`, the CLI clones the subject and checks out that SHA detached. Run artifacts and manifests are committed; generated scores contain neither timestamps nor machine-specific paths.

Historical facts that cannot be recovered are `null`, never inferred. In particular, the original host summaries do not contain seed paths, so seed coverage for those runs is `null`, not zero.

## Grounding

For every evidence item in `.claims/**/*.json`:

- **resolvable**: the normalized `repo://` path exists as a regular, non-symlink file inside the pinned checkout.
- **in range**: the requested inclusive line range exists. Whole-file evidence is in range when the file resolves.
- **exact**: SHA-256 of the exact selected bytes equals the content hash in its `repo-lines-v1` or `repo-file-v1` version.

The line splitter and hash definition match OpenWiki's `RepositoryEvidenceResolver`: line terminators remain in selected content and a terminal newline creates no phantom line. Relocation metadata is intentionally not used because benchmark scoring occurs at the original pinned SHA; accepting relocated evidence would weaken the exactness test.

An exact citation proves source identity, **not semantic entailment**. A claim may cite exact bytes and still misinterpret them. The source-only correctness probe addresses that separate question.

## Structure

- **completeness**: planned page paths present on disk divided by planned page count. This uses files rather than stored status counters because the captured native summaries were updated before generation stopped and are observably stale.
- **link integrity**: resolvable internal wiki links divided by all internal wiki links. External URLs and same-page anchors are excluded. Links to unfinished planned pages remain broken.
- **repository coverage**: tracked top-level directories plus each tracked `packages/*` directory cited at least once. The units come from `git ls-tree`, so local build directories cannot alter the score.
- **seed coverage**: unique plan `seedPaths` cited at least once. Reported as unavailable when a historical plan did not preserve seeds.
- **density**: evidence items per 100 Markdown lines, lines per page, and claims/evidence ratios.
- **redundancy**: mean pairwise Jaccard similarity of each claim page's cited-file set. Lower overlap is descriptive, not automatically better; some cross-cutting topics legitimately share evidence.

Index pages count as Markdown pages for density and link integrity, but completeness only considers planned pages.

## Correctness probes

Two claims are sampled deterministically from each judged page. A judge receives only the statement and exact cited excerpts, never model, repository, run, page, or claim identifiers. It labels each item `supported`, `unsupported`, or `contradicted`. Results report all three counts, support/unsupported/contradiction rates, and a 95% Wilson interval for contradiction rate. Missing or duplicate labels make aggregation fail.

## Blind rubric judging

The six axes in `rubric.md` are scored 0–4 per page. The fixed subset prioritizes quickstart, architecture/overview, and control-plane pages, then selects deterministic seeded pages up to the limit. Frontmatter and contestant identities are removed. Fable 5 and Opus 4.8 score every page; GPT-5.5 scores only pages where any axis differs and also judges correctness probes. Official judging uses one fresh repository-less Amp thread per blind task. The private manifest records the Amp thread, requested mode, and resolved model/version; model substitution invalidates the task. The aggregate uses the per-axis median and multiplies each wiki's page mean by completeness and repository coverage.

Cohen's κ is calculated over every primary/secondary axis decision and reported separately per axis for diagnosis. Overall κ below 0.6 or any unresolved judgment blocks publication. This gate is deliberately strict: low agreement means the rubric has not earned a ranking.

## Cost and agent-loop telemetry

`cost` normalizes LangSmith exports or proxy JSON/JSONL into input/output tokens, USD, latency, tool calls/failures, redundant reads, cost per finished page, and cost per verified claim. Repeated reads of the same normalized file beyond two count as redundant. Historical runs without traces remain `null`; zero is never substituted for unknown spend.

## Recommendations

Structural recommendations are rule-based labels over completed runs: broadest repository coverage, fewest lines per page, and strongest link integrity. Incomplete or dead runs remain in results but cannot be recommended. An overall leader is emitted only when the leaderboard passes every publication gate; otherwise the report names the blockers.

## Statistical publication gate

Each system needs three independent trials on each of the five pinned subjects, completed semantic judging, correctness probes, no unresolved tiebreaks, and κ ≥ 0.6. The leaderboard reports means and sample standard deviations. Subjects receive equal weight. The unit remains model + runtime; the official matrix holds the OpenCode agent runtime constant and varies only the OpenCode Go model.

## Current dataset validity limits

- One public subject and one seed per system
- Public outputs, so future contamination is possible
- LLM judging is itself model-dependent even with blinding and multiple judges
- No token, cost, latency, or tool-call traces for these historical runs

The historical dataset validates the harness and exposes process/output differences. It is not sufficient for a publishable general model ranking until the 45-run five-subject matrix and official Amp judging are complete.
