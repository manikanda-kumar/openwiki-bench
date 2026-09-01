# Official systems

The official 45-run matrix holds the agent runtime constant and varies only the OpenCode Go model:

| System ID | Model | Runtime |
| --- | --- | --- |
| `deepseek-v4-flash-opencode` | `opencode-go/deepseek-v4-flash` | OpenCode + OpenWiki MCP |
| `glm-5.3-flash-opencode` | `opencode-go/glm-5.3-flash` | OpenCode + OpenWiki MCP |
| `qwen3.8-flash-opencode` | `opencode-go/qwen3.8-flash` | OpenCode + OpenWiki MCP |

The three JSON files freeze the executable contract: OpenCode 1.18.25, the `build` agent,
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
