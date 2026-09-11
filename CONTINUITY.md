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
- Require three trials per subject across five subjects, completed probes, no unresolved judgments, and linear-weighted Cohen's kappa >= 0.6 for publication; report exact agreement and unweighted kappa too.
- Hold the OpenCode agent + OpenWiki MCP runtime constant; vary only DeepSeek V4 Flash, GLM 5.3 Flash, and Qwen 3.8 Flash from OpenCode Go.
- Current official blind judging uses isolated Amp threads with GPT-5.5 `deep-classic` primary, Grok 4.6 secondary, and GPT-6 Astra Medium for tiebreaks/probes. Claude-panel artifacts from the first two subjects remain historical and require rejudging before final comparison.
State:
- P0-P2 framework and historical P1 evaluation complete. Contestant execution and semantic evaluation are complete through `extractthinker`; next subject is `celld`.
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
- `smallstep-cli`: DeepSeek 3/3 complete; GLM 2/3 complete with one forbidden-delegation failure; Qwen 2/3 complete with one upstream HTTP 503. Official contestant spend is $2.585702. Rubric v2 weighted κ passes at 0.603.
- `cloudflare-os`: DeepSeek 1/3 complete with two forbidden-delegation failures; GLM and Qwen 3/3 complete. One externally interrupted GLM seed-0 attempt is preserved under `runs-invalid/` and its clean rerun is official. All 56 GPT-5.5, 56 Opus, 55 Fable disagreement, and 112 Fable probe tasks have exact model and prompt-hash provenance. No unresolved tasks, but weighted κ=0.560 is below the 0.6 subject gate (exact agreement=0.661).
- Scoring now retains early failed trials that legitimately have no `plan.summary.json`; regression test added. `npm run verify` passes 18/18.
- `extractthinker`: DeepSeek 2/3 complete with one provider bad-request failure; GLM and Qwen 3/3 complete. A pre-inference China-hosting opt-in attempt is preserved under `runs-invalid/` and excluded. Current non-Claude panel completed 58 GPT-5.5, 58 Grok 4.6, 56 GPT-6 Astra Medium tiebreak, and 116 Astra probe tasks with validated exact-model/prompt provenance. No unresolved tasks; weighted κ=0.472 is below the 0.6 gate (exact agreement=0.557).
Next:
- Execute and judge `celld`, then `pi-desktop`. Rejudge the first two subjects with the current non-Claude panel before final ranking.
Open questions (UNCONFIRMED if needed):
- Exact start/end times and resume counts absent from source artifacts remain null.
- None.
Working set (files/ids/commands):
- `judges/official/*`; `runs/extractthinker/*`; `runs-invalid/extractthinker/*`; `results/extractthinker/*`
- Verification: `npm run verify`; provenance/model/prompt-hash validation script; credential-pattern scan over retained Cloudflare raw artifacts
- Exhausted schedule: `81a72383-69d5-4b61-b6f0-283daabcfdd8` (fired 2026-08-31 05:30 IST)
