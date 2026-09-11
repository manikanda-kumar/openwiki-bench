---
type: "Reference"
title: "Change Guide: Debugging Extraction"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:16:41.841Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T09:16:41.841Z" }
---


# Change Guide: Debugging Extraction

This guide maps the failure modes an `Extractor.extract` call can produce (`extract_thinker/extractor.py`) to their root causes and the fix for each. All of them surface either as `ValueError` (misconfiguration, resolved before any LLM call) or as the exceptions defined in `extract_thinker/exceptions.py`.

## Failure mode 1: missing dependencies (ValueError)

`_validate_dependencies` (`extract_thinker/extractor.py:139`) raises `ValueError` before any I/O when:

- `"Document loader is not set..."` — you called `extract` with `vision=False` and never called `load_document_loader`.
- `"LLM is not set..."` — you never called `load_llm` (or passed a `None` model to `load_llm`, which itself raises `ValueError`).
- `"response_model must be a subclass of Pydantic's BaseModel or Contract"` — the response type is not a Pydantic model.

**Fix:** configure both `load_document_loader(...)` and `load_llm(...)` and pass a `Contract`/`BaseModel` subclass.

## Failure mode 2: no suitable loader (ValueError)

`get_document_loader` returns `None` (and `extract` raises `"No suitable document loader found for the input."`) when the loaded loader cannot handle the source, no extension-based loader matches, and the source isn't a list/dict (which routes to `DocumentLoaderData`). `get_document_loader_for_file` raises `ValueError` the same way.

**Fix:** load a loader whose `SUPPORTED_FORMATS` covers the file extension, or register one via `document_loaders_by_file_type` / `set_document_loader_for_file_type`. Loaders reject unhandled sources internally too, e.g. `DocumentLoaderPyPdf.load` raises `ValueError("Cannot handle source: ...")`, which the `Extractor` wraps into `ExtractThinkerError("Failed to extract from source: Cannot handle source ...")` — asserted in `test_extract_with_invalid_file_path`.

## Failure mode 3: vision problems

When `extract(..., vision=True)`:

- `_handle_vision_mode` raises and the `Extractor` re-raises `InvalidVisionDocumentLoaderError` if the loaded loader cannot be put into vision mode.
- If the LLM rejects the image payload, the underlying `litellm.BadRequestError` is detected by `is_vision_error` and re-raised as `VisionError("Make sure that the model you're using supports vision features: ...")` by `classify_vision_error` (`extract_thinker/utils.py`). Without vision, the original exception propagates.

**Fix:** use a vision-capable loader (e.g. `DocumentLoaderPyPdf` in vision mode, `DocumentLoaderLLMImage`, or a loader whose `can_handle_vision` returns True) and a multimodal model. Note `DocumentLoaderLLMImage` is auto-created as a fallback when no loader is set and vision is enabled.

## Failure mode 4: incomplete output under FORBIDDEN

The default `completion_strategy` is `CompletionStrategy.FORBIDDEN`, meaning the extractor **must not** continue a truncated LLM response. If the model runs out of output tokens, instructor raises `IncompleteOutputException`; the `Extractor` normalizes this (plus `ValidationError` and `JSONDecodeError`) into:

```
ExtractThinkerError: Incomplete output received and FORBIDDEN strategy is set
```

This is the classic **truncation** failure for long documents, and `test_forbidden_strategy_with_token_limit` reproduces it by forcing a tiny `token_limit=10`.

**Fix:** pass a `completion_strategy` that recovers partial output:

- `CompletionStrategy.PAGINATE` → `PaginationHandler` (`extract_thinker/pagination_handler.py`) processes each page in parallel, continues truncated pages with a `## CONTINUE JSON` prompt, merges per-field results, and uses a second LLM call to resolve scalar conflicts.
- `CompletionStrategy.CONCATENATE` → `ConcatenationHandler` (`extract_thinker/concatenation_handler.py`) collects raw JSON continuations (up to 3 retries on invalid JSON), concatenates them, and validates the result.

The pagination handler is exercised by `test_pagination_handler` against the multi-page `Regional_GDP_per_capita_2018_2.pdf`; concatenation against long single documents.

## Failure mode 5: config-adjacent errors from the LLM adapter

- `LLM.load_router` raises `ValueError("Router is only supported with LITELLM backend")` on `PYDANTIC_AI`.
- `extract_batch` raises `ValueError` for the `PYDANTIC_AI` backend or any model outside `BATCH_SUPPORTED_MODELS` (`gpt-4o-mini`, `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4`).
- `BatchJob` raises `ValueError("Failed to upload file")` / `"Failed to create batch job"` / `"Batch job failed"` on API failures, and cleans up its JSONL files on completion, cancellation, and destruction.

## Debugging workflow

1. Reproduce with the exact source and `vision` flag; the message distinguishes config (`ValueError` before I/O), loader (`No suitable document loader` / `Cannot handle source`), vision (`VisionError`/`InvalidVisionDocumentLoaderError`), and truncation (`Incomplete output received and FORBIDDEN strategy is set`).
2. For truncation, retry with `CompletionStrategy.PAGINATE`, then `CONCATENATE`, or raise the model's `token_limit`.
3. Check `llm.raw_completion`/interceptor hooks for the exact prompt when a specific field extraction is wrong.

## Representative tests

- `tests/test_extractor.py` — `test_extract_with_invalid_file_path` (loader failure), `test_forbidden_strategy_with_token_limit` (truncation), `test_pagination_handler` (recovery).
- `tests/critical/test_critical_extraction.py` — end-to-end extraction smoke tests.
- `tests/test_batch_extractor.py` — batch API failure paths and cleanup.
