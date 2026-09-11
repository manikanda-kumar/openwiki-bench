---
type: concept
title: "Completion strategies: PAGINATE, CONCATENATE, and FORBIDDEN"
description: "How ExtractThinker handles outputs that exceed a model's completion-token limit: the CompletionStrategy enum and the PAGINATE, CONCATENATE, and FORBIDDEN behaviors implemented by PaginationHandler and ConcatenationHandler."
tags: [completion-strategy, pagination, concatenation, extraction, llm]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:31:28.803Z
---

# Completion strategies: PAGINATE, CONCATENATE, and FORBIDDEN

`CompletionStrategy` (extract_thinker/models/completion_strategy.py) has three values:

- `CONCATENATE` = "concatenate"
- `PAGINATE` = "paginate"
- `FORBIDDEN` = "forbidden" (the default)

It controls how a single `Extractor.extract` call turns document content into a validated Pydantic result when a one-shot completion may be truncated. The handlers share the `CompletionHandler` ABC (extract_thinker/completion_handler.py), which only fixes the `handle(content, response_model, vision, extra_content)` signature.

The strategy is passed per call (default `CompletionStrategy.FORBIDDEN`). When the strategy is `FORBIDDEN`, `Extractor.extract` runs the single-request path (`_extract`); when it is anything else, `Extractor.extract_with_strategy` loads the content and dispatches to the corresponding handler (extractor.py).

## FORBIDDEN: one request, no truncation tolerated

With `FORBIDDEN`, the built messages are sent once through `self.llm.request(messages, response_model)` (extractor.py `_extract`). The "forbidden" name means that any incomplete output is an error: `IncompleteOutputException` from instructor, a Pydantic `ValidationError`, a JSON decode failure, or a `json_invalid` signal is mapped to `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")` (extractor.py `extract` exception handling). Vision-related `litellm.BadRequestError` failures are classified into `VisionError` separately. This is the default path and the one validated by `test_forbidden_strategy_with_token_limit`.

## PAGINATE: extract per page, then merge

`PaginationHandler.handle` (extract_thinker/pagination_handler.py) processes each page independently and merges the per-page results:

1. **Per-page optional model.** `make_all_fields_optional(response_model)` builds a derived Pydantic model where every field is `Optional` (extract_thinker/utils.py), so a single page may legitimately lack fields. Each page's messages are submitted to a `ThreadPoolExecutor`; results are collected as they complete, and page-level errors are logged and skipped.
2. **Partial-output continuation.** If instructor raises `IncompleteOutputException` for a page, `_process_page` appends the partial assistant content plus a `## CONTINUE JSON` user message and retries once via `_handle_partial_response` / `_build_continuation_messages`.
3. **Merge.** `_merge_results` collects the value candidates per field. List fields are merged with `_merge_list_field`: for lists of Pydantic models it tries a unique key (`country`, `region`, `id`, or `name`) with case-insensitive matching and merges same-key models via `_merge_two_models`; otherwise lists are flattened/concatenated. Scalar fields that agree collapse to one value; scalars that disagree are wrapped as `{"_conflict": True, "candidates": [...]}`.
4. **Conflict resolution.** If any `_conflict` structure survives, `_resolve_conflicts` builds a prompt containing each original page (including images when vision content is present) plus the extracted values, and asks the LLM for a `ConflictResolution` mapping `field_name -> {"value", "confidence"}`. The resolved values are written back and the dictionary is cleaned before `response_model(**merged)` instantiates the final result. If the LLM cannot resolve, a `ValueError` is raised.

`PAGINATE` is exercised in `tests/test_extractor.py` (`test_pagination_handler`, `test_pagination_handler_optional`) against a multi-page GDP report with a `Contract` and with all-optional fields.

## CONCATENATE: continue a single JSON stream

`ConcatenationHandler.handle` (extract_thinker/concatenation_handler.py) treats the whole document as one logical output that may be cut off mid-JSON:

1. It builds one message set (system prompt includes the response structure via `add_classification_structure`) and calls `self.llm.raw_completion(messages)` — a raw completion with no `response_model`.
2. The raw response is validated as a plausible JSON continuation (`_is_valid_json_continuation` looks for ```` ```json ````, `{`, or `[`). If invalid, it retries; after 3 retries it raises `ValueError("Maximum retries reached...")`.
3. Each accepted chunk is appended to `self.json_parts`; then `_process_json_parts` strips code fences and newlines, concatenates all parts, `json.loads` the result, and validates it with `response_model.model_validate(parsed)`.
4. If validation fails, it loops again with `_build_continuation_messages` (assistant partial content + `## CONTINUE JSON` user message) to ask the model to continue the same JSON.

`test_concatenation_handler` compares a `CONCATENATE` run against a `FORBIDDEN` run on a chart image, asserting the titles and first page content are semantically similar.

## How Extractor dispatches

In `Extractor.extract_with_strategy` (extractor.py), when the source is not already a list, the selected document loader's `load()` is called and the resulting page list is handed to `PaginationHandler(self.llm)` or `ConcatenationHandler(self.llm)` depending on the strategy. When the source is already content (e.g. from a split workflow), the handler receives it directly. `extra_content` is injected into every page's messages by the handlers.

## Relationship to the LLM layer

All three strategies ultimately depend on the `LLM` defaults: `DEFAULT_MAX_COMPLETION_TOKENS = 8000` is the default `max_completion_tokens` sent with each request, and it can be overridden with `token_limit=` when constructing an `LLM`. When a document genuinely needs more output than the limit, `FORBIDDEN` will fail while `PAGINATE`/`CONCATENATE` exist to recover. See [LLM integration](llm-integration.md).