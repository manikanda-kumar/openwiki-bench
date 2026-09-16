# Files-to-prompt: baseline vs one-token MTP

| Metric | Baseline | MTP |
| --- | ---: | ---: |
| Wall seconds (excludes server startup) | 642 | 553 |
| Approximate decode tokens/sec, including reasoning | 27.73 | 32.40 |
| Server generated tokens | 16,513 | 16,383 |
| Completed requests | 20 | 19 |
| Summed request decode seconds | 594.8167 | 505.0437 |
| Tool errors | 1 recovered | 0 |
| Completed content pages | 2/2 | 2/2 |
| Claims | 23 | 29 |
| Evidence resolvable/in-range/hash-exact | 55/55 | 71/71 |
| Internal links resolved | 2/2 | 2/2 |

MTP accepted 7,620 of 8,754 draft tokens (87.05%). Decode rate uses (generated tokens − completed requests) / summed decode seconds, matching the baseline calculation. MTP improved this rate by16.85%, and reduced observed task wall time by13.86% (89seconds). OpenCode output counters exclude some tokens counted by the server; use the server metrics for this comparison.

MTP completed2026-09-14T17:57:07.333Z with openwiki_finish=complete. Full session and provenance are retained in runs/files-to-prompt/qwen3.8-27b-fp8-ada-mtp-opencode/seed-0. Same subject pin, prompt hash, ignore hash, model and runtime; one MTP draft token is the serving change. N-gram was cancelled by the user and is not a successful comparison sample.

This is one trajectory per completed variant, not a controlled replay or statistically robust speedup. Text, reasoning, tool calls and sampling differ. Evidence integrity is not semantic correctness. MTP startup/compilation took roughly four minutes and is excluded from the run time; this one task's89second saving does not pay back that cold startup. No200TPS claim is supported.

The broad scorer initially failed because the cancelled n-gram directory has no run.json. MTP was then scored through unchanged scoreAll against an isolated temporary project containing only its completed run; no fake n-gram manifest or historical-score modification was made.

GPU rental remained active after capture. At MTP completion uptime was4h26m17s since13:30:50Z; billed rounding remains unverified. API token cost zero is not GPU rental cost.
