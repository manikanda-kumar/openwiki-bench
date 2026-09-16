# Verification

- Input archive SHA-256: `f6e5d4a27bc230e45fea5da046090736e41ac94a6c3953e18786c3a779227985`.
- Extracted continuation session, finish timestamp, original run manifest, and system config match
  their archive members byte-for-byte.
- Subject checkout was pinned to `f7b2bd24a4a9519b13c91dc37dae49d36b77068d` by the scorer.
- Deterministic scoring found 599/599 resolvable, in-range, exact evidence spans.
- Judge task coverage: GPT-5.5 8/8, Grok 4.6 8/8, Astra tiebreaks 7/7, Astra probes 16/16.
- Judge provenance: 39 tasks, 39 unique Amp threads, required modes/models only, no duplicate task
  IDs per role, valid timestamp ordering, and 39/39 independently reproduced prompt hashes.
- Aggregation found no unresolved rubric tasks or missing/duplicate probe labels.
- `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npm run verify`:
  typecheck passed; 23/23 tests passed. The process-only Git override is needed because this orb's
  global config requests signing but has no signing key; repository configuration was not changed.
- `git diff` showed no modifications to tracked historical scores, evaluation files, cohorts, or
  reports.
