Goal (incl. success criteria):
- Deliver the standalone OpenWiki benchmark across deterministic, semantic, economics, and statistical phases; preserve historical runs and refuse unsupported rankings.
Constraints/Assumptions:
- Subject is manikanda-kumar/background-agents at 32470cc2e6985ee55cabdd786e20a17f2998f520.
- Official matrix is amended to 4 models × 3 independent trials × 5 pinned repositories = 60 runs: the original 45-run OpenCode Go matrix plus 15 RouteLLM Smaug-Flash trials.
- Never guess unrecoverable historical fields; use null.
- Existing plan status counters are stale; completeness uses planned page paths present on disk.
Key decisions:
- Reimplement the pinned-SHA repo-lines-v1 exact hash check locally rather than depend on the whole OpenWiki package; document parity and test it.
- Score an agent system (model + runtime), retaining runtime as a first-class manifest field.
- Require three trials per subject across five subjects, completed probes, no unresolved judgments, and linear-weighted Cohen's kappa >= 0.6 for publication; report exact agreement and unweighted kappa too.
- The original cohort holds the OpenCode agent + OpenWiki MCP runtime constant and varies DeepSeek V4 Flash, GLM 5.3 Flash, and Qwen 3.8 Flash from OpenCode Go.
- Add RouteLLM Smaug-Flash as a fourth coding-specialized contestant under the same OpenCode + OpenWiki MCP runtime; retain the original three-system matrix as a comparable cohort.
- Current official blind judging uses isolated Amp threads with GPT-5.5 `deep-classic` primary, Grok 4.6 secondary, and GPT-6 Astra Medium for tiebreaks/probes. Claude-panel artifacts from the first two subjects remain historical and require rejudging before final comparison.
- V2 stays native to the current Node/TypeScript artifact contract. Borrow replay locks, content-addressed evidence, append-only selection/rejudging lineage, independent verification, iterative maintenance checkpoints, and a read-only viewer from the reviewed frameworks; do not migrate v1.
State:
- P0-P3 framework and all 60 contestant outcomes are complete. Current-panel evaluation is complete for ExtractThinker, Celld, and Pi Desktop; the first two subjects still require current-panel rejudging before final aggregation.
Done:
- Located five source runs and inspected claim, plan, page-manifest, and OpenWiki resolver formats.
- Migrated all five source runs byte-for-byte, added run manifests and subject metadata.
- Implemented pinned-SHA grounding, structure scoring, deterministic reporting, docs, and tests.
- Generated results/scores.json and results/REPORT.md; auto-clone output matches local-checkout output byte-for-byte.
- Implemented blind rubric judging, disagreement-only tiebreaks, source-only probes, telemetry economics, publication-gated leaderboard, and isolated run capture.
- Completed 31 Fable + 31 Opus judgments, 24 GPT tiebreaks, and 62 GPT correctness probes. No unresolved tasks; overall kappa is 0.476, with taxonomy/style anchors weakest, below the 0.6 gate.
- Selected and pinned cloudflare-os, smallstep-cli, ExtractThinker, celld, and pi-desktop; removed guessed native configs in favor of a frozen future OpenCode + OpenWiki MCP invocation.
- Added and verified Amp orb lifecycle setup: OpenCode 1.18.25, OpenWiki 0.4.3, user-level OpenWiki MCP integration, OpenCode Go credential aliasing, and a no-inference preflight for all three models.
- Consolidated Warp, SlopCodeBench, Harbor, SWE-bench, and OpenEval patterns and the recommended maintenance-benchmark direction in `V2-CANDIDATES.md`; linked it from `PLAN.md`.
- Fixed CLI subject scoping so `--subject` selects `results/<subject>/evaluation` defaults instead of the global pilot evaluation directory.
Now:
- Smaug-Flash produced 13/15 complete outcomes; `cloudflare-os` seed 0 and `pi-desktop` seed 2 are immutable forbidden-subagent deaths. Completed manifest spend is $1.349608; catalog-priced spend across all official sessions is $1.356189. A pre-matrix zero-cost instrumentation attempt is retained under `runs-invalid/smallstep-cli/smaug-flash-opencode/` and excluded.
- `smallstep-cli`: DeepSeek 3/3 complete; GLM 2/3 complete with one forbidden-delegation failure; Qwen 2/3 complete with one upstream HTTP 503. Official contestant spend is $2.585702. Rubric v2 weighted κ passes at 0.603.
- `cloudflare-os`: DeepSeek 1/3 complete with two forbidden-delegation failures; GLM and Qwen 3/3 complete. One externally interrupted GLM seed-0 attempt is preserved under `runs-invalid/` and its clean rerun is official. All 56 GPT-5.5, 56 Opus, 55 Fable disagreement, and 112 Fable probe tasks have exact model and prompt-hash provenance. No unresolved tasks, but weighted κ=0.560 is below the 0.6 subject gate (exact agreement=0.661).
- Scoring now retains early failed trials that legitimately have no `plan.summary.json`; regression test added. `npm run verify` passes 19/19.
- `extractthinker`: DeepSeek 2/3 complete with one provider bad-request failure; GLM and Qwen 3/3 complete. A pre-inference China-hosting opt-in attempt is preserved under `runs-invalid/` and excluded. Current non-Claude panel completed 58 GPT-5.5, 58 Grok 4.6, 56 GPT-6 Astra Medium tiebreak, and 116 Astra probe tasks with validated exact-model/prompt provenance. No unresolved tasks; weighted κ=0.472 is below the 0.6 gate (exact agreement=0.557).
- `celld`: all 9 official trial outcomes are final. DeepSeek and GLM are 3/3 complete; Qwen seeds 0-1 are complete and seed 2 is an official timeout failure after completing 2/17 pages. Its first attempt was externally terminated by Amp and is preserved under `runs-invalid/celld/.../seed-2-infra-interrupted/`. All 64 GPT-5.5, 64 Grok 4.6, 62 Astra tiebreak, and 128 Astra probe results passed task-ID, prompt-hash, mode, and model provenance validation. No unresolved tasks; weighted κ=0.378, exact agreement=0.521, so publication is blocked. Coverage-penalized means over successful runs: DeepSeek 2.491, GLM 2.722, Qwen 2.948.
- `pi-desktop`: all 12 outcomes are final. In the original cohort, DeepSeek completed seeds 0-1 and seed 2 timed out; GLM completed seed 0 and seeds 1-2 timed out; all three Qwen seeds timed out. Smaug completed seeds 0-1 and seed 2 failed for forbidden subagent delegation. Two externally interrupted DeepSeek attempts remain excluded under `runs-invalid/pi-desktop/`. The current panel completed 40 GPT-5.5, 40 Grok 4.6, 40 Astra tiebreak, and 80 Astra probe tasks with validated task IDs, prompt hashes, modes, and models. No unresolved tasks; weighted κ=0.446 and exact agreement=0.567, so publication is blocked.
Next:
- Rejudge Smallstep and Cloudflare with the current panel before final aggregation.
Open questions (UNCONFIRMED if needed):
- Exact start/end times and resume counts absent from source artifacts remain null.
- None.
Working set (files/ids/commands):
- `judges/official/*`; `runs/pi-desktop/*`; `runs-invalid/pi-desktop/*`; `results/pi-desktop/*`
- No active Pi Desktop services.
- Smaug-Flash artifacts: `systems/smaug-flash-opencode.json`; `runs/*/smaug-flash-opencode/`; one excluded instrumentation attempt under `runs-invalid/smallstep-cli/smaug-flash-opencode/`.
- Active 30-minute monitor: schedule `64bf290e-1403-5da8-ba35-e3072a214d66`; clear after Pi Desktop judging and verification complete.
- Pi Desktop verification passed: 19/19 tests, exact task/model/prompt provenance, 12/12 final manifests, retained-session model checks, and a high-confidence credential scan over 371 artifact files.
