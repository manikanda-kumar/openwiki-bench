---
type: workflow
title: "Completion Strategies (Paginate and Concatenate)"
description: "How ExtractThinker produces complete structured outputs for large documents: FORBIDDEN fails on truncation, PAGINATE extracts per page and merges with LLM conflict resolution, CONCATENATE continues raw JSON generations until the contract parses."
tags: [completion-strategies, pagination, concatenation, merge, conflict-resolution]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Completion Strategies

`CompletionStrategy` is a three-value enum — `FORBIDDEN`, `PAGINATE`, `CONCATENATE` (`extract_thinker/models/completion_strategy.py`) — passed to `Extractor.extract(..., completion_strategy=...)` (default `FORBIDDEN`). It controls what happens when an LLM response cannot fit the contract in a single completion: fail, or recover.

## Dispatch and FORBIDDEN semantics

If the strategy is not `FORBIDDEN`, `extract()` short-circuits into `extract_with_strategy()` before the normal pipeline, which loads the source as a page list (or accepts one) and hands the raw pages to the handler (`extractor.py:235-236,464-504`). The internal `_extract()` also branches on strategy, but the public path reaches it only under `FORBIDDEN` — so handler prompts are built from loader page dicts, not the universal-content format.

`FORBIDDEN` means truncated or invalid output is an error, never a partial result. Instructor's `IncompleteOutputException` — and also `pydantic.ValidationError`, `JSONDecodeError`, or messages containing `json_invalid` — are converted to `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")` (`extractor.py:320-330`). `tests/test_extractor.py:143-161` proves the mechanism by forcing truncation with `LLM(..., token_limit=10)` and asserting that exact error text.

## PaginationHandler (`PAGINATE`)

`PaginationHandler` (subclass of the `CompletionHandler` ABC in `completion_handler.py`) extracts every page independently and merges the partial results (`pagination_handler.py`).

1. **Optionalized contract.** The response model is rebuilt with all fields `Optional` (default `None`) via `utils.make_all_fields_optional`, so a page that only shows part of the data still parses (`pagination_handler.py:33-34`, `utils.py:247-266`).
2. **Parallel per-page requests.** Pages are submitted to a `ThreadPoolExecutor`; each page becomes its own system+user message pair (vision pages add base64 `image_url` parts), optionally with a `##Extra Content` user message inserted after the system message (`pagination_handler.py:36-52,470-541`). Failed pages are printed and silently dropped from the merge; if every page fails, `ValueError("No valid results obtained from any page")` is raised (`pagination_handler.py:54-64`).
3. **Partial completion retry.** A page that hits `IncompleteOutputException` is continued exactly once: the partial text is appended as an assistant message followed by `"## CONTINUE JSON"` (`pagination_handler.py:71-82,433-468`).
4. **Merge.** Field values across pages are collected; list fields are merged by `_merge_list_field`, scalars are de-duplicated (recursively hashable projection): one distinct value wins, multiple distinct values become a marker `{"_conflict": True, "candidates": [...]}` (`pagination_handler.py:84-142`). Note that `pages_data` pairs load-ordered pages with completion-ordered results (`as_completed`), so page↔result alignment in conflict context is best-effort (`pagination_handler.py:55-67`).
5. **List merging by identity key.** For lists of Pydantic models, the first present key among `['country', 'region', 'id', 'name']` is the merge key: entries with equal (case-folded) keys are combined via `_merge_two_models` (existing non-null scalars kept, lists extended); keyless items get synthetic `no_key_N` slots; otherwise lists are simply flattened (`pagination_handler.py:144-223`).
6. **LLM conflict resolution.** Any `_conflict` marker triggers a `ConflictResolution` request (`{resolved_fields: {field: {value, confidence}}}`) whose prompt replays the original pages (text or vision parts) and each page's extracted values; failure raises `ValueError("Failed to resolve conflicts: ...")` (`pagination_handler.py:10-14,270-402`). Resolved values replace markers; any marker left unresolved falls back to `candidates[0]`, `None` fields are dropped, and the final object is validated against the *original* required contract (`pagination_handler.py:225-239,132-142`).

Tests: `test_pagination_handler` extracts a GDP PDF (Docling loader) twice — with and without `PAGINATE` — and compares; `test_pagination_handler_optional` asserts all 6 countries are recovered with an optionalized contract (`tests/test_extractor.py:171-252`).

## ConcatenationHandler (`CONCATENATE`)

`ConcatenationHandler` keeps a single request but grows the answer across continuations (`concatenation_handler.py`).

- The system message embeds `add_classification_structure(response_model)` so the model "follows the response structure exactly" (`concatenation_handler.py:121-131`).
- It calls `llm.raw_completion()` — plain litellm text output, no instructor validation — and accepts responses that contain JSON markers (```` ```json ``, `{`, or `[`) (`concatenation_handler.py:14-48`, `llm.py:298-342`).
- Collected parts are cleaned (fences and newlines stripped), concatenated, `json.loads`-ed, and `model_validate`-d; on any failure the conversation continues with the assistant partial + `"## CONTINUE JSON"`, capped at 3 retries before raising `ValueError("Maximum retries reached ...")` (`concatenation_handler.py:37-97`).
- `test_concatenation_handler` compares a `CONCATENATE` result (vision, `token_limit=4096`) with a `FORBIDDEN` result using embedding cosine similarity for text fields and exact equality for page numbers (`tests/test_extractor.py:280-318`).

## Choosing a strategy

- `FORBIDDEN`: default; strictest — a partial schema is never returned.
- `PAGINATE`: best for multi-page documents whose contract repeats per page (tables, lists of entities); cost scales with page count and merge semantics are as above.
- `CONCATENATE`: best for one large output that simply exceeds the completion token budget; relies on the model continuing its own JSON, so malformed continuations surface as `ValueError` after retries.
