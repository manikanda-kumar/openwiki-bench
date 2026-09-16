# Command Code hosted Qwen 3.8 27B verification

## Identity and frozen runtime

- Command Code's live authenticated `/provider/v1/models` catalog returned exact model ID
  `Qwen/Qwen3.8-27B`, name `Qwen 3.8 27B`, and context length 262,144. Separate live entries
  existed for Qwen 3.8 Flash, Max, and Max 0902; none was substituted.
- The public model page listed $0.40/M input, $3.00/M output, and $0.04/M cache-read pricing.
  Open-source requests may vary slightly by selected upstream, according to Command Code.
- The provider does not publish a maximum completion length in its catalog or model page. The
  benchmark therefore retained the local harness's 32,768-token per-turn output cap; a live request
  with `max_tokens: 32768` succeeded. This is a tested benchmark cap, not a provider-maximum claim.
- No temperature, top-p, seed, or thinking control was set. Direct API responses exposed reasoning
  by default and labelled reasoning-token counts as estimated. The hosted checkpoint and precision
  are not established, so these runs are not claimed to use the local FP8 checkpoint.
- OpenCode resolved only `commandcode/Qwen/Qwen3.8-27B` from the custom provider config. The
  retained build-agent smoke used bash and completed a two-turn tool round trip; both assistant
  turns resolved to the exact model. Runtime remained OpenCode 1.18.25 + OpenWiki 0.4.3.

## Results

| Subject | Outcome | Wall | Pages | Exact evidence | Links | OpenCode output + reasoning | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| files-to-prompt compact2page | complete | 162s | 2/2 | 68/68 | 2/2 | 10,290 + 9,588 | $0.1122284 |
| Smallstep CLI full | complete | 2,700s | 15/15 | 321/321 | 23/25 | 105,508 + 62,180 | $2.69256464 |

Each run used one OpenCode session, had no death or resume, reached OpenWiki `status: complete`,
ended with a normal model stop, used the exact configured model on every assistant turn, and used
no subagent task tool. The pilot recovered one malformed `submit_plan` call. Smallstep recovered six
`submit_page` errors while finishing all pages. The two unresolved Smallstep links are incorrect
relative links from `flows/bootstrap-and-contexts.md` to root-level configuration and architecture
pages; contestant output is retained unchanged.

OpenCode's category counters independently reproduce each recorded cost when reasoning is billed at
the output rate:

- Pilot: 54,846 fresh input, 766,400 cache reads, 10,290 output, 9,588 reasoning.
- Smallstep: 2,869,310 fresh input, 26,044,416 cache reads, 105,508 output, 62,180 reasoning.

The combined recorded provider cost is **$2.80479304**. The normalized telemetry, raw event stream,
full exported session, generated pages, claims, plan snapshot, lifecycle marker, and run manifest are
retained in each run directory.

## Deterministic comparison

- Pilot wall time was 162s versus 642s local baseline and 553s local one-token MTP. That is a 74.8%
  and 70.7% wall-time reduction respectively, but it is a hosted-system comparison—not evidence
  that Command Code's serving has equivalent precision/checkpoint or a comparable vLLM decode rate.
  The hosted trajectory also used 25 turns and generated more output/reasoning tokens.
- Hosted Smallstep finished 15/15 pages in 2,700s. The untouched local first attempt timed out after
  10,802s at 11/13 pages. Its separate continuation eventually reached 13/13, 599/599 exact evidence,
  and 33/33 links, but its blind judge publication gate failed (weighted κ 0.557). The hosted output
  has not been semantically judged, so deterministic completion and grounding do not establish
  superior correctness or writing quality.
- Hosted Smallstep scored 190 claims, 321/321 exact evidence, 88.2% top-level coverage, 82.4%
  seed-path coverage, and 92.0% link integrity. The hosted and local plans differ in page count and
  content, so raw claim totals are not quality rankings.

The generated-token/wall diagnostics in `SUMMARY.json` are explicitly not decode throughput: they
include provider routing, network, input processing, tool execution, and the entire agent loop.

## Checks

- Isolated deterministic scoring checked both exact pinned SHAs and produced
  `files-to-prompt-scores.json` and `smallstep-scores.json`.
- `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npm run verify`
  passed typecheck and all 23 tests. The process-only override avoids this orb's unavailable signing
  key in test-created repositories; repository Git configuration was not changed.
- Exact-value credential scans found no Command Code API key in configs, smoke artifacts, results,
  or run artifacts. Only `COMMAND_CODE_API_KEY` was passed through to the custom provider process.
- Historical local runs, continuation results, and official cohorts were not overwritten or edited.

Provider catalog, model/sampling/limit provenance, direct API smoke requests/responses, OpenCode
tool smoke, machine summaries, deterministic comparisons, and checksums are under this directory.
