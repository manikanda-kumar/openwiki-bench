---
type: completion-strategies
title: Completion Strategies — Paginate and Concatenate
description: How CompletionStrategy.FORBIDDEN, PAGINATE, and CONCATENATE route long-content extraction through PaginationHandler and ConcatenationHandler, including optional-field models, parallel per-page processing, merging, and conflict resolution.
tags: [completion-strategies, pagination, concatenation, merging, conflict-resolution]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
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
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Completion Strategies: Paginate and Concatenate

`CompletionStrategy` is a three-value enum: `CONCATENATE`, `PAGINATE`, and `FORBIDDEN` (`extract_thinker/models/completion_strategy.py:1-5`). It controls what happens when document content is too large (or too fragmented) for a single LLM completion.

## Where dispatch happens

Two call sites implement the strategy:

- `Extractor.extract` checks the strategy *before* loading: anything other than `FORBIDDEN` routes to `extract_with_strategy`, which passes raw loader output (page list or source) to the handler (`extract_thinker/extractor.py:235-236`, `extract_thinker/extractor.py:464-504`).
- `Extractor._extract` checks the strategy *after* message building: `FORBIDDEN` issues a single `llm.request(messages, response_model)`; `PAGINATE`/`CONCATENATE` hand the built messages to their handlers (`extract_thinker/extractor.py:1132-1143`).

In practice, the pre-load path in `extract_with_strategy` is the one that runs for non-`FORBIDDEN` strategies, so handlers receive the loaded page content. An unsupported strategy value raises `ValueError` in both paths.

`FORBIDDEN` means "never allow truncated output": if instructor raises `IncompleteOutputException`, `Extractor.extract` converts it to `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")` (`extract_thinker/extractor.py:320-321`, `extract_thinker/extractor.py:1144-1147`).

## CompletionHandler contract

Both handlers extend the abstract `CompletionHandler`, which owns the `llm` and defines `handle(content, response_model, vision=False, extra_content=None)` (`extract_thinker/completion_handler.py:1-24`).

## PaginationHandler

`PaginationHandler` extracts each page independently and merges the per-page results into one response model instance.

**Per-page processing** (`extract_thinker/pagination_handler.py:31-90`):

1. `make_all_fields_optional(response_model)` dynamically creates a subclass named `<Model>Optional` where every field becomes `Optional[...]` with a `None` default, so a page that lacks a field can still validate (`extract_thinker/utils.py:247-266`).
2. Each page's messages are built with the standard system prompt plus text and (in vision mode) base64 image parts; `extra_content` is inserted as a second message.
3. Pages are processed in parallel with a `ThreadPoolExecutor`; per-page failures are printed and skipped.
4. If a page request raises `IncompleteOutputException`, `_handle_partial_response` appends the partial completion as an assistant message plus a `"## CONTINUE JSON"` user message and re-requests (`extract_thinker/pagination_handler.py:428-455`).
5. If no page produced a result, `ValueError("No valid results obtained from any page")` is raised.

**Merging** (`_merge_results`, `extract_thinker/pagination_handler.py:106-160`):

- Values are collected per field across pages.
- **List fields** go through `_merge_list_field`: values are flattened; if the list element type is a Pydantic model and the model has one of the candidate unique keys `country`, `region`, `id`, or `name`, items are merged by that key (case-insensitive) via `_merge_two_models`, which fills missing/None fields and extends lists but keeps the existing value on scalar conflicts. Without a unique key, lists are simply concatenated (`extract_thinker/pagination_handler.py:170-230`).
- **Scalar fields**: if all values are `None`, string-typed fields default to `""` and others are dropped. Distinct non-null values (compared by a hashable normalization) that differ are stored as a conflict marker: `{"_conflict": True, "candidates": [...]}` (`extract_thinker/pagination_handler.py:133-155`).

**Conflict resolution** (`extract_thinker/pagination_handler.py:265-320`):

- If any conflict markers remain, `_resolve_conflicts` builds a prompt containing the conflicting candidates plus every page's original content and per-page extracted values, and asks the LLM to return a `ConflictResolution` object — `resolved_fields: Dict[str, Dict[str, Any]]` mapping field names to `{"value": ..., "confidence": 1-10}` (`extract_thinker/pagination_handler.py:21-25`).
- When any page carries image data, the prompt is built as vision-compatible multipart content including base64 `image_url` parts; otherwise it is plain text with YAML-dumped pages (`extract_thinker/pagination_handler.py:337-411`).
- A failed resolution request raises `ValueError` noting the context may be too large.
- Resolved values are merged back, the merged dict is cleaned against the response model, `None`-valued keys are dropped, and the final `response_model(**merged)` is returned.

## ConcatenationHandler

`ConcatenationHandler` takes the opposite approach: it sends everything to the LLM in one conversation and stitches truncated JSON continuations together (`extract_thinker/concatenation_handler.py:23-69`):

1. Messages are built with the system prompt plus the full contract structure rendered by `add_classification_structure`, followed by the whole content (text or vision multipart).
2. `raw_completion` (no response model, no instructor) is called; the response is accepted only if it looks like a JSON continuation (` ```json `, `{`, or `[` present).
3. Each accepted response is appended to `json_parts`; `_process_json_parts` strips code fences and newlines, concatenates all parts, `json.loads` the combined string, and validates it against the response model. Any parse/validation failure raises `ValueError`.
4. On failure or invalid continuation, `_build_continuation_messages` appends the partial response as an assistant message plus `"## CONTINUE JSON"` and retries, up to `max_retries = 3`; exhausting retries raises `ValueError("Maximum retries reached...")`.

Note that each retry re-collects from scratch per loop iteration but `json_parts` accumulates across successful iterations; a continuation that still fails validation after the retry budget aborts the whole extraction.

## Choosing a strategy

| Strategy | Mechanism | Best suited for | Failure mode |
|---|---|---|---|
| `FORBIDDEN` | Single structured request | Small documents | `ExtractThinkerError` on incomplete output |
| `PAGINATE` | Parallel per-page extraction + merge | Field values localized per page (invoices, forms) | Conflict-resolution LLM call may fail on huge contexts |
| `CONCATENATE` | Single request + JSON continuation stitching | Content that must be interpreted holistically | JSON parse/validation failures after 3 retries |

## Related pages

- [Extractor: Extraction and Classification Engine](extractor.md)
- [LLM Integration Layer](llm-integration.md)
- [Architecture and Component Map](architecture.md)
