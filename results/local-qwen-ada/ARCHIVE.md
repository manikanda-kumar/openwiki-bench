# Local Qwen experiment archive

All five session exports were parsed and verified nonempty before GPU termination. Paths below are relative to the repository root. Each completed run retains its output, events, telemetry and manifest; interrupted outcomes remain explicitly separate.

| Trial | Session messages | Artifacts |
| --- | ---: | --- |
| Smallstep original timeout | 247 | runs/smallstep-cli/qwen3.8-27b-fp8-ada-opencode/seed-0/ |
| Smallstep successful continuation | 272 (fork history included) | results/local-qwen-ada/continuation-1/ |
| Files-to-prompt baseline | 21 | runs/files-to-prompt/qwen3.8-27b-fp8-ada-opencode/seed-0/ |
| Files-to-prompt n-gram, user cancelled | 55 | results/local-qwen-ada/files-to-prompt-ngram/ (session and partial wiki); runs/files-to-prompt/qwen3.8-27b-fp8-ada-ngram-opencode/seed-0/ (events and plan) |
| Files-to-prompt MTP | 20 | runs/files-to-prompt/qwen3.8-27b-fp8-ada-mtp-opencode/seed-0/ |

Every session export is named opencode-session.json. N-gram has no normal final run.json because the user cancelled the entire managed service; OUTCOME.md records this explicitly.

- Smallstep judge reports, judgments, tasks, probes and provenance: results/local-qwen-ada/continuation-evaluation/.
- Baseline/MTP measurements and comparison: results/local-qwen-ada/files-to-prompt-{baseline,mtp}/.
- GPU server logs for all three configurations, final metrics, configuration and sanitized termination receipt: results/local-qwen-ada/gpu-final/.
- Exact model and runtime configs: systems/qwen3.8-27b-fp8-ada*. Subject/brief: subjects/files-to-prompt.json and prompts/files-to-prompt-pilot.md.

Massed Compute accepted termination at2026-09-14T18:17:38Z, returned status terminated with no failed instances, and subsequent MCP instances_list returned no running instances. GPU uptime from13:30:50Z was approximately4h46m48s. At$0.79/hour, five whole hours would be$3.95 if rounded upward; invoice rounding remains unverified. All benchmark services and the SSH tunnel are stopped; monitoring was cleared.

These files are retained for publication in the repository. Model weight caches were not archived; the immutable checkpoint revision and serving image digest allow downloading them again. No credentials or private SSH key are intentionally included.

Before publication, the existing repository sanitizer redacted Google OAuth client IDs and a client secret copied from Smallstep source into continuation-1/opencode-session.json. The historical judge input hash describes the pre-redaction session, not this sanitized export. Wiki pages, claims, judgments and their checksums are unchanged.
