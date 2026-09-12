---
type: guide
title: Changing Extraction or Completion Behavior
description: A focused maintenance guide for modifying how ExtractThinker builds messages, selects document loaders, or handles completion strategies.
tags: [guide, extraction, completion, extension]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---

# Changing Extraction or Completion Behavior

This guide points at the key extension seams in `Extractor` and the completion
handlers, so you can change how extraction and completion behave without
rewriting the library.

## Loader selection

`Extractor.get_document_loader` (extract_thinker/extractor.py:92-126) decides
the loader for a source. Criteria order:

1. A set default loader that `can_handle` the source.
2. For string sources, an extension-keyed lookup in `document_loaders_by_file_type`.
3. Iterating all registered loaders.
4. `DocumentLoaderData` for list/dict sources.
5. `DocumentLoaderLLMImage` when `allow_vision` is set.

To change loader resolution (e.g. custom routing, priority, or a new fallback),
modify this method. Note `get_document_loader_for_file` (extractor.py:73-90) is
a separate, extension-preference variant used by `classify`.

## Message construction

Messages are built in `_build_message_content` (extractor.py:1149-1182),
`_build_messages` (extractor.py:1332-1366), and `_add_extra_content`
(extractor.py:1368-1390). Vision mode produces a list of text + base64
`image_url` blocks; non-vision joins string blocks. Spreadsheet dicts are
formatted via `json_to_formatted_string`; other dicts are YAML-dumped
(extractor.py:1224-1254). To change the system prompt, the `##Content` /
`##Extra Content` markers, or how content is serialized, edit these methods.
`MarkdownConverter` duplicates much of this logic separately.

## Completion strategy dispatch

`_extract` dispatches on `self.completion_strategy` (extractor.py:1132-1143):
`FORBIDDEN` calls `llm.request` directly, `PAGINATE` delegates to
`PaginationHandler`, and `CONCATENATE` to `ConcatenationHandler`. The
`CompletionHandler` abstract base (extract_thinker/completion_handler.py:5-27)
is the seam for adding a new strategy: implement `handle(content,
response_model, vision, extra_content)`, then wire it into the dispatch and
into `CompletionStrategy`.

When adding behavior with retries or chunking within the default forbidden
path, be aware that `Extractor.extract` re-raises `IncompleteOutputException`
and validation/JSON errors as `ExtractThinkerError` (extractor.py:320-335).

## Conflict resolution in pagination

`PaginationHandler` merges per-page results and identifies conflicting scalar
values, then resolves them with a second LLM prompt
(extraction flow, pagination_handler.py:270-402). The list-field merge key
heuristic (`country`, `region`, `id`, `name`) and the system prompt for
conflict resolution are the mutable seams here.

## Affected tests

After changing extraction/completion behavior, run the relevant tests in
`tests/` — the completion strategies are exercised by `test_pagination_handler`,
`test_pagination_handler_optional`, and `test_concatenation_handler` in
`tests/test_extractor.py`.
