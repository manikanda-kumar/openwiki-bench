# Qwen Smallstep continuation — deterministic report

Subject: `smallstep-cli` at `f7b2bd24a4a9519b13c91dc37dae49d36b77068d`  
System: `massed-local/Qwen/Qwen3.8-27B-FP8` + OpenCode 1.18.25 + OpenWiki 0.4.3

## Outcome

The resumed logical run completed all 13 planned pages and `openwiki_finish` returned `complete`.
The continuation is **not** a successful first attempt: the immutable seed-0 attempt timed out at
16:44:27Z after 10,802 seconds, with 11/13 pages and six context-overflow error records. The forked
session `ses_f5f2ed215ffetz1Xce1wmpA45d` ran from 16:47:37Z to 17:03:26Z and exited 0.

| Metric | Original timed-out attempt | Completed continuation output |
| --- | ---: | ---: |
| Outcome | died | complete after resume |
| Planned pages complete | 11/13 (84.62%) | 13/13 (100%) |
| Claims | 295 | 343 |
| Evidence spans | 532 | 599 |
| Resolvable / in-range / exact evidence | 100% / 100% / 100% | 100% / 100% / 100% |
| Markdown pages | 12 | 21 |
| Markdown lines | 1,376 | 2,009 |
| Internal links resolved | 13/14 (92.86%) | 33/33 (100%) |
| Repository coverage units | 11/17 (64.71%) | 16/17 (94.12%) |
| Seed paths covered | 62/70 (88.57%) | 65/70 (92.86%) |
| Redundancy | 0.0308 | 0.0337 |

The score was produced by the repository's pinned-SHA deterministic scorer. All 599 cited evidence
spans resolve to the pinned checkout, are in range, and reproduce their recorded hashes. Exact
evidence establishes byte identity, not whether a claim follows from the cited bytes; that is
reported separately in `SEMANTIC-REPORT.md`.

## Provenance and limits

- `input-provenance.json` records source hashes, session IDs, timestamps, and the original death.
- `wiki-sha256s.txt` hashes all 35 captured wiki and claim files.
- `deterministic-scores.json` is isolated from the official historical score and cohort files.
- This is one resumed seed-0 trial, not a new independent trial. It must not replace the original
  reliability failure, count as another seed, enter historical cohorts silently, or support a model
  ranking by itself.
