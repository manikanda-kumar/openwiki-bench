# OpenWiki Bench

An official evaluation harness for comparing the **agent systems** that generate OpenWiki documentation: model, runtime, tool loop, and recovery behavior. It preserves run artifacts, verifies their source grounding against a pinned repository revision, measures output structure, and produces machine-readable results plus deliberately scoped recommendations.

The historical pilot dataset is five OpenWiki 0.4.3 runs over [`manikanda-kumar/background-agents`](https://github.com/manikanda-kumar/background-agents/tree/main/openwiki-bench) at `32470cc2`. The planned official benchmark is 3 OpenCode Go models × 3 independent trials × 5 pinned repositories = 45 runs.

## What it measures

- **Navigation and code understanding:** source/package coverage, seed-path coverage, and exact cited evidence.
- **Reasoning and writing:** six anchored, blind per-page rubric scores from two judges plus disagreement-only tiebreaks.
- **Correctness:** statement-versus-source probes labelled supported, unsupported, or contradicted, with a Wilson interval.
- **Agent loops:** completion, deaths/resumes, tool failures, redundant reads, latency, and tokens when telemetry exists.
- **Economics:** cost per finished page and verified claim; missing historical usage remains `null`.
- **Reliability:** mean and sample standard deviation across trials and subjects.

The checked-in historical dataset has one seed and one subject per system. The framework therefore marks it **not publishable** rather than manufacturing statistical confidence.

## Run it

Requires Node 22+ and Git.

```bash
npm ci
npm run score   # deterministic metrics; clones the pinned subject automatically
npm run bench -- prepare --repo /path/to/background-agents
npm run report
npm test
npm run typecheck
```

To reuse an existing subject checkout, it must be at the exact recorded SHA:

```bash
npm run score -- --repo /path/to/background-agents
```

Outputs are stable: no timestamps or local paths are written into scores.

## Planned official matrix

Every run will use the same OpenCode agent and OpenWiki MCP generation path. Only the OpenCode Go model changes:

- `opencode-go/deepseek-v4-flash`
- `opencode-go/glm-5.3-flash`
- `opencode-go/qwen3.8-flash`

The five subjects are `cloudflare-os`, `smallstep-cli`, `extractthinker`, `celld`, and `pi-desktop`. See [PLAN.md](PLAN.md#31-official-45-run-matrix) for pins and selection rationale.

The non-interactive OpenCode invocation and telemetry capture will be smoke-tested and frozen before trial 0. Executable configs are deliberately not guessed. Once frozen, the runner will check out each pinned subject in isolation, install the shared brief, record prompt/ignore hashes, capture OpenCode and OpenWiki artifacts, and refuse to overwrite a trial.

## Semantic evaluation

The checked-in pilot judgments used OpenRouter and are preserved as dated provenance. Official evaluation will run blind tasks in fresh, repository-less Amp threads using Fable 5, Opus 4.8, and GPT-5.5, then import the same JSON contracts consumed by the aggregation commands below. Exact resolved model IDs must be recorded; Amp routing may not silently substitute another model.

```bash
# Prepare opaque, deterministic page and claim tasks
npm run bench -- prepare --repo /path/to/background-agents

# After importing Amp results, select only primary/secondary disagreements
npm run bench -- judge disagreements \
  --primary fable-5 --secondary opus-4.8 \
  --primary-judgments results/evaluation/judgments-fable-5.json \
  --secondary-judgments results/evaluation/judgments-opus-4.8.json
npm run bench -- judge aggregate \
  --judgments results/evaluation/judgments-fable-5.json,results/evaluation/judgments-opus-4.8.json,results/evaluation/judgments-gpt-5.5.json \
  --judges fable-5,opus-4.8,gpt-5.5

npm run bench -- probe aggregate \
  --labels results/evaluation/probe-labels-probe-gpt-5.5.json
```

Aggregation rejects missing/duplicate probe labels and duplicate judgments. Judge identities are checked against contestant models. `leaderboard` refuses publication below Cohen's κ = 0.6, with unresolved judgments, without probes, or below three trials × five subjects per system.

Telemetry accepts normalized proxy JSON/JSONL and LangSmith exports:

```bash
npm run bench -- cost --input traces.jsonl
npm run bench -- leaderboard \
  --scores results/scores.json \
  --judged results/evaluation/judged-scores.json \
  --probes results/evaluation/probe-scores.json
npm run report
```

## Layout

```text
bin/bench.ts                         CLI
src/grounding.ts                     claim evidence verification
src/structure.ts                     deterministic wiki metrics
src/report.ts                        scoped recommendations
src/run.ts                           isolated run + artifact capture
src/judge.ts                         blind rubric judging and agreement
src/probe.ts                         source-only correctness probes
src/cost.ts                          normalized telemetry economics
subjects/background-agents.json      pinned subject definition
subjects/{cloudflare-os,...}.json    five official pinned subjects
systems/README.md                    planned OpenCode Go systems
judges/README.md                     official Amp judge protocol
runs/background-agents/*/seed-0/     immutable run artifacts + manifests
results/scores.json                   generated machine results
results/leaderboard.json              publication-gated cross-run results
results/REPORT.md                     generated human report
results/COMPARISON-2026-08-29.md      original qualitative study
```

See [METHODOLOGY.md](METHODOLOGY.md) for metric definitions and validity limits, and [PLAN.md](PLAN.md) for the remaining phases.
