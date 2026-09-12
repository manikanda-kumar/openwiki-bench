---
type: concept
title: Completion Strategies and Handlers
description: How ExtractThinker handles multi-page or long-output extraction when a single LLM completion cannot cover the whole document, through FORBIDDEN, PAGINATE, and CONCATENATE strategies.
tags: [completion, pagination, concatenation, strategies]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---

# Completion Strategies and Handlers

`CompletionStrategy` (extract_thinker/models/completion_strategy.py:4-7)
declares three strategies: `FORBIDDEN`, `PAGINATE`, and `CONCATENATE`. The
strategy is passed into `Extractor.extract` and dispatched either directly in
`_extract` (extractor.py:1132-1143) or through `extract_with_strategy`
(extractor.py:464-504). Each strategy is implemented as a `CompletionHandler`
(extract_thinker/completion_handler.py:5-27), an abstract class that owns an
`LLM` and defines a `handle` method.

## FORBIDDEN

`FORBIDDEN` is the default. A single request is made with the full content and
a `response_model`. If instructor raises `IncompleteOutputException`, or a
validation/JSON error indicates the output did not complete, `Extractor`
raises `ExtractThinkerError` with the message "Incomplete output received and
FORBIDDEN strategy is set" (extractor.py:320-335, llm.py request path). This
strategy is intentionally strict: it never retries or splits.

## PAGINATE

`PaginationHandler` (extract_thinker/pagination_handler.py:16) processes each
source page independently and in parallel via a `ThreadPoolExecutor`, then
merges the results.

Flow:

1. All fields of `response_model` are made optional so partial per-page results
   are valid (`make_all_fields_optional`, pagination_handler.py:34).
2. For each page, messages are built and an LLM request is submitted
   (pagination_handler.py:37-51). On `IncompleteOutputException`, the handler
   continues the partial JSON by adding the partial assistant content plus a
   "## CONTINUE JSON" user message (pagination_handler.py:433-468).
3. Results are merged field-by-field (pagination_handler.py:84-142). List
   fields are flattened and, when the item type is a Pydantic model, merged on
   a candidate unique key (`country`, `region`, `id`, `name`;
   pagination_handler.py:144-204). Scalar fields with a single distinct value
   are taken directly; differing scalar values are marked as a conflict
   structure.
4. Conflicts are resolved by a second LLM prompt that reconstructs each page's
   original content/images and the conflicting values and asks for a chosen
   value and confidence (pagination_handler.py:270-402).
5. The cleaned dict is validated into `response_model`
   (pagination_handler.py:135-142).

## CONCATENATE

`ConcatenationHandler` (extract_thinker/concatenation_handler.py:9) uses raw
completions to iteratively gather JSON text when a single response is truncated.

Flow:

1. Messages are built including the response-model structure in the system
   prompt (concatenation_handler.py:121-130).
2. `llm.raw_completion` is called; the returned text is validated as a JSON
   continuation (concatenation_handler.py:14-28, 41).
3. Accepted parts are appended; if JSON is still incomplete, the partial text
   is passed back as an assistant message with a "## CONTINUE JSON" user
   message, up to `max_retries = 3` (concatenation_handler.py:37-60).
4. All collected parts are cleaned of fences and concatenated, parsed as JSON,
   and validated against `response_model` (concatenation_handler.py:62-97).

## Dispatch

`_extract` builds messages from the unified content and routes to the
`PaginationHandler`, `ConcatenationHandler`, or direct `llm.request` based on
the strategy field set on the extractor (extractor.py:1132-1143).
`extract_with_strategy` is used when the caller passes a strategy directly and
routes similarly (extractor.py:464-504).
