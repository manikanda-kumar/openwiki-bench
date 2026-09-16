# N-gram pilot: stopped by user

User explicitly requested stopping n-gram and switching to MTP. This is a cancelled partial trial, not a completed run or a timeout.

The managed service was stopped; partial wiki/lifecycle state, full OpenCode session export, stop timestamp, and server metrics were preserved in this directory. Original events and captured plan remain in runs/files-to-prompt/qwen3.8-27b-fp8-ada-ngram-opencode/seed-0. Stopping the entire service bypassed normal runner finalization; do not interpret the absent run.json as success or fabricate normal finalization.

At the last scheduled check, no content pages were written or submitted, one page was pending despite a two-page brief, and five tool errors had occurred. Late generation windows were approximately18–21TPS with low n-gram acceptance, versus baseline27.73TPS. This single cancelled trajectory is not sufficient to attribute tool errors to speculative decoding.
