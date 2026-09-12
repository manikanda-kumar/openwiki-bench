---
type: concept
title: Completion Strategies
description: How ExtractThinker handles large or paginated content during structured extraction through the FORBIDDEN, PAGINATE, and CONCATENATE completion strategies and their handlers.
tags: [completion, extraction, pagination, concatenation, forbidden]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
sources:
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---

# Completion Strategies

The `CompletionStrategy` enum (`extract_thinker/models/completion_strategy.py`) defines three strategies: `FORBIDDEN`, `PAGINATE`, and `CONCATENATE`. It controls how `Extractor` handles content when a single LLM completion cannot (or should not) cover the whole document. Handlers share a base-class contract defined in `CompletionHandler` (`extract_thinker/completion_handler.py`).

## Dispatch points

Completion strategy is applied in two places:

- `Extractor.extract_with_strategy` (`extract_thinker/extractor.py:464-504`) — used when a non-`FORBIDDEN` strategy is passed into `extract`; it loads content through the appropriate DocumentLoader (or uses already-list content) and delegates to `PaginationHandler` or `ConcatenationHandler`.
- `Extractor._extract` (`extract_thinker/extractor.py:1133-1147`) — the internal path builds messages and dispatches the same way, with `FORBIDDEN` delegating straight to `LLM.request`.

## FORBIDDEN

The default strategy. `_extract` calls `LLM.request(messages, response_model)` directly. If the response is incomplete or fails validation, an `IncompleteOutputException` (or equivalent) is caught and raised as `ExtractThinkerError` ("Incomplete output received and FORBIDDEN strategy is set"). This guarantees the operation either returns a fully validated model instance or throws — no partial result is returned (`extract_thinker/extractor.py:1144-1147`).

## PAGINATE

`PaginationHandler` (`extract_thinker/pagination_handler.py`) processes large/paginated content page-by-page in parallel and merges the per-page results into a single response model instance.

Flow:

1. `handle` makes all fields of the response model optional via `make_all_fields_optional` so partial per-page results are valid (`pagination_handler.py:28-34`, `utils.py:247-266`).
2. It builds messages for each page and submits them to a `ThreadPoolExecutor`; each page runs `_process_page`, which retries incomplete outputs with a continuation request (`_handle_partial_response` appends the partial assistant content and a `## CONTINUE JSON` user message) (`pagination_handler.py:36-82,433-468`).
3. It collects results and merges them via `_merge_results`:
   - List-typed fields are merged, deduplicating on candidate key fields like `country`, `region`, `id`, or `name` for Pydantic-model lists (`_merge_list_field`, `pagination_handler.py:144-204`).
   - Scalar fields that agree are merged directly.
   - Distinct conflicting scalar candidates are stored in a `{"_conflict": True, "candidates": [...]}` structure (`_merge_results`, `pagination_handler.py:84-142`).
4. When conflicts exist, `_resolve_conflicts` asks the LLM to choose values with `ConflictResolution` (a dict of `resolved_fields` each holding a `value` and `confidence`). The prompt includes all page contents/values, with vision images inlined as base64 when pages contain images (`pagination_handler.py:270-403`).
5. Resolved dict is `_clean_merged_dict`'d (empty-list/None cleanup) and instantiated into the response model (`pagination_handler.py:225-239`).

`PaginationHandler` supports both vision and text content, building images into the message via `_build_vision_content` when present.

## CONCATENATE

`ConcatenationHandler` (`extract_thinker/concatenation_handler.py`) streams JSON output in potentially multiple continuation requests, then combines the fragments into a single JSON document parsed into the response model.

Flow:

1. `handle` builds messages with a system prompt that embeds the response structure (`add_classification_structure`), then calls `llm.raw_completion`.
2. `_is_valid_json_continuation` checks that a response contains JSON markers (`{`, `[`, `` ```json ``). If not, it retries; after `max_retries` (3) invalid responses it raises `ValueError` (`concatenation_handler.py:14-28,37-60`).
3. Valid fragments are appended to `self.json_parts`. `_process_json_parts` strips code fences and extraneous markers, concatenates the parts into a single string, `json.loads` it, and validates via `response_model.model_validate` (`concatenation_handler.py:62-97`).
4. On parse/validation failure, `handle` retries by appending the partial output as an assistant message and a `## CONTINUE JSON` user message (`_build_continuation_messages`, `concatenation_handler.py:99-119`), up to the retry budget.
5. `_build_vision_content` is included for vision-based extraction, adding both text and base64 image_url content.

Because it accumulates raw JSON text and relies on `model_validate`, `ConcatenationHandler` is well-suited to models that stream JSON or get truncated, rather than for combining field-by-field page results the way `PaginationHandler` does.
