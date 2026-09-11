# Judge protocol

The JSON configs in this directory document the OpenRouter transport used for the historical
pilot evaluation. They are provenance, not the transport for the official matrix.

Official judging uses Amp-managed model access:

| Role | Required model |
| --- | --- |
| Primary rubric judge | GPT-5.5 through Amp `deep-classic` |
| Secondary rubric judge | Grok 4.6 through Amp `grok46` |
| Disagreement tiebreaker | GPT-6 Astra Medium |
| Correctness probe judge | GPT-6 Astra Medium |

Run each opaque page or probe task in a fresh Amp thread with no contestant repository or project
attached. Supply only the frozen rubric and blind task payload. Import the final JSON into the
existing `PageJudgment` or `ImportedProbeLabel` format.

The frozen Amp mode keys are `deep-classic`, `grok46`, and `gpt-6-astra-medium`. Run official tasks with
`bench judge run-amp` or `bench probe run-amp`; each invocation executes from a fresh temporary
directory, verifies the exported model, and checkpoints judgments plus provenance. The local
`deep-classic` plugin pins `openai/gpt-5.5` with medium reasoning. The private manifest must record
the thread ID, requested Amp mode, resolved model/version, prompt hash, start and finish times, and
task ID. Preflight all three exact models before trial 0. If Amp routes a
request to a different model, reject and rerun that task after the route is corrected; never mix
replacement-model judgments into the official leaderboard.

The earlier `smallstep-cli` and `cloudflare-os` Claude-panel artifacts remain immutable historical
provenance. They must be rejudged with this panel before a cross-repository ranking is published.
