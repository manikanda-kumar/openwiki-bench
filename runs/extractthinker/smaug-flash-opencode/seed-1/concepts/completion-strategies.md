---
type: concept
title: Completion Strategies for Large Documents
description: How ExtractThinker handles incomplete or truncated LLM output for large documents through CompletionStrategy (FORBIDDEN, PAGINATE, CONCATENATE) and the PaginationHandler and ConcatenationHandler implementations.
tags: [completion, pagination, concatenation, large-documents, llm-output]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
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
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---

# Completion Strategies for Large Documents

Large documents can exceed a model's output-token budget, causing LLM responses to be truncated. ExtractThinker provides a `CompletionStrategy` to control how such incomplete output is handled.

## The CompletionStrategy enum

`CompletionStrategy` (`extract_thinker/models/completion_strategy.py:4`) has three values:

- `FORBIDDEN = "forbidden"` — a single request must succeed completely; truncated/hallucinated output is an error.
- `PAGINATE = "paginate"` — process the content page-by-page, then merge per-page results into one response.
- `CONCATENATE = "concatenate"` — let the model stream a continuation of the JSON output until the response is complete.

The enum is the extension seam: new strategies would be implemented as a new `CompletionHandler` subclass (see `extract_thinker/completion_handler.py:5`).

## Where strategies are applied

`Extractor._extract` (`extract_thinker/extractor.py:1134`) dispatches on the strategy:

- `FORBIDDEN` → `self.llm.request(messages, response_model)` directly.
- `PAGINATE` → `PaginationHandler(self.llm).handle(...)`.
- `CONCATENATE` → `ConcatenationHandler(self.llm).handle(...)`.

`Extractor.extract` and `extract_async` accept `completion_strategy` as a parameter; when it is not `FORBIDDEN`, extraction routes through `extract_with_strategy` (`extract_thinker/extractor.py:464`), which loads the content, then invokes the appropriate handler.

## CompletionHandler contract

`CompletionHandler` (`extract_thinker/completion_handler.py:5`) is the abstract base:

```python
def handle(self, content, response_model, vision=False, extra_content=None) -> Any
```

Each handler builds its own messages, asks the LLM, and returns a validated `response_model` instance. Both `PaginationHandler` and `ConcatenationHandler` subclass it.

## PaginationHandler

`PaginationHandler` (`extract_thinker/pagination_handler.py:16`) processes content page by page in parallel and merges the partial results.

### Per-page parallel extraction

`handle` (`extract_thinker/pagination_handler.py:28`):

1. Makes all fields of the response model optional with `make_all_fields_optional` (`extract_thinker/utils.py:247`), so each page can match only the subset of fields it can answer (e.g., a table found on page 5).
2. Builds messages per page and submits each to a `ThreadPoolExecutor` via `_process_page`.
3. Collects results with `as_completed`; errors on one page are logged and that page contributes no data, but processing of other pages continues.
4. If no page yields a result, raises `ValueError("No valid results obtained from any page")`.
5. Zips the original page contents with their results (`pages_data`) and calls `_merge_results`.

### Partial response continuation

When a page's request raises `IncompleteOutputException`, `_handle_partial_response` (`extract_thinker/pagination_handler.py:433`) takes the truncated assistant content flags it and issues a "## CONTINUE JSON" user message (`_build_continuation_messages`), retrying the request to obtain the complete JSON.

### Merge logic

`_merge_results` (`extract_thinker/pagination_handler.py:84`):

- **List fields**: `_merge_list_field` (`extract_thinker/pagination_handler.py:144`) flattens all per-page lists. If the list element is a Pydantic model, it tries to merge items on a unique key (probing candidate keys `country`, `region`, `id`, `name`). Non-Pydantic or un-keyed lists are simply flattened.
- **Scalar fields**: values are de-duplicated via `_make_hashable`. If exactly one distinct value exists, it is used; otherwise a conflict marker dict `{"_conflict": True, "candidates": [...]}` is recorded.
- **Missing values**: for scalar string fields with no non-null value across pages, a default empty string is used; other missing fields are dropped.

### Conflict resolution

If `_has_conflicts` detects conflict markers, `_resolve_conflicts` (`extract_thinker/pagination_handler.py:270`) builds a prompt (`_build_conflict_resolution_prompt`) containing each conflicting field, the candidate values, and the original page contents (including, in vision mode, the relevant page images). It asks the LLM to return a `ConflictResolution` map of `{field: {value, confidence}}` via `_request_conflict_resolution`, and merges the chosen values back into the result.

### Finalization

`_clean_merged_dict` (`extract_thinker/pagination_handler.py:225`) strips any surviving `_conflict` structures (picking the first candidate), and null values are filtered before constructing the final `response_model(**merged)`.

## ConcatenationHandler

`ConcatenationHandler` (`extract_thinker/concatenation_handler.py:9`) lets the model continue writing the JSON until it is complete, instead of rejecting truncation.

### Flow

`handle` (`extract_thinker/concatenation_handler.py:30`):

1. Builds messages with `_build_messages` which embeds the response structure.
2. Calls `self.llm.raw_completion(messages)` to get raw text (no structured parsing).
3. Validates the response contains JSON markers via `_is_valid_json_continuation` (checks for ```` ```json ````, `{`, or `[`). A non-JSON response is retried, up to `max_retries = 3`.
4. Appends the response to `self.json_parts`.
5. Tries to parse/validate with `_process_json_parts`.

### JSON assembly and validation

`_process_json_parts` (`extract_thinker/concatenation_handler.py:62`) strips code fences and newlines, concatenates all collected parts into one string, `json.loads` the combined JSON, and validates it against the response model with `response_model.model_validate(parsed)`. A `JSONDecodeError` or validation failure triggers a `ValueError`.

### Continuation

On retry, `_build_continuation_messages` (`extract_thinker/concatenation_handler.py:99`) appends the partial content as an assistant message and adds a `"## CONTINUE JSON"` user message, prompting the model to continue exactly where it left off. If `max_retries` is exhausted, a `ValueError` is raised.

## Testing

Focused tests validate the strategies:

- `tests/test_extractor.py::test_pagination_handler` runs `PAGINATE` and `FORBIDDEN` extractions in parallel and asserts both yield equivalent top-level GDP fields and country counts.
- `tests/test_extractor.py::test_pagination_handler_optional` asserts pagination returns all six countries from an optional-all-fields model.
- `tests/test_extractor.py::test_concatenation_handler` compares `CONCATENATE` output against `FORBIDDEN` output for title and page content using embedding-based semantic similarity.
- `tests/test_extractor.py::test_forbidden_strategy_with_token_limit` verifies `FORBIDDEN` raises `ExtractThinkerError` when output is truncated.
