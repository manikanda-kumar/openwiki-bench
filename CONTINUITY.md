Goal (incl. success criteria):
- Deliver the standalone OpenWiki benchmark across deterministic, semantic, economics, and statistical phases; preserve historical runs and refuse unsupported rankings.
Constraints/Assumptions:
- Subject is manikanda-kumar/background-agents at 32470cc2e6985ee55cabdd786e20a17f2998f520.
- Official matrix is 3 OpenCode Go models × 3 independent trials × 5 pinned repositories = 45 runs.
- Never guess unrecoverable historical fields; use null.
- Existing plan status counters are stale; completeness uses planned page paths present on disk.
Key decisions:
- Reimplement the pinned-SHA repo-lines-v1 exact hash check locally rather than depend on the whole OpenWiki package; document parity and test it.
- Score an agent system (model + runtime), retaining runtime as a first-class manifest field.
- Require three trials per subject across five subjects, completed probes, no unresolved judgments, and Cohen's kappa >= 0.6 for publication.
- Hold the OpenCode agent + OpenWiki MCP runtime constant; vary only DeepSeek V4 Flash, GLM 5.3 Flash, and Qwen 3.8 Flash from OpenCode Go.
- Official blind judging uses isolated Amp threads with exact Fable 5, Opus 4.8, and GPT-5.5 resolution; OpenRouter artifacts are pilot provenance only.
State:
- P0-P2 framework and historical P1 evaluation complete; official 45-run P3 matrix is planned. Changes are uncommitted.
Done:
- Located five source runs and inspected claim, plan, page-manifest, and OpenWiki resolver formats.
- Migrated all five source runs byte-for-byte, added run manifests and subject metadata.
- Implemented pinned-SHA grounding, structure scoring, deterministic reporting, docs, and tests.
- Generated results/scores.json and results/REPORT.md; auto-clone output matches local-checkout output byte-for-byte.
- Implemented blind rubric judging, disagreement-only tiebreaks, source-only probes, telemetry economics, publication-gated leaderboard, and isolated run capture.
- Completed 31 Fable + 31 Opus judgments, 24 GPT tiebreaks, and 62 GPT correctness probes. No unresolved tasks; overall kappa is 0.476, with taxonomy/style anchors weakest, below the 0.6 gate.
- Selected and pinned cloudflare-os, smallstep-cli, ExtractThinker, celld, and pi-desktop; removed guessed native configs in favor of a frozen future OpenCode + OpenWiki MCP invocation.
- Added and verified Amp orb lifecycle setup: OpenCode 1.18.25, OpenWiki 0.4.3, user-level OpenWiki MCP integration, OpenCode Go credential aliasing, and a no-inference preflight for all three models.
Now:
- Orb setup and historical benchmark framework are verified; setup changes are committed locally and not pushed.
Next:
- Re-freeze clearer rubric anchors, freeze Amp judging and the OpenCode invocation/telemetry contract, then execute 45 trials.
Open questions (UNCONFIRMED if needed):
- Exact start/end times and resume counts absent from source artifacts remain null.
- Reproducible non-interactive OpenCode + OpenWiki MCP command and telemetry capture must be smoke-tested before trial 0.
- Exact Amp modes/model-resolution metadata for Fable 5, Opus 4.8, and GPT-5.5 must be preflighted before official judging.
Working set (files/ids/commands):
- PLAN.md; README.md; METHODOLOGY.md; src/*; bin/bench.ts; systems/*; subjects/*; runs/background-agents/*; results/*
- Verification: npm run verify; npm run score -- --repo /tmp/background-agents; npm run bench -- prepare --repo /tmp/background-agents
