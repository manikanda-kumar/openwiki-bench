# Qwen Smallstep continuation — blind semantic report

The current official panel judged the completed continuation in fresh repository-less Amp tasks:
GPT-5.5 `deep-classic` scored all eight sampled pages, Grok 4.6 scored the same pages, and GPT-6
Astra Medium scored the seven disagreement pages plus all 16 source-only correctness probes. Every
task resolved to its required model and every recorded prompt hash was independently reproduced.

## Rubric result

| Metric | Result |
| --- | ---: |
| Sampled pages | 8 |
| Median-panel page mean | 2.396 / 4 |
| Completeness × coverage adjusted score | 2.255 / 4 |
| Primary/secondary linear-weighted Cohen's κ | 0.557 |
| Exact agreement | 54.17% |
| Unweighted Cohen's κ | 0.362 |
| Unresolved tasks | 0 |
| Publication gate | **failed** (weighted κ < 0.6) |

| Axis | Final mean / 4 | Weighted κ | Exact agreement |
| --- | ---: | ---: | ---: |
| Taxonomy fit | 2.875 | 0.586 | 75.0% |
| Code grounding | 1.250 | 0.545 | 50.0% |
| Reasoning depth | 1.875 | 0.000 | 37.5% |
| Change usefulness | 2.125 | 0.556 | 62.5% |
| Style | 3.125 | 0.091 | 37.5% |
| Correctness | 3.125 | 0.250 | 62.5% |

## Source-only correctness probes

| Label | Count | Rate |
| --- | ---: | ---: |
| Supported | 7 | 43.75% |
| Unsupported | 8 | 50.00% |
| Contradicted | 1 | 6.25% |

The contradiction-rate 95% Wilson interval is 1.11%–28.33%. The contradicted sampled statement
said the Let's Encrypt branch always adds the subject CN as a DNS identifier; the cited source only
adds it when no existing identifier has the same value. “Unsupported” means the sampled excerpts
did not establish the full statement, not necessarily that the statement is false.

## Interpretation limits

This evaluation describes the completed output conditional on a manual continuation. It does not
erase the original timeout, establish first-attempt reliability, create an independent trial, or
authorize ranking this system against models with three trials across all five subjects. The judge
agreement gate also failed. Historical cohort artifacts remain untouched and this result is not
included in them.

Machine-readable details are in `judged-scores.json`, `probe-scores.json`, the judgment/label files,
and their per-task Amp provenance files.
