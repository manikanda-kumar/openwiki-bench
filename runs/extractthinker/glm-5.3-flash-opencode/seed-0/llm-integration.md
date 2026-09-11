---
type: integration-layer
title: LLM Integration Layer
description: The LLM class — dual backends (litellm+instructor and pydantic-ai), router fallbacks, thinking-mode token budgets derived from page counts, dynamic JSON parsing, and the request parameters each knob controls.
tags: [llm, litellm, instructor, pydantic-ai, thinking-mode, structured-output]
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
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# LLM Integration Layer

`extract_thinker/llm.py` defines `LLM`, the single abstraction every component uses to talk to language models. Provider diversity comes from [LiteLLM](https://docs.litellm.ai): any LiteLLM model string (`gpt-4o`, `groq/llama-3.3-70b-versatile`, `ollama/phi3`, `gemini/...`) works wherever a model name is accepted.

## Backends

`LLMEngine` (in `extract_thinker/llm_engine.py`) defines two backends:

| Backend | Construction | Structured output |
|---|---|---|
| `DEFAULT` | `instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)` (`extract_thinker/llm.py:79-84`) | instructor validates responses into the `response_model` Pydantic class |
| `PYDANTIC_AI` | lazy `pydantic_ai.Agent` cast from the model name (`extract_thinker/llm.py:85-96`) | `agent.run(prompt, result_type=response_model or str)`; failures wrapped as `ValueError` (`extract_thinker/llm.py:189-201`) |

With `PYDANTIC_AI`, all message contents are joined into a single prompt string — multi-turn structure is lost. Routers are rejected on this backend (`extract_thinker/llm.py:121-125`), and batch processing refuses it (`extract_thinker/extractor.py:972-977`).

## Request paths

`request(messages, response_model)` (`extract_thinker/llm.py:183-236`):

1. If `is_dynamic` is off, the `response_model` is passed through to instructor and the validated instance is returned.
2. If `is_dynamic` is on, `request_model=None` is sent; instead the prompt gains a system message built by `build_dynamic_prompt(structure)` asking for reasoning inside `think` tags followed by JSON (`extract_thinker/llm.py:14-37`), and the raw `choices[0].message.content` is parsed by `extract_thinking_json` (`extract_thinker/utils.py:479-540`).
3. Routing: with a `Router` loaded, `_request_with_router` calls `router.completion(**params)`; otherwise `_request_direct` calls `self.client.chat.completions.create(**base_params)` with `max_retries=1` (`extract_thinker/llm.py:238-296`).

`raw_completion(messages)` returns `choices[0].message.content` without any response model, using the router when present and plain `litellm.completion` otherwise (`extract_thinker/llm.py:298-342`). `ConcatenationHandler` builds on this primitive for JSON continuation stitching.

## Thinking mode and token budgets

`set_thinking(True)` enables reasoning output and forces `temperature = 1` (`extract_thinker/llm.py:135-142`). The thinking parameter is only attached when `litellm.supports_reasoning(model)` reports support; otherwise a warning is printed and the request proceeds without it (`extract_thinker/llm.py:285-294`).

Budgets are derived from page counts pushed by `Extractor` (`set_page_count`, `extract_thinker/llm.py:155-181`):

- Each page is assumed to cost `DEFAULT_PAGE_TOKENS = 1500` tokens (text + image).
- Content tokens: `min(page_count * 1500, MAX_TOKEN_LIMIT = 120000)`.
- Thinking budget: `page_count * 1500 * DEFAULT_THINKING_RATIO (1/3)`, clamped to `[MIN_THINKING_BUDGET = 1200, MAX_THINKING_BUDGET = 64000]`.
- These become `thinking_token_limit` and `thinking_budget`, consumed at request time when `is_thinking` is on.

The final `max_completion_tokens` is `min(token_limit or thinking_token_limit, DEFAULT_MAX_COMPLETION_TOKENS = 8000)` — the 8000 default applies even in thinking mode unless a caller passes `token_limit` explicitly (`extract_thinker/llm.py:240-244`, `extract_thinker/llm.py:348-356`).

## Tunable parameters

| Knob | Default | Effect |
|---|---|---|
| `temperature` | `DEFAULT_TEMPERATURE = 0` (`extract_thinker/llm.py:41`) | Sent on every structured request |
| `TIMEOUT` | 3000 ms (`extract_thinker/llm.py:40`) | Per-request timeout; `set_timeout` overrides |
| `token_limit` | `None` | Hard cap on `max_completion_tokens`; overrides thinking-derived limits |
| `is_dynamic` | `False` | Switches from instructor validation to think-tag JSON parsing |
| `router` | `None` | LiteLLM fallback routing (DEFAULT backend only) |

`max_retries=1` is fixed on direct requests; there is no user-facing retry knob.

## Dynamic JSON parsing details

`extract_thinking_json` strips `think` tags, then tries JSON patterns in order of specificity — fenced ```json blocks, generic fenced blocks, then the most permissive bare-object regex — falling back to a whole-string `{...}` shape, removing `{content}` placeholders, and validating into the response model. Failures raise `ValueError` with the offending input excerpt (`extract_thinker/utils.py:479-540`).

## Model helpers

`extract_thinker/global_models.py` exposes convenience getters (`get_lite_model`, `get_big_model`, `get_gemini_flash_model`, `get_gpt_mini_model`, `get_gpt_o4_model`) currently returning Gemini 2.5 Flash Preview and GPT model strings; they are conveniences for tests/examples, not configuration (`extract_thinker/global_models.py:1-17`).

## Uncertainty

The repository does not document which provider credentials each model string requires beyond LiteLLM's own conventions (e.g. `OPENAI_API_KEY`, `GROQ_API_KEY` in CI); treat provider configuration as an environment concern owned by the host application.

## Related pages

- [Change Guide: Extending LLM Behavior](guides/extending-llm-behavior.md)
- [Extractor: Extraction and Classification Engine](extractor.md)
- [Completion Strategies](completion-strategies.md)
- [Architecture and Component Map](architecture.md)
