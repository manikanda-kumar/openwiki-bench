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

models="$(opencode models opencode-go --refresh)"
for model in deepseek-v4-flash glm-5.3-flash qwen3.8-flash; do
  grep -Fq "opencode-go/$model" <<<"$models" || {
    echo "OpenCode Go model is unavailable: $model" >&2
    exit 1
  }
done

mcp_status="$(opencode mcp list)"
grep -Fq "openwiki" <<<"$mcp_status" || {
  echo "OpenWiki MCP integration is unavailable" >&2
  exit 1
}
grep -Fq "connected" <<<"$mcp_status" || {
  echo "OpenWiki MCP integration is not connected" >&2
  exit 1
}

echo "OpenCode/OpenWiki preflight passed (no model requests sent)"
