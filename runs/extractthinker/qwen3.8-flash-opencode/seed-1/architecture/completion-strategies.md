---
type: subsystem
title: "Completion Strategies"
description: "How FORBIDDEN, PAGINATE, and CONCATENATE handle long structured outputs: per-page partial extraction with LLM conflict resolution, and raw-JSON continuation loops."
tags: [completion, pagination, concatenation, conflict-resolution, llm]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
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
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Completion Strategies

`CompletionStrategy` (`extract_thinker/models/completion_strategy.py`) has three members — `CONCATENATE`, `PAGINATE`, `FORBIDDEN` — and `CompletionStrategy.FORBIDDEN` is the default everywhere it appears in signatures. The abstract `CompletionHandler` (`extract_thinker/completion_handler.py`) defines one method, `handle(content, response_model, vision, extra_content)`, implemented by `PaginationHandler` and `ConcatenationHandler`.

Routing happens in `Extractor.extract`: any non-FORBIDDEN strategy returns early through `extract_with_strategy`, which loads a single source through the resolved loader (a list source is used as-is) and dispatches `PAGINATE`/`CONCATENATE` to their handlers. Because of that early return, the strategy switch inside `_extract` is only reachable with `FORBIDDEN` on the normal `extract()` path; `FORBIDDEN` issues a single `llm.request(messages, response_model)` and converts instructor's `IncompleteOutputException` into `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")` — with FORBIDDEN, a truncated answer is an error, never a partial result.

## PaginationHandler: per-page extraction + merge

`handle()` (`extract_thinker/pagination_handler.py:28-69`) works page-by-page and then merges:

1. **Partial tolerance.** The response model is transformed with `make_all_fields_optional` (`extract_thinker/utils.py:247-266`), so each page request may return a sparse object instead of failing validation.
2. **Parallel requests.** One `ThreadPoolExecutor` future per page; each `_process_page` calls `llm.request`, and an `IncompleteOutputException` triggers `_handle_partial_response`, which replays the partial JSON as an assistant message plus a `"## CONTINUE JSON"` user turn.
3. **Error swallowing.** Exceptions from completed futures are printed and dropped, so a page can simply be missing from the result set. If nothing succeeds, `handle` raises `ValueError("No valid results obtained from any page")`.
4. **Merge.** `_merge_results` collects per-field values: list-typed fields go through `_merge_list_field`, which flattens page lists and, for lists of Pydantic models, merges entries keyed by the first available of `country`, `region`, `id`, `name` (case-insensitive), deep-merging duplicates (existing non-null wins; lists extend). Scalar fields with multiple distinct non-null values are marked `{"_conflict": True, "candidates": [...]}`; string fields with no value at all default to `""`, other absent fields are dropped, and None keys are filtered before final model construction.
5. **LLM conflict resolution.** If conflicts remain, `_request_conflict_resolution` builds a prompt containing each original page's content (vision-aware when pages carry images) and every page's extracted values, then asks the LLM for a `ConflictResolution` model (`{resolved_fields: {field: {value, confidence}}}`). Failure raises `ValueError("Failed to resolve conflicts: ...")`; any conflict structure that somehow survives `_clean_merged_dict` collapses to its first candidate.

Note on pairing: results are appended in future-completion order, but `zip(content, results)` later pairs them positionally with pages for the conflict prompt, so out-of-order or dropped pages can misalign that context. The merge itself is per-field and unaffected.

## ConcatenationHandler: raw continuation loop

`handle()` (`extract_thinker/concatenation_handler.py:30-60`) builds one message set whose system prompt embeds `add_classification_structure(response_model)` (the field-by-field schema description also used in classification), then loops on `llm.raw_completion` — no instructor validation per turn:

- A reply is accepted only if `_is_valid_json_continuation` sees JSON markers (` ```json `, `{`, or `[`).
- `_process_json_parts` strips code fences and newlines from every collected part, concatenates them, and requires the result to `json.loads` and `response_model.model_validate` cleanly.
- Any failure path retries up to `max_retries = 3`: invalid-continuation replies retry the same messages, parse failures append the partial JSON as an assistant turn and request `"## CONTINUE JSON"`, exceeding the limit raises `ValueError("Maximum retries reached ...")`.

So CONCATENATE trades instructor's per-request schema enforcement for one final `model_validate` over the stitched-together answer — useful when the output legitimately exceeds one completion window.

## Choosing a strategy

`FORBIDDEN` for single-request documents, `PAGINATE` when per-page extraction plus cross-page merging (lists, conflict arbitration) fits the contract, `CONCATENATE` when one huge JSON is expected. See [Tuning Extraction Quality](/openwiki/guides/tuning-extraction-quality.md) for the accuracy/cost consequences, and [Extractor Core](/openwiki/architecture/extractor.md) for where routing happens.
