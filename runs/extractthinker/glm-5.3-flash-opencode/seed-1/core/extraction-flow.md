---
type: core-workflow
title: Extraction Flow and Error Handling
description: The end-to-end extract() pipeline — dependency validation, loader selection, content normalization, message building, completion-strategy dispatch — plus its exception model.
tags: [extraction, error-handling, completion-strategy, universal-format]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Extraction Flow and Error Handling

`Extractor.extract(source, response_model, vision, content, completion_strategy)` (extract_thinker/extractor.py:193-335) is the primary entrypoint. Understanding the pipeline and its exception wrapping is essential before changing extraction behavior.

## Stage 0: setup and validation

- A dict source with no loader auto-installs `DocumentLoaderData` (extract_thinker/extractor.py:218-219).
- `_validate_dependencies` (extract_thinker/extractor.py:139-157) requires a document loader **unless** `vision=True`, always an LLM, and a `response_model` that subclasses `BaseModel` or `Contract`.
- `content` (extra prompt context), `completion_strategy`, and `allow_vision` are stashed on the instance — note this makes the Extractor stateful across concurrent calls to the same instance (see "Concurrency hazard" below).
- `vision=True` triggers `_handle_vision_mode`, which simply puts the existing loader into vision mode or fabricates a `DocumentLoaderLLMImage` bound to the LLM when there is none (extract_thinker/extractor.py:1398-1409); loader rejection surfaces as `InvalidVisionDocumentLoaderError` (extract_thinker/exceptions.py:9-10).

## Stage 1: load and normalize

- **List sources**: each element is loaded, mapped to the universal format, and merged. Merged text joins with a literal `--- Document Separator ---`; images are concatenated; metadata gets `num_documents`. Total page counting uses each item's `metadata['num_pages']` when present, else 1, and the count is pushed into `llm.set_page_count` (extract_thinker/extractor.py:239-316).
- **Single source**: unless `set_skip_loading(True)` was set (the splitting path reuses pre-loaded page dicts), the loader loads, `_map_to_universal_format` normalizes to `{"content", "images", "metadata"}` with `num_pages` metadata, and page count is pushed to the LLM (extract_thinker/extractor.py:290-316, 337-432).
- `_map_to_universal_format` also repairs older loader outputs (single `image` → `images` list, non-list `images` → list) and specially labels spreadsheet sheets (extract_thinker/extractor.py:356-432).

## Stage 2: dispatch

- Any non-FORBIDDEN `completion_strategy` routes to `extract_with_strategy` (page-level handlers; see the Completion Strategies page).
- Otherwise `_extract` (extract_thinker/extractor.py:1115-1147) runs LLM interceptors (`LlmInterceptor` hooks, registered via `add_interceptor` alongside `LoaderInterceptor` hooks, extract_thinker/extractor.py:61-71), builds messages, and calls `llm.request(messages, response_model)` — instructor handles both structured parsing and the retry/incomplete-output exception channel.

## Message building

- Text content is rendered via YAML (`yaml.dump`, flow style) or, for spreadsheet pages, `json_to_formatted_string` on the `data` payload, and prefixed `##Content\n\n` (extract_thinker/extractor.py:1184-1254).
- Images: `_add_images_to_message_content` walks page dicts (supporting `image`, `images`, nested dicts, raw bytes lists) and appends `image_url` parts with `data:image/jpeg;base64,...` (extract_thinker/extractor.py:1256-1330).
- `_build_messages` always emits the system line "You are a server API that receives document information and returns specific fields in JSON format." Vision mode keeps the user part as a content-part list; otherwise it is a joined string (extract_thinker/extractor.py:1332-1366).
- `content`/additional context is inserted as a second user message `##Extra Content\n\n...`, YAML-serialized if a dict (extract_thinker/extractor.py:1368-1389).

## Error handling under FORBIDDEN

The outer `try/except` in `extract` (extract_thinker/extractor.py:320-335) maps failures to an `ExtractThinkerError` family (extract_thinker/exceptions.py:1-10):

- `IncompleteOutputException` (instructor's "model output incomplete" signal) — raised directly or via `e.args[0]` unwrapping — becomes `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")`, tellingly embracing the default name.
- `ValidationError`/`JSONDecodeError` and several string-sniffed variants (`"ValidationError"`, `"JSONDecodeError"`, `"json_invalid"`) get the same wrapper. The string-sniff path is broad and best-effort; treat exact matching as unreliable.
- Vision requests wrap `litellm.BadRequestError` from `e.args[0]` into a typed vision error via `is_vision_error`/`classify_vision_error` (extract_thinker/exceptions.py:5-10, extract_thinker/extractor.py:332-333, utils vision helpers).
- Everything else is `ExtractThinkerError(f"Failed to extract from source: ...")` — note the check `vision & is_vision_error(e)` uses the bitwise `&` operator on two bools, which happens to work here but is a code smell (extract_thinker/extractor.py:332).

## Async and concurrency

- `extract_async`/`classify_async` wrap their sync counterparts via `asyncio.to_thread` (extract_thinker/extractor.py:434-462, 809-823); the sync path remains safe to call from plain scripts.
- **Concurrency hazard**: `extract` writes `self.extra_content`, `self.completion_strategy`, and `self.allow_vision` as instance state before extraction (extract_thinker/extractor.py:222-224). Sharing one `Extractor` across threads (e.g. inside `Process.extractor_groups` or `_classify_tree_async` with a shared extractor) can interleave these settings. The repository does not establish thread-safety here; treat instances as non-thread-safe or clone per concurrent task.
- `_extract_with_splitting` (extract_thinker/extractor.py:825-865) is an alternative token-budget splitter with per-chunk concurrent requests and best-effort field aggregation (`aggregate_results` keeps the first scalar value and extends lists). A repository-wide search shows it is defined but never called anywhere in the current codebase — dead code, kept for reference.

## Representative tests

- tests/test_extractor.py:17–320 covers extract, classify, vision paths, and strategies with sample documents under tests/files and tests/test_data.
- tests/test_document_loader_base.py asserts the DocumentLoader contract semantics used by the pipeline.
