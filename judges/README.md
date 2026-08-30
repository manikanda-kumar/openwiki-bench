# Judge protocol

The JSON configs in this directory document the OpenRouter transport used for the historical
pilot evaluation. They are provenance, not the transport for the official matrix.

Official judging uses Amp-managed model access:

| Role | Required model |
| --- | --- |
| Primary rubric judge | Fable 5 |
| Secondary rubric judge | Opus 4.8 |
| Disagreement tiebreaker | GPT-5.5 |
| Correctness probe judge | GPT-5.5 |

Run each opaque page or probe task in a fresh Amp thread with no contestant repository or project
attached. Supply only the frozen rubric and blind task payload. Import the final JSON into the
existing `PageJudgment` or `ImportedProbeLabel` format.

The private manifest must record the thread ID, requested Amp mode, resolved model/version, start
and finish times, and task ID. Preflight all three exact models before trial 0. If Amp routes a
request to a different model, reject and rerun that task after the route is corrected; never mix
replacement-model judgments into the official leaderboard.
