---
type: core-concept
title: Extractor Core
description: The Extractor facade — dependency validation, the two loader-resolution orders, universal content mapping, extraction, classification, batch entry points, vision fallback, interceptors, and error normalization.
tags: [extractor, pipeline, vision, classification, errors]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
sources:
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# Extractor Core

`Extractor` (extract_thinker/extractor.py, ~1460 lines) is the facade most users touch: it pairs a `DocumentLoader` with an `LLM` and turns sources into validated Pydantic objects via `extract()` or `ClassificationResponse`s via `classify()`.

## State and registration

Constructor state (extractor.py:47-59): a primary `document_loader`, per-extension `document_loaders_by_file_type` map, `loader_interceptors`/`llm_interceptors` lists, `is_classify_image`, `_skip_loading`, `allow_vision`, and `chunk_height` (set to 1500 but never read elsewhere in the package). `load_document_loader` simply replaces the primary loader (extractor.py:128-129); `load_llm` accepts either an `LLM` instance or a model string and constructs one (extractor.py:131-137). `add_interceptor` sorts objects into the two lists and rejects anything else with `ValueError` (extractor.py:61-71). Only LLM interceptors ever fire — `_extract` calls `interceptor.intercept(self.llm)` (extractor.py:1122-1124); `LoaderInterceptor.process` has no call site in the package.

## Loader resolution — two different orders

- `get_document_loader(source)` (extractor.py:92-126), used by extraction: primary loader **if it `can_handle`** → extension-map entry (also `can_handle`-checked) → first registered loader that can handle → `DocumentLoaderData` for `list`/`dict` sources → `DocumentLoaderLLMImage` when `allow_vision` → else `None` (callers raise "No suitable document loader found").
- `get_document_loader_for_file(source)` (extractor.py:73-90), used by `classify`: **extension map first** (raw `.get(ext)` without a capability check, falling back to the primary loader) → primary loader if it can handle → scan of registered loaders → `ValueError` if none.

`Process` keeps its own parallel registry (`document_loader` vs `document_loaders_by_file_type`, mutually exclusive) and resolves by `get_image_type(file)` (process.py:194-199).

## Extraction path

`extract(source, response_model, vision=False, content=None, completion_strategy=FORBIDDEN)` (extractor.py:193-335):

1. A `dict` source with no primary loader auto-installs `DocumentLoaderData` (extractor.py:218-219).
2. `_validate_dependencies` (extractor.py:139-157): loader required unless `vision`; `llm` always required; response model must be Pydantic-derived. Caveat: the `Contract` name in the second `issubclass` check is never imported, so non-BaseModel classes raise `NameError` (extractor.py:156-157).
3. `vision=True` runs `_handle_vision_mode`, which enables vision on the loader or creates a `DocumentLoaderLLMImage(llm=self.llm)`; its `ValueError` is re-raised as `InvalidVisionDocumentLoaderError` (extractor.py:226-230, 1398-1409, exceptions.py:5-10). Non-vision list sources get images stripped by `remove_images_from_content` (extractor.py:232-233, 163-191).
4. Non-`FORBIDDEN` strategies jump to `extract_with_strategy` (see completion strategies page) (extractor.py:235-236).
5. **List sources** are loaded item-by-item into universal form, total pages summed from `metadata["num_pages"]` (defaulting to 1 per item), `llm.set_page_count(max(1,total))` is applied, texts are joined with `\n\n--- Document Separator ---\n\n`, images concatenated, and `content=` is prepended (extractor.py:238-289).
6. **Single sources** either map directly (when `set_skip_loading(True)` was set by `Process.extract`, extractor.py:292-294, process.py:280-291) or go through loader → `_map_to_universal_format`, then `set_page_count` from metadata (extractor.py:295-316).

`_map_to_universal_format` (extractor.py:337-432) accepts: already-universal dicts (normalizing `image`→`images`), lists of page dicts (joining `content`, appending `Sheet: <name>` for `is_spreadsheet` pages, collecting `image(s)` only when `vision`), plain strings, and legacy dicts with a `text` key (metadata becomes everything else); anything else raises `ValueError`.

`_extract` (extractor.py:1115-1147) runs LLM interceptors, builds `##Content` (+`##Extra Content` inserted after the system message via `_add_extra_content`, extractor.py:1368-1389) and image parts (base64 JPEG `image_url` blocks, extractor.py:1256-1330), and dispatches by strategy. Message shape differs by `allow_vision`: list-content messages for multimodal, joined-string content otherwise (extractor.py:1332-1366).

`extract_async` is `asyncio.to_thread(extract, ...)` (extractor.py:434-462).

### Error normalization

Failures in `extract()` become `ExtractThinkerError` (extractor.py:320-335):
- `IncompleteOutputException` (direct or nested in `e.args[0]`) → "Incomplete output received and FORBIDDEN strategy is set".
- `ValidationError`/`JSONDecodeError` (also string-matched, incl. `json_invalid`) → same message.
- Vision requests whose `e.args[0]` is a `litellm.BadRequestError` are re-thrown via `classify_vision_error` as `VisionError("Make sure that the model you're using supports vision features: ...")` (utils.py:542-563).
- Everything else → `ExtractThinkerError(f"Failed to extract from source: {e}")`.

## Classification path

`classify(input, classifications, vision=False)` (extractor.py:774-807) resolves a loader with `get_document_loader_for_file`, sets `is_classify_image`, enables loader vision mode, loads, and ensures image data. `_classify` branches (extractor.py:536-607):

- **Text-only** (`_classify_text_only`, extractor.py:722-772): one prompt enumerating every classification (name, description, plus `add_classification_structure(c)`), a deliberately quirky instruction block ("Don't use contract structure..."), and a `ClassificationResponseInternal` request; the returned name is matched case-insensitively to a `Classification`. If the model returns an unknown name, `matched_classification` stays `None` and the constructor line raises `AttributeError`.
- **Vision one-by-one** (extractor.py:555-607): uses the first `image` found in loaded content (error if none), then for each classification asks the LLM whether the document image matches, optionally including the classification's reference image (`_classify_one_image_with_ref`, extractor.py:609-675; `Classification.image` may be a path, bytes, or PIL image). The highest-confidence result wins; if nothing scored, a fallback `ClassificationResponse(name="Unknown", confidence=1)` is returned (extractor.py:600-605).

`classify_async` wraps `classify` in `asyncio.to_thread` (extractor.py:809-823).

## Batch path

`extract_batch` (extractor.py:945-1098) refuses without an LLM, under `PYDANTIC_AI`, or when `can_handle_batch()` fails — a substring check of the model name against `BATCH_SUPPORTED_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4o-2024-08-06", "gpt-4"]` (extractor.py:40-45, 1100-1113). It generates unique JSONL input/output paths under `./extract_thinker_batch` (erroring if either exists), estimates page count from the number of sources, and yields one system+user message per source (images base64-embedded for vision; text rendered with `_format_pages_to_content`, which folds spreadsheet pages into an `is_spreadsheet` dict).

## Thinking helpers

`enable_thinking_mode(enable)` requires an LLM and delegates to `llm.set_thinking` (which also pins temperature to 1); `set_page_count(n)` forwards to the LLM's budget math (extractor.py:1430-1459, llm.py:135-181).

## Legacy / unreachable code inside the class

`_extract_with_splitting`, `split_content`, and `aggregate_results` (extractor.py:825-943) implement token-based chunking with a `ThreadPoolExecutor` and first-value-wins aggregation, but no call site in the package invokes them; likewise `_build_classification_message_content` (extractor.py:506-534) and the trivial `loadfile`/`loadstream` helpers (extractor.py:1391-1396). Treat them as unused seams, not live behavior.

## Representative tests (tests/test_extractor.py)

- `test_extract_with_loader_and_vision` (L106-129): PyPdf loader + vision=True on invoice.pdf, asserting the full contract.
- `test_extract_with_invalid_file_path` (L131-141): missing file under vision surfaces as `ExtractThinkerError` wrapping "Cannot handle source".
- `test_forbidden_strategy_with_token_limit` (L143-161): truncated output under FORBIDDEN raises `ExtractThinkerError`.
- `test_extract_from_multiple_sources` (L439-473): list of PDF+URL loaded through Docling and merged into one contract, exercising the separator merge.
- `test_thinking_mode_gemini_flash` / `test_thinking_mode_gpt_mini` (L475-510): `enable_thinking_mode(True)` + `set_page_count(1)` with a raw `{'content': ...}` dict source (DocumentLoaderData path).

Note: most tests hit real provider APIs (models from `global_models.py`; `TESSERACT_PATH`, `GROQ_API_KEY` env), so offline they fail fast; CI only runs `tests/critical/`.

## Related pages

- `architecture/overview.md`, `core/document-loaders.md`, `core/llm-integration.md`, `core/completion-strategies.md`, `core/process-orchestration.md`
