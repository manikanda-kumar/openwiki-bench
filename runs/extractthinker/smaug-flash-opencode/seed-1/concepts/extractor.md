---
type: "Reference"
title: "Extractor and Extraction Pipeline"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
sources:
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---


# Extractor and Extraction Pipeline

`Extractor` (`extract_thinker/extractor.py:39`) is the workhorse that turns a document into a validated Pydantic `Contract`. It owns the interplay between loaders, LLMs, interceptor hooks, completion strategies, and batch processing.

## Configuration

`Extractor.__init__` holds:

- `document_loader` — primary loader.
- `document_loaders_by_file_type` — extension-keyed loaders.
- `llm` — the `LLM` wrapper.
- `loader_interceptors` / `llm_interceptors` — hook lists (`Extractor.add_interceptor` at `extract_thinker/extractor.py:61`).
- `is_classify_image` — vision classification mode flag.
- `_skip_loading` — internal flag set by `Process` to avoid double-loading split content.
- `chunk_height` (`1500`) — for URL screenshot vertical chunking.
- `allow_vision` — whether to fall back to a vision loader.

`load_document_loader` sets the primary loader; `load_llm` accepts either an `LLM` instance or a model-string that is wrapped in `LLM(...)`.

## Source resolution

`get_document_loader(source)` (`extract_thinker/extractor.py:92`) resolves a loader:

1. Primary `document_loader` if `can_handle(source)`.
2. Extension lookup in `document_loaders_by_file_type` (if it `can_handle`).
3. First registered loader that `can_handle(source)`.
4. `DocumentLoaderData()` for lists/dicts (pre-split content).
5. `DocumentLoaderLLMImage()` if `allow_vision`.
6. `None` otherwise.

`get_document_loader_for_file` (`extract_thinker/extractor.py:73`) is the classification variant — extension-first, then capability checks against the primary and all registered loaders.

## Validation

`_validate_dependencies` (`extract_thinker/extractor.py:139`) enforces:

- A document loader is present unless the request is pure vision.
- An LLM is present.
- The `response_model` is a subclass of `BaseModel` or `Contract`.

## Handling vision

`extract(...)`:

- If `vision=True`, calls `_handle_vision_mode(source)` which configures the resolved loader for vision (`set_vision_mode(True)`). If the loader does not support vision it raises `InvalidVisionDocumentLoaderError` (`extract_thinker/exceptions.py:9`).
- If `vision=False` and `source` is a list, strips image keys via `remove_images_from_content`.
- Sets `self.allow_vision = vision`.

## Universal format mapping

`_map_to_universal_format` (`extract_thinker/extractor.py:337`) normalizes loader output to:

```python
{"content": str, "images": List, "metadata": {...}}
```

Handles: page-list dicts (joins `content`, collects page `image`/`images` when vision), raw strings, legacy dicts (`text` key), and already-universal dicts.

## The extraction path

`extract(source, response_model, vision, content, completion_strategy)`:

- If `completion_strategy != FORBIDDEN`: route to `extract_with_strategy` (`extract_thinker/extractor.py:464`), which loads content and dispatches to `PaginationHandler` or `ConcatenationHandler`.
- Single source (`extract_thinker/extractor.py:291`): the loader loads, `_map_to_universal_format` normalizes, the page count is set on the LLM, then `_extract` runs. If `_skip_loading` is true (called from `Process`), it maps `source` directly without re-loading.
- List source (`extract_thinker/extractor.py:232`): each element is loaded/mapped, total pages counted (`llm.set_page_count`), text joined with `"\n\n--- Document Separator ---\n\n"`, images merged, then `_extract` runs on the combined content.

### _extract flow

`_extract` (`extract_thinker/extractor.py:1115`):

1. Runs each LLM interceptor: `interceptor.intercept(self.llm)`.
2. Builds messages with `_build_message_content(content, vision)` then `_build_messages`.
3. Prepends `extra_content` if set via `_add_extra_content`.
4. Dispatches on `completion_strategy` → `llm.request`, `PaginationHandler`, or `ConcatenationHandler`.
5. Catches `IncompleteOutputException`; under `FORBIDDEN` re-raises as `ExtractThinkerError`.

### Message building

`_build_message_content` (`extract_thinker/extractor.py:1149`):

- VISION: appends a `"##Content\n\n" + text` block and base64 `image_url` blocks for each page image (via `_add_images_to_message_content`).
- TEXT: appends `"##Content\n\n" + content_str`.

`_process_content_data` filters out image keys and formats spreadsheets as tabular JSON; `_convert_content_to_string` handles list/dict/str sources.

## Extraction with splitting

`_extract_with_splitting` (`extract_thinker/extractor.py:825`) splits content into token-budgeted chunks and runs `llm.request` on each chunk in a `ThreadPoolExecutor`, collecting results with `as_completed`; per-chunk failures are logged and yield `None`.

`split_content(content, max_tokens)` (`extract_thinker/extractor.py:867`) splits on blank lines, tracking tokens (via `num_tokens_from_string`, `extract_thinker/utils.py:168`) and chunking paragraphs that exceed the budget alone.

`aggregate_results(results, response_model)` (`extract_thinker/extractor.py:900`) merges chunk results: list fields are extended, scalar fields keep the first value on conflict, then `response_model(**aggregated_dict)`.

## Batch extraction

`extract_batch(source, response_model, vision, content, output_file_path, batch_file_path)` (`extract_thinker/extractor.py:945`):

- Requires an LLM; rejects the `PYDANTIC_AI` backend.
- Requires the model be in `BATCH_SUPPORTED_MODELS` (`extract_thinker/extractor.py:40`): `gpt-4o-mini`, `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4`. `can_handle_batch` checks by substring.
- Creates an `extract_thinker_batch/` directory (in cwd) and output/input JSONL paths (or uses provided paths; refuses to overwrite existing files).
- Generates OpenAI messages per source (`get_messages()`), handling vision via base64 `image_url`.
- Returns a `BatchJob(...)` that drives the OpenAI Batch API (see `/openwiki/operations/batch-processing.md`).

## Interceptor seams

- `LoaderInterceptor` (`extract_thinker/document_loader/loader_interceptor.py:4`): `process(file, content)`.
- `LlmInterceptor` (`extract_thinker/document_loader/llm_interceptor.py:4`): `process(messages, response)`.

LLM interceptors run before each LLM request in `_extract`. Loader interceptors are registered and available to loaders via the loader-prep path.

## Vision error classification

When extraction fails around a vision request, `Extractor.extract` calls helpers in `extract_thinker/utils.py`:

- `is_vision_error(e)` (`extract_thinker/utils.py:542`): true when the wrapped argument is a `litellm.BadRequestError`.
- `classify_vision_error(e, vision)` (`extract_thinker/utils.py:547`): if `vision` and the error is a `litellm.BadRequestError`, re-raises a `VisionError("Make sure that the model you're using supports vision features: ...")`; otherwise re-raises the original.

## Failure handling

`Extractor.extract` wraps most failures:

- Incomplete/JSON-invalid output under `FORBIDDEN` → `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")`.
- Vision errors → `VisionError` / `InvalidVisionDocumentLoaderError`.
- Other loader/LLM errors → `ExtractThinkerError(f"Failed to extract from source: ...")`.

## Async

`extract_async` (`extract_thinker/extractor.py:434`) wraps the synchronous `extract` in `asyncio.to_thread`.

## Testing

`tests/test_extractor.py` exercises vision extraction (PyPdf + gpt-4o-mini), invalid paths, FORBIDDEN-with-token-limit, pagination/concatenation handlers, LLM timeouts, default and pydantic-ai backends, URL extraction, spreadsheet extraction, multiple-source extraction, and thinking mode. `tests/test_batch_extractor.py` covers batch behavior.
