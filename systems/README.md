# Official systems

The original official 45-run matrix holds the agent runtime constant and varies only the OpenCode Go model:

| System ID | Model | Runtime |
| --- | --- | --- |
| `deepseek-v4-flash-opencode` | `opencode-go/deepseek-v4-flash` | OpenCode + OpenWiki MCP |
| `glm-5.3-flash-opencode` | `opencode-go/glm-5.3-flash` | OpenCode + OpenWiki MCP |
| `qwen3.8-flash-opencode` | `opencode-go/qwen3.8-flash` | OpenCode + OpenWiki MCP |

A protocol amendment adds 15 RouteLLM-hosted Smaug-Flash outcomes (three trials on each subject),
expanding the matrix to 60 without changing or retroactively reclassifying the original 45:

| System ID | Model | Runtime |
| --- | --- | --- |
| `smaug-flash-opencode` | `routellm/abacusai/Smaug-Flash` | OpenCode + OpenWiki MCP |

The model ID, 1,000,000-token context limit, 384,000-token output limit, and per-million-token
prices ($0.10 input, $0.40 output, $0.005 cached input) come from RouteLLM's authenticated
`/v1/models` catalog. The config embeds OpenCode's deterministic
`@ai-sdk/openai-compatible` provider definition while reading only `ROUTELLM_API_KEY` from the
environment; no credential is stored in the repository.

The four JSON files freeze the executable contract: OpenCode 1.18.25, the `build` agent,
OpenWiki 0.4.3 over MCP, `opencode run --format json --auto`, a three-hour external timeout,
and one model for the entire session. The runner exports the completed OpenCode session, rejects
provider/model substitution, preserves raw JSON events, and writes normalized model/tool/page
telemetry. Prompt, ignore, and system-config hashes are recorded in every run manifest.

Each trial is one OpenCode session with no automatic retry or resume. A timeout, process death,
source-file edit, incomplete OpenWiki lifecycle, or model substitution is retained as that trial's
failure rather than silently repaired. Forbidden subagent delegation fails fast when its tool event
appears. This keeps loop reliability attributable to the contestant.

Amp orb setup pins OpenCode 1.18.25 and OpenWiki 0.4.3, installs the OpenWiki integration at user
scope, and provides `npm run preflight:opencode`. The preflight validates setup and model
availability without consuming inference.

Run one trial with:

```bash
npm run bench -- run \
  --subject smallstep-cli \
  --system systems/qwen3.8-flash-opencode.json \
  --seed 0 \
  --prompt prompts/code-wiki.md \
  --ignore prompts/official.openwikiignore
```
