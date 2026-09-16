# Files-to-prompt baseline

- Run: `runs/files-to-prompt/qwen3.8-27b-fp8-ada-opencode/seed-0`.
- Finished successfully at 2026-09-14T17:17:57.467Z; wall time 642 seconds.
- Exactly two planned content pages complete. 23 claims, 55/55 evidence references resolvable, in range and hash-exact; 2/2 internal links resolve. These checks do not establish semantic correctness.
- One recovered tool argument error: submit_plan received a string instead of an array.
- OpenCode reports 7,780 output tokens. vLLM generation counter increased by 16,513 tokens, including reasoning. Do not conflate the two counters.
- vLLM completed requests increased by 20; summed decode time increased by 594.8167 seconds. Approximate decode rate: (16,513 − 20 first tokens) / 594.8167 = 27.73 tokens/sec. Overall generated tokens / wall time = 25.72 tokens/sec, not pure decode throughput.
- Metrics snapshots and original server arguments are retained alongside this file. Original server already had prefix caching and CUDA graphs; baseline means no additional/speculative optimization, not disabling existing engine defaults.
- GPU uptime at finish: 3h47m07s since 13:30:50Z. Rental remains active at $0.79/hour; API token cost zero is not rental cost. Invoice rounding unverified.
- Model, runtime and session provenance retained in run.json and opencode-session.json. Separate pilot; historical benchmark cohorts untouched.
