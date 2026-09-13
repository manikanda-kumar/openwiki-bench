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
- Current official blind judging uses isolated Amp threads with GPT-5.5 `deep-classic` primary, Grok 4.6 secondary, and GPT-6 Astra Medium for tiebreaks/probes. Earlier Claude-panel artifacts remain historical and are excluded from the completed current-panel comparison.
- V2 stays native to the current Node/TypeScript artifact contract. Borrow replay locks, content-addressed evidence, append-only selection/rejudging lineage, independent verification, iterative maintenance checkpoints, and a read-only viewer from the reviewed frameworks; do not migrate v1.
State:
- V1 framework, all 60 contestant outcomes, current-panel judging, and separate original/amended cohort aggregation are complete. Both cohorts are blocked from publication by judge agreement.
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
- The official current panel completed 362 GPT-5.5 judgments, 362 Grok 4.6 judgments, 342 Astra disagreement tiebreaks, and 724 Astra probes; exact task IDs, prompt hashes, modes, resolved models, uniqueness, counts, and timestamps validate.
- Subject weighted κ (original/amended): Smallstep 0.576/0.612; Cloudflare OS 0.435/0.458; ExtractThinker 0.472/0.490; Celld 0.378/0.388; Pi Desktop 0.311/0.446. Only amended Smallstep passes the 0.6 gate.
- Scoring retains early failed trials that legitimately have no `plan.summary.json`. Cohort aggregation rejects mixed panels and incomplete semantic coverage, macro-averages subjects, and separates reliability-adjusted quality. `npm run verify` passes 23/23.
- `results/cohorts/original-45.json`, `results/cohorts/amended-60.json`, and `results/FINAL-REPORT.md` are generated. Neither cohort is publishable, so both recommendations are withheld.
Next:
- Begin v2 only on explicit request; do not rerun v1 outputs or push the local commits without explicit authorization.
Open questions (UNCONFIRMED if needed):
- Exact start/end times and resume counts absent from source artifacts remain null.
- None.
Working set (files/ids/commands):
- `results/{smallstep-cli,cloudflare-os,extractthinker,celld,pi-desktop}/evaluation/*-v3.json`; `results/cohorts/*`; `results/FINAL-REPORT.md`.
- No orb services are running.
- Smaug-Flash artifacts: `systems/smaug-flash-opencode.json`; `runs/*/smaug-flash-opencode/`; one excluded instrumentation attempt under `runs-invalid/smallstep-cli/smaug-flash-opencode/`.
- The 30-minute monitor's completion condition is reached; clear schedule `fd1dc33a-9845-5947-bfd8-1346ab8098fc` after the final local commit.
- Pi Desktop verification passed: 19/19 tests, exact task/model/prompt provenance, 12/12 final manifests, retained-session model checks, and a high-confidence credential scan over 371 artifact files.
