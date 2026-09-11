---
type: mechanism
title: LLM Layer
description: The LLM class wraps litellm+instructor or pydantic-ai behind one interface, with router fallbacks, thinking budgets sized by page count, dynamic JSON parsing, and token/temperature/timeout knobs.
tags: [llm, litellm, instructor, pydantic-ai, thinking, routing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
sources:
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-aa326a6e338619f95df6a4ce
    resource: repo://tests/test_llm_backends.py
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# LLM Layer

`extract_thinker/llm.py` defines `LLM`, the single choke point for all model calls. It never talks to a provider directly — it delegates to `litellm` (+ `instructor` for structured outputs) by default, or `pydantic-ai` on the alternate backend.

## Backends

`LLMEngine` (`extract_thinker/llm_engine.py`) has two members:

- `DEFAULT` — litellm + instructor. `LLM.__init__` wraps `litellm.completion` with `instructor.from_litellm(..., mode=MD_JSON)`; compiled agent unused (`extract_thinker/llm.py#L66-L70`).
- `PYDANTIC_AI` — lazily imports `pydantic_ai` (raising a clear ImportError if missing) and builds a `pydantic_ai.Agent` instead (`#L79-L97`). In this mode `request()` flattens all messages into a single prompt string and returns `result.data`; `raw_completion` does the same with `result_type=str` (`#L198-L209`, `#L298-L312`). Any failure becomes `ValueError("Failed to extract from source: ...")`.

Discrepancy worth noting: `tests/test_llm_backends.py` references `llm_engine.LITELLM`, which does not exist in the current enum (`DEFAULT`/`PYDANTIC_AI` only) — that test file appears stale relative to `llm.py`.

## Request dispatch

`LLM.request(messages, response_model)` (`extract_thinker/llm.py#L183-L236`):

1. PYDANTIC_AI path: flatten and run agent (`#L190-L202`).
2. **Dynamic parsing**: if `is_dynamic` is set, `request_model` stays `None` (skip instructor parsing) and a `build_dynamic_prompt(structure)` system message is appended (`#L210-L218`, helper at `#L15-L36` describing `<think>` tags and the JSON structure). The raw response content is then routed through `extract_thinking_json(content, response_model)` (`extract_thinker/utils.py#L479`), which extracts `<think>` reasoning and parses the JSON into the model. Used for thinking models where native structured output is unavailable.
3. Otherwise: `_request_with_router` when a litellm Router was loaded by `load_router` (restricted to DEFAULT backend, `#L121-L125`), else `_request_direct` (`#L238-L296`).

Both call paths compute `max_completion_tokens` as `DEFAULT_MAX_COMPLETION_TOKENS` (8000) clamped by an explicit `token_limit` or, when thinking is enabled, by `thinking_token_limit`; then pass `temperature`, `timeout` (`TIMEOUT`, default 3000 ms), and `response_model` for instructor parsing. `_request_direct` also sets `max_retries: 1`.

## Thinking budgets

`set_thinking(True)` forces temperature to 1. `set_page_count(n)` (called by building Extractors) estimates content tokens at `DEFAULT_PAGE_TOKENS` (1500) per page capped at `MAX_TOKEN_LIMIT` (120000), and sets the thinking budget to 1/3 of the content estimate, clamped between `MIN_THINKING_BUDGET` (1200) and `MAX_THINKING_BUDGET` (64000) (`extract_thinker/llm.py#L42-L53, 135-141, 155-181`).

When thinking is enabled but the model lacks reasoning support (`litellm.supports_reasoning`), the layer prints a warning and proceeds without the parameter rather than failing (`#L269-L275`).

## Raw completions

`raw_completion(messages)` bypasses instructor and returns the first choice's text — used by `ConcatenationHandler` for incremental JSON construction (`extract_thinker/llm.py#L298-L341`, `extract_thinker/concatenation_handler.py#L38`).

## Configuration knobs reference

| Knob | Effect | Where |
|---|---|---|
| `token_limit` ctor arg | per-instance completion cap | `llm.py#L55-L65`, `#L348-L355` |
| `set_temperature` | sampling temperature | `llm.py#L127-L133` |
| `set_thinking` | reasoning mode; forces temp=1 | `llm.py#L135-L141` |
| `set_dynamic` | raw JSON + `<think>` parsing | `llm.py#L144-L153` |
| `set_page_count` | thinking/token budgets from pages | `llm.py#L155-L181` |
| `set_timeout` | request timeout (ms) | `llm.py#L344-L346` |
| `load_router` | litellm Router fallbacks (DEFAULT backend only) | `llm.py#L121-L125` |

## Failure semantics

Provider/parse failures through `request` on the DEFAULT backend propagate instructor exceptions (e.g., `IncompleteOutputException`), which Extractor maps to `ExtractThinkerError` — see [Extractor and Extraction Flow](/openwiki/extractor-and-extraction-flow.md). The PYDANTIC_AI backend flattens all failures to `ValueError`.

Related: [Batch Processing](/openwiki/batch-processing.md) · [Completion Strategies](/openwiki/completion-strategies.md)
