---
type: mechanism
title: Completion Strategies
description: How FORBIDDEN, PAGINATE, and CONCATENATE govern what happens when document content exceeds what fits in one LLM completion — single-request failure, parallel per-page extraction with conflict resolution, or iterative JSON continuation.
tags: [completion-strategies, pagination, concatenation, conflict-resolution, extraction]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
sources:
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
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
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# Completion Strategies

All three strategies live in `extract_thinker/models/completion_strategy.py` (`#L1-L6`): `FORBIDDEN` (default), `PAGINATE`, and `CONCATENATE`. Long documents whose data spans pages cannot be extracted in one LLM call; the strategy flag tells `Extractor` how to behave.

Two dispatch points exist (`extract_thinker/extractor.py#L235-L236, 496-504, 1132-1147`):

- `extract_with_strategy` handles the strategy early, on raw loaded content (page list).
- `_extract` dispatches after message building when FORBIDDEN wasn't caught earlier.

Unknown strategy values raise `ValueError("Unsupported completion strategy")` in both paths.

## FORBIDDEN (default)

No splitting happens: the entire merged content is sent in a single request and `instructor` parses/validates it (`extract_thinker/extractor.py#L1140-L1141`). If the LLM's output is cut off (`IncompleteOutputException`) or fails JSON validation, extraction fails with `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")` rather than silently returning partial data (`extract_thinker/extractor.py#L320-L335, 1144-1147`). This is the "fail loudly" default.

## PAGINATE — PaginationHandler

`PaginationHandler.handle` (`extract_thinker/pagination_handler.py#L32-77`) processes pages **in parallel** with a `ThreadPoolExecutor`:

1. `make_all_fields_optional(response_model)` (from `extract_thinker/utils.py#L247`) produces a permissive copy of the contract, because any single page will only contain some fields.
2. Each page is extracted independently with retry logic for incomplete responses — a partial `IncompleteOutputException` result is accepted so downstream pages still contribute (`_process_page`, `#L68-L92`).
3. `_merge_results` (`#L94-L162`) collects each field's values across all pages and merges:
   - **List fields** are merged by `(_merge_list_field, #L133-L217)`: for lists of Pydantic models, items are deduplicated and combined by a unique key chosen from candidate keys `country`, `region`, `id`, `name` (case-insensitive); otherwise lists are simply concatenated.
   - **Scalar fields**: all non-null page values are considered; if exactly one distinct value survives `_make_hashable` deduplication, it wins; if two or more disagree the field becomes a `{"_conflict": True, "candidates": [...]}` placeholder.
4. If any conflicts exist, `_resolve_conflicts` sends all conflicts **plus the original page contents** back to the LLM against a `ConflictResolution` model (`extract_thinker/pagination_handler.py#L10-L13, 269-L303`). Failure there raises `ValueError` hinting at oversized context.
5. The merged dict is cleaned against the response model's fields and re-instantiated (`response_model(**merged)`, `#L112-L127`).

Operational implication: paginate trades one request for N parallel page requests plus possibly one conflict-resolution request, and its behavior depends on heuristic unique keys — contracts whose model lists have none of the candidate keys degrade to plain concatenation.

## CONCATENATE — ConcatenationHandler

`ConcatenationHandler.handle` (`extract_thinker/concatenation_handler.py#L34-L67`) builds one message with the response structure embedded via `add_classification_structure` (`#L135-L145`), then loops:

1. Call `llm.raw_completion(messages)` — deliberately not the parsed request path, since the output is raw JSON under construction.
2. Validate the response looks like a JSON continuation (`_is_valid_json_continuation`, `#L14-L28`); invalid continuations count against `max_retries = 3`.
3. Accumulate the raw chunk and attempt `_process_json_parts` — fence/code-marker cleanup then JSON stitching into the final response model (`#L101-L121`).
4. On failure, append the partial content as an assistant message plus a `## CONTINUE JSON` user message and loop (`_build_continuation_messages`, `#L100-L113`).

Result semantics differ fundamentally from PAGINATE: CONCATENATE is sequential and single-threaded — it grows one JSON document across turns; PAGINATE is parallel per-page and explicit about conflicts.

## Shared base

`CompletionHandler` (`extract_thinker/completion_handler.py#L5-L25`) is a minimal ABC holding the `llm` and mandating `handle(content, response_model, vision, extra_content)`. A new strategy subclasses this and is registered at both dispatch points — see [Change Guides](/openwiki/change-guides.md#guide-3-add-a-new-completionstrategy).

## Tests

`tests/test_extractor.py#L143-L318` covers the three strategies: `test_forbidden_strategy_with_token_limit` (FORBIDDEN and token limits), `test_pagination_handler` / `test_pagination_handler_optional` (paginate merge behavior), and `test_concatenation_handler`. They are integration tests requiring live LLM credentials.

Related: [Extractor and Extraction Flow](/openwiki/extractor-and-extraction-flow.md) · [LLM Layer](/openwiki/llm-layer.md)
