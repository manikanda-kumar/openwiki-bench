---
type: core-mechanism
title: Completion Strategies
description: FORBIDDEN, PAGINATE, and CONCATENATE extraction strategies and the handlers that implement page-parallel merging and streamed JSON continuation.
tags: [completion-strategy, pagination, concatenation, conflict-resolution]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
  - id: openwiki-source-7a642dbc4c0ac0458f24b380
    resource: repo://tests/test_ollama.py
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Completion Strategies

Large documents routinely exceed what a single LLM completion can reliably produce. `CompletionStrategy` (extract_thinker/models/completion_strategy.py:4-7) selects how `Extractor` copes:

- `FORBIDDEN` (default) — one request for the whole content; incomplete/invalid output is an immediate error.
- `PAGINATE` — per-page extraction in parallel, then merge; unresolved disagreements go back to the LLM for conflict resolution.
- `CONCATENATE` — stream the output as multiple raw completions that are stitched into one JSON document.

## Dispatch points

`Extractor.extract` routes non-FORBIDDEN strategies to `extract_with_strategy` (extract_thinker/extractor.py:235-236, 464-504), which loads page content and hands it to `PaginationHandler` or `ConcatenationHandler`. `_extract` also re-dispatches inside the message pipeline (extract_thinker/extractor.py:1132-1139) — meaning the handlers receive **messages** in that path but raw page content in the `extract_with_strategy` path; both handlers build their own message lists internally. An unknown strategy raises `ValueError` (extract_thinker/extractor.py:1143).

Both handlers share `CompletionHandler`, an ABC owning `handle(content, response_model, vision, extra_content)` and the LLM reference (extract_thinker/completion_handler.py:5-27). Shared message-assembly helpers (`_build_messages`, `_add_images_to_message_content`, `_add_extra_content`) live on the handlers, not the ABC.

## PaginationHandler

`PaginationHandler.handle` (extract_thinker/pagination_handler.py:28-69):

1. Makes every field of the response model optional via `make_all_fields_optional` (extract_thinker/utils.py:247) so per-page partial results can validate.
2. Processes all pages concurrently with a `ThreadPoolExecutor`, skipping failed pages with a printed error; if **no** page succeeds it raises `ValueError` "No valid results obtained from any page".
3. Pairs each page with its result (`pages_data`) and calls `_merge_results`.

Merging (extract_thinker/pagination_handler.py:84-142):

- Collects per-field value lists across pages.
- **List fields**: flattened and, when the item type is a Pydantic model, deduplicated by a hard-coded candidate unique-key list `['country', 'region', 'id', 'name']` (case-insensitive string compare), merging same-key entries with `_merge_two_models` (lists extend; for scalar conflicts the existing value wins). Items without the unique key are stored under synthetic `no_key_N` keys (extract_thinker/pagination_handler.py:144-223).
- **Scalar fields**: fully-null collapses (to `""` when the field is str-typed), distinct values deduplicate via a hashable projection; a remaining disagreement becomes a `{"_conflict": True, "candidates": [...]}` placeholder.

Conflict resolution (extract_thinker/pagination_handler.py:241-306): when conflicts exist, `_resolve_conflicts` builds a prompt containing the original pages and the conflicting candidates, requests a `ConflictResolution` Pydantic model from the LLM, and merges resolved values. A failure raises `ValueError` d with context-size and LLM-capability hints. Leftover unresolved conflicts degrade defensively to the first candidate in `_clean_merged_dict`, then null fields are dropped and the final `response_model(**merged)` is built.

Incomplete per-page outputs (`IncompleteOutputException`) are handled by `_process_page`’s partial-response path, allowing the merge to fill them in from other pages (extract_thinker/pagination_handler.py:71-82).

## ConcatenationHandler

`ConcatenationHandler.handle` (extract_thinker/concatenation_handler.py:30-61) issues `llm.raw_completion` calls (no response model) and:

1. Validates each response continues JSON using `_is_valid_json_continuation` — a loose check that rejects only responses with neither ``` fences, `{`, nor `[`.
2. Appends accepted parts; after each part it attempts `_process_json_parts`, which strips code fences/newlines, concatenates all parts, parses with `json.loads`, and validates into the response model.
3. Failures rebuild continuation messages (`_build_continuation_messages`) and retry; a retry counter enforces `max_retries = 3`, after which `ValueError` is raised ("Maximum retries reached…").

This design forces the model to resume an incomplete JSON object across calls, so `CONCATENATE` avoids instructor entirely and relies on `LLM.raw_completion`.

## Interaction with FORBIDDEN failure semantics

Under FORBIDDEN, `Extractor.extract` wraps `IncompleteOutputException`, `ValidationError`, and `JSONDecodeError` into `ExtractThinkerError` (see Extraction Flow). The other strategies instead *tolerate* those conditions: PAGINATE absorbs them per page, CONCATENATE retries them. This trade-off is the central reason to pick a strategy.

## Representative tests

- tests/test_extractor.py and tests/test_process.py exercise strategy-annotated extractions against sample documents; the handlers' lifecycle is otherwise exercised indirectly through the Extractor API. No dedicated unit test for PaginationHandler conflict resolution exists (checked by searching tests/ for `PaginationHandler`).
