#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
if [[ -z "${OPENCODE_API_KEY:-}" && -n "${OPENCODE_GO_API_KEY:-}" ]]; then
  export OPENCODE_API_KEY="$OPENCODE_GO_API_KEY"
fi

expected_opencode="1.18.25"
expected_openwiki="0.4.3"
actual_opencode="$(opencode --version)"
actual_openwiki="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$HOME/.local/lib/node_modules/openwiki/package.json")"

[[ "$actual_opencode" == "$expected_opencode" ]] || {
  echo "Expected OpenCode $expected_opencode, found $actual_opencode" >&2
  exit 1
}
[[ "$actual_openwiki" == "$expected_openwiki" ]] || {
  echo "Expected OpenWiki $expected_openwiki, found $actual_openwiki" >&2
  exit 1
}
[[ -n "${OPENCODE_API_KEY:-}" ]] || {
  echo "Missing OPENCODE_GO_API_KEY/OPENCODE_API_KEY" >&2
  exit 1
}
[[ -n "${ROUTELLM_API_KEY:-}" ]] || {
  echo "Missing ROUTELLM_API_KEY" >&2
  exit 1
}

models="$(opencode models opencode-go --refresh)"
for model in deepseek-v4-flash glm-5.3-flash qwen3.8-flash; do
  grep -Fq "opencode-go/$model" <<<"$models" || {
    echo "OpenCode Go model is unavailable: $model" >&2
    exit 1
  }
done

node --input-type=module -e '
  const response = await fetch("https://routellm.abacus.ai/v1/models", {
    headers: { Authorization: `Bearer ${process.env.ROUTELLM_API_KEY}` },
  });
  if (!response.ok) throw new Error(`RouteLLM model catalog returned HTTP ${response.status}`);
  const body = await response.json();
  const model = body.data?.find((entry) => entry.id === "abacusai/Smaug-Flash");
  if (model === undefined) throw new Error("RouteLLM model is unavailable: abacusai/Smaug-Flash");
  if (model.context_length !== 1000000 || model.max_completion_tokens !== 384000 ||
      model.input_token_rate !== "0.0000001" || model.output_token_rate !== "0.0000004" ||
      model.cached_input_token_rate !== "0.000000005" || model.tools !== true) {
    throw new Error("RouteLLM Smaug-Flash catalog contract changed");
  }
'

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
smaug_config="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).env.OPENCODE_CONFIG_CONTENT)' "$project_root/systems/smaug-flash-opencode.json")"
smaug_models="$(OPENCODE_CONFIG_CONTENT="$smaug_config" opencode models routellm --refresh)"
grep -Fqx "routellm/abacusai/Smaug-Flash" <<<"$smaug_models" || {
  echo "RouteLLM Smaug-Flash is unavailable in OpenCode" >&2
  exit 1
}

mcp_status="$(opencode mcp list)"
grep -Fq "openwiki" <<<"$mcp_status" || {
  echo "OpenWiki MCP integration is unavailable" >&2
  exit 1
}
grep -Fq "connected" <<<"$mcp_status" || {
  echo "OpenWiki MCP integration is not connected" >&2
  exit 1
}

echo "OpenCode/OpenWiki preflight passed for all four contestants (no model requests sent)"
