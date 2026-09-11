---
type: "Reference"
title: "Extraction Pipeline"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:16:41.841Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-0272fd3963ebbd7912866173
    resource: repo://extract_thinker/document_loader/llm_interceptor.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
generated: { by: "opencode", at: "2026-09-11T09:16:41.841Z" }
---


# Extraction Pipeline

The `Extractor` (`extract_thinker/extractor.py`) orchestrates the whole pipeline: document loaders produce raw content, the extractor normalizes it to a **universal content format**, builds prompt messages, and calls the `LLM` to get a Pydantic-validated response. It also hosts `classify`, `extract_batch`, interceptor hooks, and the completion strategies.

## Dependencies and configuration

An `Extractor` is configured with `load_document_loader(DocumentLoader)` and `load_llm(model_string_or_LLM)`. `_validate_dependencies` enforces that a document loader exists (unless `vision=True`) and an LLM is set, and that `response_model` is a `BaseModel`/`Contract` subclass — otherwise `ValueError`.

Loader resolution (`get_document_loader`) prefers an explicitly loaded loader that `can_handle` the source, then an extension-based lookup in `document_loaders_by_file_type`, then any registered loader capable of the source, then `DocumentLoaderData` for list/dict sources, and finally `DocumentLoaderLLMImage` when `allow_vision` is enabled. A list of sources passed from splitting routes to `DocumentLoaderData`.

## The universal content format

`_map_to_universal_format` normalizes whatever a loader returns into:

```json
{ "content": "<joined text>", "images": [bytes...], "metadata": {"num_pages": N} }
```

- A list of page dicts is joined page-by-page into `content` and, in vision mode, image bytes are collected (`images`); `num_pages` is recorded.
- Strings are wrapped as-is; legacy dicts keep non-text fields as metadata.
- Already-universal dicts are passed through, with single `image` merged into `images`.

This is the shape handed to `_build_message_content`/`_extract`, and it is what the pagination handler also consumes per page.

## The extract flow

`extract(source, response_model, vision, content, completion_strategy=FORBIDDEN)`:

1. Validates dependencies and stores `extra_content`, `completion_strategy`, and `allow_vision`.
2. **Vision mode** — `_handle_vision_mode` enables vision on the loaded loader or, if none is loaded, creates a `DocumentLoaderLLMImage` fallback. If vision setup raises `ValueError`, it is re-raised as `InvalidVisionDocumentLoaderError`. Non-vision list sources are stripped of `images`/`image` keys.
3. If `completion_strategy != FORBIDDEN`, it delegates to `extract_with_strategy` (PAGINATE → `PaginationHandler`, CONCATENATE → `ConcatenationHandler`).
4. Otherwise, for a **list** source each item is loaded and merged: texts joined with `--- Document Separator ---`, images concatenated, page count set on the LLM, optional `content` prepended. For a **single** source the loader is resolved and loaded (unless `_skip_loading` is set, in which case the already-processed source is passed through).
5. The page count is propagated to the LLM (`llm.set_page_count`) for token budgeting.
6. `_extract` runs `llm_interceptors`, builds messages, optionally injects `extra_content` as a second user message, and dispatches on the completion strategy — `FORBIDDEN` calls `self.llm.request(messages, response_model)` directly.

`extract_async` runs the whole synchronous flow in a worker thread via `asyncio.to_thread`.

### Message construction

`_build_message_content` produces a text block (`##Content\n\n...`) for non-vision, or for vision mode a text block plus `image_url` content items built from the collected image bytes (base64 `data:image/jpeg;base64,...`). `_build_messages` wraps this with the system prompt "You are a server API that receives document information and returns specific fields in JSON format."

### Error handling

The `extract` path converts failures into a small exception surface (`extract_thinker/exceptions.py`):

- `IncompleteOutputException` (from instructor), `ValidationError`, `JSONDecodeError`, and `json_invalid`-style messages all become `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")` — the hallmark of truncation when the strategy forbids continuation.
- Vision errors: `is_vision_error` detects `litellm.BadRequestError`; when vision is enabled, `classify_vision_error` re-raises as `VisionError` telling the caller the model likely lacks vision support.
- Anything else becomes `ExtractThinkerError("Failed to extract from source: ...")`.

## Completion strategies

`CompletionStrategy` (`extract_thinker/models/completion_strategy.py`) offers `FORBIDDEN`, `PAGINATE`, and `CONCATENATE`. `CompletionHandler` (`extract_thinker/completion_handler.py`) is the ABC both handlers implement.

### PaginationHandler

`PaginationHandler` (`extract_thinker/pagination_handler.py`) is for long/multi-page documents:

1. Makes every field of the response model optional (`make_all_fields_optional`) so partial per-page results are valid.
2. Builds one message set per page (text and/or vision) and processes all pages in parallel with a `ThreadPoolExecutor`, continuing truncated pages via `_handle_partial_response` (appending the partial assistant output plus `## CONTINUE JSON`).
3. `_merge_results` merges per-field values: list fields are merged (deduped by a unique key like `country`/`region`/`id`/`name` when items are Pydantic models), scalar fields keep a single distinct value, and conflicting scalars are flagged with `{"_conflict": True, "candidates": [...]}`.
4. Conflicts are resolved by a second LLM call (`ConflictResolution` model) whose prompt includes every contributing page's content and extracted values (with images for vision pages).
5. The cleaned dict is instantiated into the original (required-field) response model.

If every page fails, it raises `ValueError("No valid results obtained from any page")`.

### ConcatenationHandler

`ConcatenationHandler` (`extract_thinker/concatenation_handler.py`) is for very long single documents whose JSON output is truncated:

1. Builds a system prompt embedding the contract structure via `add_classification_structure`.
2. Calls `llm.raw_completion` (raw text, no response model) and validates the response contains JSON markers (`{`, `[`, or a ```json fence) — invalid responses retry up to 3 times.
3. On truncation it continues with `## CONTINUE JSON` assistant messages, collecting `json_parts`.
4. Cleans and concatenates the parts, `json.loads` them, and validates the result against the response model.

## Batch processing

`extract_batch(source, response_model, vision, content, output_file_path, batch_file_path)` generates per-source messages (document text or base64 images) and creates a `BatchJob` (`extract_thinker/batch_job.py`) that talks to the **OpenAI Batch API**:

- Only the DEFAULT backend and models in `BATCH_SUPPORTED_MODELS` (`gpt-4o-mini`, `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4`) are allowed; unsupported setups raise `ValueError`.
- The instructor batch input is rewritten into OpenAI's JSONL request format (`custom_id`, `method=POST`, `/v1/chat/completions` body with `tools`/`tool_choice`), uploaded via `client.files.create`, and submitted via `client.batches.create` with a 24h completion window.
- `get_status` maps OpenAI statuses to `queued`/`processing`/`completed`/`failed`; `get_result` polls every 60s, downloads the output file, parses it with instructor, returns the first parsed result, and cleans up the temp JSONL files (also on `cancel` and object destruction).

## Interceptor extension seams

`Extractor.add_interceptor` accepts `LoaderInterceptor` (hooks `process(file, content)` — but note the `Extractor` currently calls interceptors only around the LLM call, `LlmInterceptor.intercept(self.llm)` in `_extract`) or `LlmInterceptor`. The interceptor lists are initialized in the constructor and validated by type.

## Representative tests

- `tests/test_extractor.py` — text and vision extraction with PyPdf/Tesseract loaders, multi-source lists, charts, spreadsheet contracts, completion strategies, and error assertions.
- `tests/test_batch_extractor.py` — batch creation, status polling, result retrieval, and cancellation with file cleanup.
- `tests/critical/test_critical_extraction.py` — end-to-end extraction assertions.
