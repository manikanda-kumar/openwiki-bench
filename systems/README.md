# Planned official systems

The official 45-run matrix holds the agent runtime constant and varies only the OpenCode Go model:

| System ID | Model | Runtime |
| --- | --- | --- |
| `deepseek-v4-flash-opencode` | `opencode-go/deepseek-v4-flash` | OpenCode + OpenWiki MCP |
| `glm-5.3-flash-opencode` | `opencode-go/glm-5.3-flash` | OpenCode + OpenWiki MCP |
| `qwen3.8-flash-opencode` | `opencode-go/qwen3.8-flash` | OpenCode + OpenWiki MCP |

Executable JSON configs are intentionally deferred until the non-interactive OpenCode command,
OpenCode/OpenWiki versions, permissions, max-turn policy, resume behavior, and telemetry capture
have been smoke-tested and frozen. Committing guessed commands would make the benchmark look
reproducible when it is not.

Amp orb setup pins OpenCode 1.18.25 and OpenWiki 0.4.3, installs the OpenWiki integration at user
scope, and provides `npm run preflight:opencode`. The preflight validates setup and model
availability without consuming inference.
