---
type: core-component
title: Extractor — Extraction and Classification Engine
description: The Extractor class — dependency validation, loader selection, vision mode, message building, the exception funnel, text/vision classification, async wrappers, interceptors, and thinking-mode controls.
tags: [extractor, extraction, classification, error-handling, interceptors]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-0272fd3963ebbd7912866173
    resource: repo://extract_thinker/document_loader/llm_interceptor.py
  - id: openwiki-source-35d2ee2f69deeb57b32d69a5
    resource: repo://extract_thinker/document_loader/loader_interceptor.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Extractor: Extraction and Classification Engine

`Extractor` (in `extract_thinker/extractor.py:39+`) is the primary user-facing orchestrator. It owns a document loader, an LLM, and the logic that turns a source document into a validated Pydantic object.

## Instance state and configuration

The constructor initializes: a primary `document_loader`, an `llm`, an empty per-extension loader registry (`document_loaders_by_file_type`), interceptor lists, `is_classify_image`, an internal `_skip_loading` flag (used by `Process` for pre-loaded content), `chunk_height=1500`, and `allow_vision` (`extract_thinker/extractor.py:47-59`). Configuration methods:

- `load_document_loader(loader)` sets the primary loader.
- `load_llm(model)` accepts either an `LLM` instance or a model string (wrapped in a new `LLM`); anything else raises `ValueError` (`extract_thinker/extractor.py:131-137`).
- `enable_thinking_mode(enable)` and `set_page_count(n)` forward to the LLM's thinking controls and return `self` for chaining; both require an LLM to be set (`extract_thinker/extractor.py:1430-1459`).

## Extraction flow

`extract(source, response_model, vision=False, content=None, completion_strategy=FORBIDDEN)`:

1. A dict source with no configured loader auto-installs `DocumentLoaderData` (`extract_thinker/extractor.py:218-219`).
2. `_validate_dependencies` requires a document loader (unless vision), an LLM, and a `BaseModel`/`Contract` response model (`extract_thinker/extractor.py:139-157`).
3. Vision mode calls `_handle_vision_mode`, which sets vision on the existing loader or creates a `DocumentLoaderLLMImage` fallback; loader ineligibility raises `InvalidVisionDocumentLoaderError` (`extract_thinker/extractor.py:226-230`, `extract_thinker/extractor.py:1398-1409`).
4. Non-`FORBIDDEN` strategies divert to `extract_with_strategy` (see [Completion Strategies](completion-strategies.md)).
5. **List sources** are loaded individually, mapped to the universal format, page-counted, merged with a `--- Document Separator ---` join and a combined image list, and extracted as one document (`extract_thinker/extractor.py:239-289`).
6. **Single sources** are loaded (unless `_skip_loading` is set, in which case the source is treated as already-universal content) and page count is pushed to the LLM (`extract_thinker/extractor.py:290-316`).
7. `_extract` builds messages and dispatches per strategy (`extract_thinker/extractor.py:1115-1147`).

`extract_async` is a thin `asyncio.to_thread` wrapper around `extract` (`extract_thinker/extractor.py:434-462`).

### Message building

`_build_messages` always emits the fixed system prompt "You are a server API that receives document information and returns specific fields in JSON format." In vision mode the user message is a multipart list (text `##Content` block plus base64 `image_url` parts collected recursively from page dicts); otherwise the content is stringified (page text joined with blank lines, spreadsheets as formatted JSON, other dicts as YAML) (`extract_thinker/extractor.py:1149-1254`, `extract_thinker/extractor.py:1332-1366`). Optional `content` becomes a `##Extra Content` message inserted at index 1 (`extract_thinker/extractor.py:1368-1389`).

### The exception funnel

The `try/except` at the end of `extract` normalizes failures (`extract_thinker/extractor.py:320-335`):

- `IncompleteOutputException` — directly or nested inside `e.args[0]` — becomes `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")`.
- `ValidationError` / `JSONDecodeError` (or errors whose string representation contains those names or `json_invalid`) are treated the same way.
- Vision errors recognized by `is_vision_error` are re-raised through `classify_vision_error(e, model)`, which produces provider-specific guidance (e.g. image-size limits) (`extract_thinker/utils.py:542-563`).
- Anything else becomes `ExtractThinkerError(f"Failed to extract from source: ...")`.

## Classification

`classify(input, classifications, vision=False)` resolves a loader via `get_document_loader_for_file` (extension map first, then primary-loader capability, then a scan of registered loaders; raising `ValueError` if none), enables vision mode when requested, loads content, and — if vision content lacks an `image` key — encodes the input file directly (`extract_thinker/extractor.py:774-807`). `classify_async` is another `asyncio.to_thread` wrapper.

`_classify` branches on `is_classify_image` (`extract_thinker/extractor.py:536-607`):

- **Text-only**: one prompt enumerates all classifications with names, descriptions, and contract structures; the LLM returns a `ClassificationResponseInternal` (name + confidence 1–10); the response name is matched case-insensitively against the list. If the LLM returns a name matching nothing, `matched_classification` stays `None` and the subsequent `matched_classification.name` access raises `AttributeError` — there is no fallback on this path.
- **Vision**: the first available page image is base64-encoded and compared against each classification one-by-one — with a reference image when `classification.image` is set, without one otherwise — and the highest-confidence response wins; if nothing scores, the fallback is `ClassificationResponse(name="Unknown", confidence=1)`.

## Batch and splitting utilities

`extract_batch` and `can_handle_batch` are covered in [Batch Processing](batch-processing.md). Two content utilities exist for oversized documents: `split_content(content, max_tokens)` splits YAML-serialized content on paragraph boundaries by token count, and `aggregate_results` merges per-chunk results (lists extended, scalars keep the first value) (`extract_thinker/extractor.py:867-943`). However, the chunked path `_extract_with_splitting` that would use them is never invoked by `extract()` — it is only reachable if called directly (`extract_thinker/extractor.py:825-865`).

## Interceptors

`add_interceptor` type-dispatches into `loader_interceptors` (`LoaderInterceptor`) or `llm_interceptors` (`LlmInterceptor`), rejecting anything else (`extract_thinker/extractor.py:61-71`). The wiring is currently incomplete:

- LLM interceptors are invoked in `_extract` via `interceptor.intercept(self.llm)`, but `LlmInterceptor`'s abstract method is `process(messages, response)` — there is no `intercept` method, so any registered LLM interceptor will raise `AttributeError` at extraction time (`extract_thinker/extractor.py:1122-1124`, `extract_thinker/document_loader/llm_interceptor.py:1-8`).
- Loader interceptors are registered but never invoked anywhere in the codebase.

Treat interceptors as an unfinished extension seam: do not rely on them without first reconciling the method names and call sites.

## Token counting and image helpers

`extract_thinker/utils.py` supplies `num_tokens_from_string` (tiktoken with a simple whitespace fallback), `encode_image` (path/BytesIO/bytes/PIL → base64), `json_to_formatted_string`, `make_all_fields_optional`, `extract_thinking_json`, and the vision-error classifiers used by the funnel (`extract_thinker/utils.py:16-26`, `extract_thinker/utils.py:126-189`, `extract_thinker/utils.py:479-563`).

## Related pages

- [Architecture and Component Map](architecture.md)
- [Document Loaders](document-loaders.md)
- [LLM Integration Layer](llm-integration.md)
- [Completion Strategies](completion-strategies.md)
- [Batch Processing](batch-processing.md)
