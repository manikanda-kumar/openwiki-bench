# OpenWiki Bench — final cohort evaluation

The original cohort contains 3 OpenCode Go systems × 3 trials × 5 subjects. The amended cohort adds RouteLLM-hosted Smaug-Flash and contains 4 systems under the same OpenCode + OpenWiki MCP runtime contract. Smaug is a model-and-provider system amendment, not a provider-controlled model comparison.

## Original 45-outcome cohort

| Model system | Completion | Reliability-adjusted rubric | Complete-output rubric | Supported | Contradicted |
| --- | ---: | ---: | ---: | ---: | ---: |
| opencode-go/deepseek-v4-flash (host-opencode) | 73.3% | 1.301 ± 0.762 | 1.683 ± 0.493 | 37.3% | 3.8% |
| opencode-go/glm-5.3-flash (host-opencode) | 80.0% | 1.656 ± 0.805 | 2.004 ± 0.449 | 32.5% | 5.2% |
| opencode-go/qwen3.8-flash (host-opencode) | 66.7% | 1.568 ± 0.908 | 2.411 ± 0.425 | 40.9% | 4.9% |

| Model system | Exact grounding | Wiki completeness | Repository coverage | Link integrity |
| --- | ---: | ---: | ---: | ---: |
| opencode-go/deepseek-v4-flash (host-opencode) | 86.7% | 77.3% | 57.2% | 75.1% |
| opencode-go/glm-5.3-flash (host-opencode) | 100.0% | 92.4% | 74.2% | 81.9% |
| opencode-go/qwen3.8-flash (host-opencode) | 80.0% | 71.0% | 61.5% | 73.8% |

**Recommendation:** Withheld. Publication blockers: smallstep-cli: primary-judge linear-weighted Cohen's kappa is below 0.6; cloudflare-os: primary-judge linear-weighted Cohen's kappa is below 0.6; extractthinker: primary-judge linear-weighted Cohen's kappa is below 0.6; celld: primary-judge linear-weighted Cohen's kappa is below 0.6; pi-desktop: primary-judge linear-weighted Cohen's kappa is below 0.6.

| Subject | Weighted κ | Exact agreement | Status |
| --- | ---: | ---: | --- |
| celld | 0.378 | 52.1% | blocked |
| cloudflare-os | 0.435 | 54.5% | blocked |
| extractthinker | 0.472 | 55.7% | blocked |
| pi-desktop | 0.311 | 56.9% | blocked |
| smallstep-cli | 0.576 | 63.1% | blocked |

## Amended 60-outcome cohort

| Model system | Completion | Reliability-adjusted rubric | Complete-output rubric | Supported | Contradicted |
| --- | ---: | ---: | ---: | ---: | ---: |
| opencode-go/deepseek-v4-flash (host-opencode) | 73.3% | 1.301 ± 0.762 | 1.683 ± 0.493 | 37.3% | 3.8% |
| opencode-go/glm-5.3-flash (host-opencode) | 80.0% | 1.656 ± 0.805 | 2.004 ± 0.449 | 32.5% | 5.2% |
| opencode-go/qwen3.8-flash (host-opencode) | 66.7% | 1.568 ± 0.908 | 2.411 ± 0.425 | 40.9% | 4.9% |
| routellm/abacusai/Smaug-Flash (host-opencode) | 86.7% | 1.173 ± 0.618 | 1.308 ± 0.504 | 43.5% | 4.4% |

| Model system | Exact grounding | Wiki completeness | Repository coverage | Link integrity |
| --- | ---: | ---: | ---: | ---: |
| opencode-go/deepseek-v4-flash (host-opencode) | 86.7% | 77.3% | 57.2% | 75.1% |
| opencode-go/glm-5.3-flash (host-opencode) | 100.0% | 92.4% | 74.2% | 81.9% |
| opencode-go/qwen3.8-flash (host-opencode) | 80.0% | 71.0% | 61.5% | 73.8% |
| routellm/abacusai/Smaug-Flash (host-opencode) | 86.7% | 86.7% | 47.9% | 77.3% |

**Recommendation:** Withheld. Publication blockers: cloudflare-os: primary-judge linear-weighted Cohen's kappa is below 0.6; extractthinker: primary-judge linear-weighted Cohen's kappa is below 0.6; celld: primary-judge linear-weighted Cohen's kappa is below 0.6; pi-desktop: primary-judge linear-weighted Cohen's kappa is below 0.6.

| Subject | Weighted κ | Exact agreement | Status |
| --- | ---: | ---: | --- |
| celld | 0.388 | 52.8% | blocked |
| cloudflare-os | 0.458 | 53.2% | blocked |
| extractthinker | 0.490 | 59.3% | blocked |
| pi-desktop | 0.446 | 56.7% | blocked |
| smallstep-cli | 0.612 | 64.2% | pass |

## Interpretation

Reliability-adjusted rubric scores assign zero to failed trials, then average within each subject and macro-average subjects equally. Complete-output rubric and correctness rates describe only generated output; completion is reported separately. No table order is a ranking unless its cohort passes every publication gate. Exact evidence verifies cited bytes, while source-only probes test whether claims follow from those bytes.

The coding-specialization hypothesis cannot be accepted or rejected while either cohort is blocked; the amended values are descriptive system-level observations, not evidence of a provider-controlled model effect.
