---
type: concept
title: Completion Strategies
description: How ExtractThinker handles very long documents when a single LLM response is not enough — the FORBIDDEN, PAGINATE, and CONCATENATE strategies, page-parallel merging, conflict resolution, and partial-JSON continuation.
tags: [completion, pagination, concatenation, long-documents]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
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
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# Completion Strategies

When a document is too large for a single LLM response (or the model truncates
its output), ExtractThinker changes how the request is shaped via a completion
strategy. The enum is defined in
`extract_thinker/models/completion_strategy.py`:

- `FORBIDDEN` — the default; a single request must produce the complete answer.
- `PAGINATE` — extract each page separately, then merge the results.
- `CONCATENATE` — stream/continue a single JSON response across requests.

The strategy is passed to `Extractor.extract(..., completion_strategy=...)`
(also `extract_async` and `Process.extract`). When a non-FORBIDDEN strategy is
given, `Extractor.extract` routes to `extract_with_strategy`
(`extract_thinker/extractor.py:235-236`, `464-504`), which loads the content
(page list) and hands it to the corresponding handler. When FORBIDDEN is used,
`_extract` builds messages and calls `self.llm.request` directly
(`extract_thinker/extractor.py:1140-1141`).

## Handler base class

Both concrete handlers subclass `CompletionHandler`
(`extract_thinker/completion_handler.py:5-27`), whose contract is:

```python
handle(content, response_model, vision=False, extra_content=None) -> Any
```

Each handler is constructed with the extractor's `self.llm`.

## FORBIDDEN

FORBIDDEN means "one shot or fail". If instructor raises
`IncompleteOutputException` (or the output fails validation/JSON parsing), the
extractor wraps it as
`ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")`
(`extract_thinker/extractor.py:1144-1147`, `320-335`). This is the strictest
strategy and the default.

## PAGINATE

`PaginationHandler` (`extract_thinker/pagination_handler.py:16-...`) handles the
document page by page:

1. It builds an "optional" version of the response model via
   `make_all_fields_optional` (`extract_thinker/utils.py:247-266`), which
   rewrites every field as `Optional[...]` so each page can yield a partial
   result.
2. Each page is submitted to `self.llm.request` in a `ThreadPoolExecutor`
   (`extract_thinker/pagination_handler.py:37-61`). A page whose response is
   incomplete (`IncompleteOutputException`) is retried once via
   `_handle_partial_response`, which appends the partial assistant output plus a
   `"## CONTINUE JSON"` user message and re-requests
   (`extract_thinker/pagination_handler.py:433-468`).
3. Page results are merged (`_merge_results`): list fields are concatenated (and
   merged by a unique key like `country`/`region`/`id`/`name` when the list holds
   Pydantic models), and scalar fields collapse to a single distinct value.
   Distinct conflicting scalar values are stored as
   `{"_conflict": True, "candidates": [...]}`.
4. If conflicts exist, they are resolved by an LLM call. `_request_conflict_resolution`
   builds a prompt with every page's original content and extracted values
   (vision-aware when pages carry images) and asks the model for a
   `ConflictResolution` — a dict of `field_name -> {"value": ..., "confidence": ...}`
   (`extract_thinker/pagination_handler.py:281-402`).
5. The merged dict is cleaned and validated into the final `response_model`
   (`extract_thinker/pagination_handler.py:135-142`).

Page processing is parallel, so page count does not serialize latency; a single
page failure is logged and skipped, and if no page returns a valid result the
handler raises `ValueError("No valid results obtained from any page")`
(`extract_thinker/pagination_handler.py:63-64`).

## CONCATENATE

`ConcatenationHandler` (`extract_thinker/concatenation_handler.py:9-...`) keeps
the whole document in one logical request but resumes the JSON if the model
stops:

1. It builds messages embedding the response-model structure in the system prompt
   via `add_classification_structure` and calls `self.llm.raw_completion`
   (`extract_thinker/concatenation_handler.py:30-54`) — i.e. no
   instructor-managed response model.
2. If the raw response is not a plausible JSON continuation (`_is_valid_json_continuation`
   checks for ```` ```json ````, `{`, or `[`), it retries up to
   `max_retries = 3`.
3. Otherwise the response is appended to `self.json_parts` and
   `_process_json_parts` strips code fences/whitespace, concatenates all parts,
   `json.loads` them, and validates against the response model
   (`extract_thinker/concatenation_handler.py:62-97`).
4. If parsing/validation fails, it builds continuation messages
   (assistant partial + `"## CONTINUE JSON"`) and re-requests, up to the retry
   cap, after which a `ValueError` is raised
   (`extract_thinker/concatenation_handler.py:56-60`).

Because the concatenated JSON must be syntactically valid after joining, the
handler is most reliable when the model produces a single JSON document split
across completions.

## Choosing a strategy

- `FORBIDDEN` — small documents where a truncated answer is a hard failure.
- `PAGINATE` — page-structured documents (PDFs, etc.) where each page can
  contribute partial fields and list items; it is also usable through
  `Process.extract`.
- `CONCATENATE` — documents where a single continuous JSON answer is expected but
  the model may need several completions to finish it.
