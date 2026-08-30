# OpenWiki Bench — results

Subject: `background-agents` at `32470cc2e6985ee55cabdd786e20a17f2998f520`.

| Model system | Outcome | Complete | Exact evidence | Link integrity | Repo coverage | Seed coverage | Lines/page |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deepseek-v4-flash (native) | complete | 26/26 | 100.0% | 100.0% | 100.0% | 83.3% | 281.0 |
| glm-5.3-flash (native) | incomplete | 2/27 | 100.0% | 14.3% | 35.7% | 22.1% | 281.5 |
| grok-4.6 (host-grok) | complete | 24/24 | 100.0% | 100.0% | 71.4% | n/a | 92.2 |
| qwen3.8-flash (native) | died | 5/38 | 100.0% | 18.2% | 78.6% | 42.0% | 428.8 |
| qwen3.8-flash (host-opencode) | complete | 19/19 | 100.0% | 98.6% | 78.6% | n/a | 62.5 |

## Blind semantic evaluation

| Model system | Rubric score | Supported claims | Contradicted claims | Seeds/subject | Subjects |
| --- | ---: | ---: | ---: | ---: | ---: |
| deepseek-v4-flash (native) | 3.312 | 37.5% | 6.3% | 1 | 1 |
| qwen3.8-flash (host-opencode) | 2.635 | 31.3% | 0.0% | 1 | 1 |
| grok-4.6 (host-grok) | 2.381 | 43.8% | 0.0% | 1 | 1 |
| qwen3.8-flash (native) | 0.379 | 10.0% | 0.0% | 1 | 1 |
| glm-5.3-flash (native) | 0.090 | 50.0% | 0.0% | 1 | 1 |

Primary-judge agreement: κ = 0.476 overall (taxonomy_fit -0.002, code_grounding 0.491, reasoning_depth 0.838, change_usefulness 0.498, style 0.213, correctness 0.716).

Status: **not publishable**. Blockers: fewer than three trials per subject for one or more systems; fewer than five subjects for one or more systems; primary-judge Cohen's kappa is below 0.6.

## Recommendations

- **Coverage-first candidate:** deepseek-v4-flash (native) (100.0% package/top-level coverage).
- **Most concise complete candidate:** qwen3.8-flash (host-opencode) (62.5 lines/page).
- **Best link integrity candidate:** deepseek-v4-flash (native) and grok-4.6 (host-grok) (100.0%).
- **Overall model recommendation:** withheld. Publication blockers: fewer than three trials per subject for one or more systems; fewer than five subjects for one or more systems; primary-judge Cohen's kappa is below 0.6.

## Interpretation

“Exact evidence” proves cited bytes match the pinned source; it does **not** prove that a claim logically follows from those bytes. The support/contradiction probes test that separately. Incomplete runs remain visible but are excluded from structural recommendations. Model and runtime are reported together because this benchmark evaluates the agent system, not an isolated model API.
