---
type: change-guide
title: Change Guide — Extending LLM Behavior
description: How to safely change LLM behavior in ExtractThinker — backends, router fallbacks, thinking mode budgets, dynamic JSON parsing, temperature, timeout, and token limits — with the exact parameters each knob controls.
tags: [change-guide, llm, litellm, thinking-mode, configuration]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-d14c100cb1c28d349fc7a183
    resource: repo://extract_thinker/global_models.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-aa326a6e338619f95df6a4ce
    resource: repo://tests/test_llm_backends.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Change Guide: Extending LLM Behavior

All model traffic flows through the `LLM` class (`extract_thinker/llm.py:39+`). This guide maps each behavioral knob to its code location and the exact request parameters it affects.

## Choosing a backend

`LLM(model, token_limit=None, backend=LLMEngine.DEFAULT)` (`extract_thinker/llm.py:55-96`):

- `LLMEngine.DEFAULT` — wraps `litellm.completion` with `instructor.from_litellm(..., mode=instructor.Mode.MD_JSON)`. Structured output is enforced by instructor; `self.agent` stays `None`.
- `LLMEngine.PYDANTIC_AI` — creates a `pydantic_ai.Agent` (import checked lazily; a missing package raises `ImportError` with install instructions). Requests combine all message contents into one prompt string and run through `agent.run(..., result_type=response_model or str)`; failures become `ValueError` (`extract_thinker/llm.py:189-201`).

Consequences to know before switching backends:

- **Routers are DEFAULT-only**: `load_router` raises `ValueError("Router is only supported with LITELLM backend")` (`extract_thinker/llm.py:121-125`).
- **Batch is DEFAULT-only**: `Extractor.extract_batch` rejects the PYDANTIC_AI backend outright (`extract_thinker/extractor.py:972-977`).
- `tests/test_llm_backends.py` pins these behaviors — backend selection, router rejection, and invalid-backend handling (`tests/test_llm_backends.py:5-33`).

## Wiring a router for fallbacks

`llm.load_router(litellm.Router(model_list=[...]))` routes every structured completion through `router.completion(**params)` instead of the direct client. The params passed are `model`, `messages`, `response_model`, `temperature`, `timeout` (default 3000 ms), `max_completion_tokens`, and — when thinking is enabled and `litellm.supports_reasoning(model)` — a `thinking` parameter of the form `{"type": "enabled", "budget_tokens": self.thinking_budget}`; unsupported models print a warning and proceed without it (`extract_thinker/llm.py:238-265`).

## Enabling thinking mode

`llm.set_thinking(True)` sets `is_thinking` and forces `temperature = 1` (`extract_thinker/llm.py:135-142`). Budgets come from page accounting:

- `Extractor.extract` / `extract_batch` call `llm.set_page_count(n)` with the loaded page count (`extract_thinker/extractor.py:303-314`, `extract_thinker/extractor.py:1014-1022`).
- `set_page_count` computes `content_tokens = min(page_count * 1500, 120000)` and `thinking_tokens = page_count * 1500 / 3`, clamped to the range 1200–64000, storing them in `thinking_token_limit` / `thinking_budget` (`extract_thinker/llm.py:42-48`, `extract_thinker/llm.py:155-181`).
- At request time, `max_completion_tokens` is the minimum of `token_limit` (or the thinking-derived limit) and `DEFAULT_MAX_COMPLETION_TOKENS = 8000`; note the hard 8000 default caps even thinking requests unless you pass `token_limit=` explicitly (`extract_thinker/llm.py:267-296`, `extract_thinker/llm.py:348-356`).

If you change these constants, update derived-budget expectations accordingly; `set_page_count` rejects non-positive page counts with `ValueError`.

## Dynamic JSON parsing

`llm.set_dynamic(True)` bypasses instructor: `request_model` is sent as `None`, the prompt instead embeds the contract structure via `build_dynamic_prompt` (asking for reasoning inside `think` tags followed by JSON), and the raw response content is parsed by `extract_thinking_json(content, response_model)` (`extract_thinker/llm.py:144-153`, `extract_thinker/llm.py:208-236`, `extract_thinker/utils.py:479+`). Use this for models that behave better with explicit think-tags than with instructor's MD_JSON extraction. When `is_dynamic` is False, the instructor-validated model instance is returned directly.

## Temperature, timeout, and token limits

- `set_temperature(t)` sets the `temperature` param (default 0) (`extract_thinker/llm.py:127-133`).
- `set_timeout(ms)` overrides the class-level `TIMEOUT = 3000` used in both router and direct paths (`extract_thinker/llm.py:40`, `extract_thinker/llm.py:344-346`).
- `token_limit` (constructor arg) clamps `max_completion_tokens` from above and takes precedence over thinking-derived limits (`extract_thinker/llm.py:241-244`, `extract_thinker/llm.py:270-273`).
- Direct (non-router) requests also pass `max_retries=1` to instructor (`extract_thinker/llm.py:275-296`).

## Raw completions

`llm.raw_completion(messages)` skips the response model entirely, returning `choices[0].message.content`; it respects the same token/thinking params and uses the router when present, else plain `litellm.completion` (`extract_thinker/llm.py:298-342`). `ConcatenationHandler` depends on this for JSON continuation stitching (`extract_thinker/concatenation_handler.py:34-35`).

## Safe-change checklist

1. Decide the backend first — it gates routers and batch support.
2. If enabling thinking, ensure page counts are actually set (they are only pushed by `extract`/`extract_batch`), or budgets fall back to defaults.
3. Remember `DEFAULT_MAX_COMPLETION_TOKENS = 8000` caps output unless `token_limit` is raised.
4. Keep `tests/test_llm_backends.py` green; it asserts the backend invariants above.
5. For new providers, rely on LiteLLM's model-string routing rather than adding provider-specific code paths — the codebase contains no provider branches outside the `litellm.supports_reasoning` checks.

## Related pages

- [LLM Integration Layer](../llm-integration.md)
- [Extractor: Extraction and Classification Engine](../extractor.md)
- [Completion Strategies](../completion-strategies.md)
