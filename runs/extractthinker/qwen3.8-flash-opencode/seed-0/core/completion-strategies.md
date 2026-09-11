---
type: core-concept
title: Completion Strategies
description: How FORBIDDEN, PAGINATE, and CONCATENATE completion strategies route extraction through the LLM, including per-page parallel merge with conflict resolution and the JSON continuation loop.
tags: [completion-strategy, pagination, concatenation, merge, conflict-resolution]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
sources:
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
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
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# Completion Strategies

`CompletionStrategy` is a three-member enum — `CONCATENATE`, `PAGINATE`, `FORBIDDEN` (models/completion_strategy.py). Every extraction entry point defaults to `FORBIDDEN` (extractor.py:199), and the strategy is stored on the Extractor as `self.completion_strategy` during `extract()` (extractor.py:223).

## Where dispatch happens

The strategy is consulted at two points:

1. **Pre-load dispatch** — if the strategy is not `FORBIDDEN`, `extract()` immediately delegates to `extract_with_strategy(source, ...)` before any loading/merging, which loads the raw source through a loader (or accepts an already-loaded list) and hands the page list to the matching handler; an unrecognized value raises `ValueError` (extractor.py:235-236, 464-504).
2. **Post-message dispatch** — inside `_extract`, once messages are built, `PAGINATE` and `CONCATENATE` instantiate `PaginationHandler(self.llm)` / `ConcatenationHandler(self.llm)` and call `handle(messages, response_model, vision, extra_content)`, while `FORBIDDEN` issues a single `self.llm.request(messages, response_model)` (extractor.py:1132-1143).

Both handlers implement the abstract `CompletionHandler.handle(content, response_model, vision, extra_content)` interface (completion_handler.py:5-27), which is the extension seam for new strategies.

## FORBIDDEN semantics

`FORBIDDEN` means partial/truncated answers are not tolerated. If instructor raises `IncompleteOutputException`, or the response fails `ValidationError`/`JSONDecodeError` (including string-matched `json_invalid`), the Extractor raises `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")` (extractor.py:320-335, 1144-1147). The focused test `test_forbidden_strategy_with_token_limit` pins this behavior by giving the LLM `token_limit=10` and asserting the `ExtractThinkerError` (tests/test_extractor.py:143-161).

## PAGINATE semantics

`PaginationHandler.handle` (pagination_handler.py:28-69) treats its `content` argument as a list of pages:

- The response model is transformed with `make_all_fields_optional`, which dynamically creates a subclass where every field is `Optional[...]` defaulting to `None` — enabling partial per-page results (utils.py:247-267, pagination_handler.py:34).
- Each page gets its own system+user messages (`_build_messages`, vision-aware content blocks) and is processed concurrently in a `ThreadPoolExecutor` (pagination_handler.py:36-61). Page-level exceptions are logged and skipped; if every page fails, `ValueError("No valid results obtained from any page")` is raised (pagination_handler.py:63-64).
- Per-page `IncompleteOutputException` triggers a continuation: the partial text is replayed as an assistant message followed by a user message `"## CONTINUE JSON"` (pagination_handler.py:71-82, 433-468).
- **Merge** — `_merge_results` collects values per field (pagination_handler.py:84-142): list-typed fields go through `_merge_list_field`, which flattens lists of Pydantic models and merges by the first unique-key field found among `country`, `region`, `id`, `name` (case-insensitive, deep-merged via `_merge_two_models`), otherwise concatenates (pagination_handler.py:144-199, 206-224). Scalar fields are de-duplicated with a recursive hashable key; more than one distinct non-null value is recorded as `{"_conflict": True, "candidates": [...]}`.
- **Conflict resolution** — if any `_conflict` marker survives, an LLM call with a `ConflictResolution` Pydantic model (`resolved_fields` dict) picks winners using page contents and per-page extracted values as context; vision pages attach their images (pagination_handler.py:10-13, 131-134, 270-305, 307-402). Failure raises `ValueError("Failed to resolve conflicts: ...")`. Unresolved conflicts are cleaned up by picking the first candidate (pagination_handler.py:225-240).

The handler is exercised by `test_pagination_handler` and `test_pagination_handler_optional` against a multi-page EU data document in vision mode (tests/test_extractor.py:171-233).

## CONCATENATE semantics

`ConcatenationHandler.handle` (concatenation_handler.py:30-60) continues generation until the JSON is complete:

- The system prompt embeds the full field structure via `add_classification_structure(response_model)` so the model knows the target schema (concatenation_handler.py:121-151).
- It calls `self.llm.raw_completion(messages)` — an unvalidated string completion via litellm/router with thinking parameters honored (llm.py:298-342).
- A response is accepted only if it contains JSON markers (`{`, `[`, or ```` ```json ````); otherwise the loop retries. Parts are accumulated and fed back through `_build_continuation_messages` (assistant echo + user `"## CONTINUE JSON"`) (concatenation_handler.py:14-28, 56-60, 99-119).
- After at most 3 attempts without a parseable result it raises `ValueError` ("Maximum retries reached...") (concatenation_handler.py:37-48).
- `_process_json_parts` strips code fences and newlines, concatenates all parts, then `json.loads` + `response_model.model_validate`, wrapping parse/validation failures in `ValueError` that itself consumes a retry attempt (concatenation_handler.py:62-97).

`test_concatenation_handler` runs the same document through `CONCATENATE` and `FORBIDDEN` and asserts the results are (semantically) equivalent (tests/test_extractor.py:280-317).

## Interaction notes

- Because the pre-load path passes loader output (page dicts with `content`/`image`) while the post-message path passes built messages, `PaginationHandler` consumes different shapes depending on the entry point; only one dispatch runs per call (the `extract()` non-FORBIDDEN check short-circuits before `_extract`).
- `extra_content` is injected as a second user message (`##Extra Content`) after the system message in both handlers (concatenation_handler.py:220-225, pagination_handler.py:536-541).
- Thinking/page-count effects: the FORBIDDEN single-call path sets `llm.set_page_count` from metadata (extractor.py:303-314), while `extract_with_strategy` does not set page counts before invoking handlers.

## Related pages

- `core/extractor.md` — where strategies are threaded through the pipeline
- `core/llm-integration.md` — `LLM.request` vs `raw_completion`
- `architecture/overview.md` — component boundaries
