---
type: architecture
title: "Configuration and Failure Handling"
description: "How ExtractThinker is configured (constructor parameters, per-loader config dataclasses, the two environment variables it reads) and how failures surface (exception hierarchy, error mapping in extract(), loader retry and fallback semantics, print-based diagnostics)."
tags: [configuration, error-handling, exceptions, llm, document-loaders]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:42:30.305Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-497442b44f4fdc31ac3d40ab
    resource: repo://extract_thinker/document_loader/document_loader_aws_textract.py
  - id: openwiki-source-720fec82995d55c9d1a2071a
    resource: repo://extract_thinker/document_loader/document_loader_azure_document_intelligence.py
  - id: openwiki-source-83f922a1b667b592f2203fbd
    resource: repo://extract_thinker/document_loader/document_loader_google_document_ai.py
  - id: openwiki-source-2a00d4cc1b4c235e6fd7be9a
    resource: repo://extract_thinker/document_loader/document_loader_mistral_ocr.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-cda8ee7e415b6ecdfb133cd9
    resource: repo://extract_thinker/text_splitter.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-6f15e1b96851940c1a469907
    resource: repo://extract_thinker/warning.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Configuration and Failure Handling

## Configuration surface

ExtractThinker is a library, not a service: there is no settings file, no CLI config, and no deployment manifest in the repository. All configuration flows through constructor parameters and per-loader configuration dataclasses, and the package itself reads exactly two environment variables.

### Environment variables actually referenced by the code

| Variable | Where read | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | `BatchJob.__init__` default (`extract_thinker/batch_job.py:19`) | Authenticates the OpenAI Batch API client used by `Extractor.extract_batch` |
| `TESSERACT_PATH` | `DocumentLoaderTesseract` (`extract_thinker/document_loader/document_loader_tesseract.py:139`) | Path to the Tesseract executable; falls back to bare `tesseract` on PATH |

Provider API keys for LLM calls (OpenAI, Gemini, Groq, etc.) are consumed by the underlying `litellm` layer, not by this repository's code. The README documents `python-dotenv` usage and shows `os.environ['API_BASE']` for Ollama (`README.md:249-251`), but no library module reads `API_BASE` itself; the repository does not establish further runtime behavior for it.

### Per-loader configuration dataclasses

Each significant document loader accepts either flat constructor arguments or a dedicated config class that validates parameters in `__post_init__` and fails fast with `ValueError`:

- `TesseractConfig` validates PSM (0–13), OEM (0–3), and non-negative timeout; a list of languages is joined with `+` (`document_loader_tesseract.py:48-71`).
- `AzureConfig` validates `model_id` against fixed `GENERAL_MODELS`/`SPECIALIZED_MODELS` lists and `features` against `AVAILABLE_FEATURES` (`document_loader_azure_document_intelligence.py:84-101`).
- `GoogleDocAIConfig` requires non-empty `project_id`, `location`, `processor_id`, `credentials` and a positive-integer `page_range` if given (`document_loader_google_document_ai.py:42-53`).
- `TextractConfig`, `MistralOCRConfig`, `DoclingConfig`, `PyPDFConfig`, `PDFPlumberConfig`, `BeautifulSoupConfig`, `MarkItDownConfig`, `TxtConfig`, `Doc2txtConfig`, `EasyOCRConfig`, `LLMImageConfig`, and `DataLoaderConfig` follow the same pattern (each file defines `__post_init__` validation, e.g. `MistralOCRConfig` requires `api_key` and positive `cache_ttl`, `document_loader_mistral_ocr.py:46-52`).

Credential-style values (Azure subscription key + endpoint, AWS access key/secret/region, Google service-account JSON path or string, Mistral API key) are passed through these configs or constructor arguments — they are never read from environment variables by loader code. `DocumentLoaderAWSTextract` raises `ValueError("Either provide a textract_client or aws credentials ...")` when neither client nor credentials are supplied (`document_loader_aws_textract.py:116`).

### LLM-layer knobs and default constants

The `LLM` class carries the request-shaping configuration (`extract_thinker/llm.py:39-53`):

- `TIMEOUT = 3000` ms per request, mutable via `set_timeout()`; `tests/test_extractor.py:319-339` demonstrates forcing a timeout with `set_timeout(1)` and restoring it.
- `DEFAULT_TEMPERATURE = 0`; `set_thinking(True)` silently forces temperature to 1 (`llm.py:135-142`), so enabling thinking changes sampling behavior as a side effect.
- `token_limit` (constructor) caps `max_completion_tokens`; otherwise `DEFAULT_MAX_COMPLETION_TOKENS = 8000` applies (`llm.py:348-355`).
- Thinking budgets are computed from page count in `set_page_count`: content tokens are capped at `MAX_TOKEN_LIMIT = 120000`, thinking tokens are one third of `page_count × 1500`, clamped between `MIN_THINKING_BUDGET = 1200` and `MAX_THINKING_BUDGET = 64000` (`llm.py:155-181`). A non-positive page count raises `ValueError`.
- If thinking is enabled on a model where `litellm.supports_reasoning()` is false, the library prints a warning and proceeds without the thinking parameter (`llm.py:254-263`, `285-294`, `326-335`) — a soft degradation, not an error.
- A LiteLLM `Router` (fallbacks/rate-limit routing) is only accepted with the `DEFAULT` backend; using it with `PYDANTIC_AI` raises `ValueError` (`llm.py:121-125`).

`Extractor` exposes additional switches: `chunk_height` (default 1500 px), `allow_vision`, and the internal `set_skip_loading()` used by the split→extract pipeline (`extract_thinker/extractor.py:56-59,159-161`).

## Exception hierarchy

Three exception types are defined centrally (`extract_thinker/exceptions.py`):

```
ExtractThinkerError            # base
└── VisionError                # vision-related failure
    └── InvalidVisionDocumentLoaderError  # loader rejected vision mode
```

- `InvalidVisionDocumentLoaderError` is raised from `Extractor.extract` when `vision=True` setup fails with a `ValueError` (`extractor.py:226-230`), which in practice happens when `_handle_vision_mode` cannot use the configured loader — although note that `_handle_vision_mode` currently falls back to installing a `DocumentLoaderLLMImage` instead of raising (`extractor.py:1398-1409`), so the repository does not establish a concrete raise path for this wrapper.
- `VisionError` is raised by `utils.classify_vision_error` when a vision request fails with a `litellm.BadRequestError` (`utils.py:547-563`); `is_vision_error` detects that shape (`utils.py:542-545`).
- `ExtractThinkerError` is the general wrapper for extraction failures (next section).

## Error mapping inside `Extractor.extract`

The `try/except` block around the extraction call (`extractor.py:320-335`) defines the mapping contract for the synchronous extraction path:

1. `instructor.IncompleteOutputException` (truncated JSON from the model) → re-raised as `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")`. The same occurs for nested `IncompleteOutputException` in `e.args[0]`.
2. Pydantic `ValidationError`, `JSONDecodeError`, or exception strings containing `"json_invalid"` → also wrapped as the incomplete-output `ExtractThinkerError`, i.e. schema-invalid model output is treated as truncation.
3. With `vision=True`, `litellm.BadRequestError` instances → `classify_vision_error` converts them into a `VisionError` with a hint to verify the model supports vision.
4. Anything else → `ExtractThinkerError(f"Failed to extract from source: {str(e)}")`.

Pre-flight validation raises plain `ValueError`s, not library exceptions: missing document loader (unless vision), missing LLM, non-Pydantic response model (`extractor.py:139-157`), and "No suitable document loader found" from loader selection (`extractor.py:73-126`).

`LLM.request` with the `PYDANTIC_AI` backend wraps all agent failures as `ValueError("Failed to extract from source: ...")` (`llm.py:192-201`), losing the original exception type.

## Loader and pipeline failure semantics

- **Optional heavy dependencies fail at use time with install hints.** Loaders use lazy import guards — `_check_dependencies` / `_get_*` raise `ImportError("Could not import ... Please install it with pip install ...")` for pytesseract, boto3, azure-ai, docling, markitdown, BeautifulSoup, etc. (`document_loader_tesseract.py:148-170`, mirrored in the other loader files). This keeps `import extract_thinker` working without every optional dependency.
- **External binary verification is eager.** `DocumentLoaderTesseract` raises `ValueError("Tesseract not found at ...")` during construction when the configured executable path is not a file (`document_loader_tesseract.py:144-146`).
- **Azure retries then converts.** The Azure loader re-runs `begin_analyze_document` up to `max_retries` times and on the final failure raises `ValueError(f"Failed to process document after {n} attempts")` (`document_loader_azure_document_intelligence.py:260-264`); the AWS Textract loader similarly wraps processing errors in `ValueError` (`document_loader_aws_textract.py:204-205`).
- **Capability checks never raise.** `DocumentLoader.can_handle` (extension + `python-magic` MIME detection) and `can_handle_vision`/`can_handle_paginate` swallow all exceptions and return `False` (`document_loader/document_loader.py:49-82,192-246`), so a malformed input yields "unsupported loader" `ValueError`s at the Extractor/Process layer rather than crashing detection.
- **Process classification degrades across layers, then fails.** In `Process.classify_async`, exceptions in one extractor layer are printed (`"Layer failed with error: ..."`) and skipped (`process.py:119-122`); if no layer meets the strategy criteria, a `ValueError("No consensus could be reached ...")` is raised (`process.py:125`). Tree classification raises `ValueError` on a null result, sub-threshold confidence, or unmatched node (`process.py:156-181`).
- **Workflow guards.** `Process` raises `ValueError` for: default and per-file-type loaders both set (`process.py:31-38`), threshold outside 1–10 (`process.py:75-76,89-90`), missing splitter before `split()` (`process.py:207-208`), documents with fewer than 2 pages (`process.py:224-225`), lazy splitting on non-PDF sources (`process.py:236`), and extraction before doc-groups exist (`process.py:244-245`).
- **Splitters fall back conservatively.** If an LLM comparison throws, `ImageSplitter`/`TextSplitter` return "same document, first classification" (lazy) or a single group classified `"unknown"` (eager) rather than failing — see `image_splitter.py:107-113,215-222` and `text_splitter.py:66-72,148-154`. Silent mis-grouping is therefore possible after a transient LLM error.
- **Batch job failures.** `BatchJob` returns `None` (after printing) on upload/creation errors, which the constructor converts to `ValueError("Failed to upload file")` / `ValueError("Failed to create batch job")` (`batch_job.py:40-46,72-96`); `get_status` maps unknown or thrown API states to `"failed"` (`batch_job.py:98-125`), and `get_result` raises `ValueError` on failure status or missing output, always cleaning temp files in `finally` (`batch_job.py:127-175`).

## Print-based diagnostics

Error reporting is largely `print`-based, not logging-based: warning prints occur for unsupported thinking models, dropped classification layers, failed batch chunks/pages, and cleanup problems, and the hallucination/cost subsystems in `eval/` print status warnings while continuing (e.g. `eval/evaluator.py:109-110`, `process.py:121`). Engineers debugging pipeline behavior should capture stdout, since these signals never appear as exceptions. `warning.py` additionally suppresses the pydantic v2 "Valid config keys have changed in V2" warning globally at import time (`extract_thinker/warning.py:3-8`, invoked from `__init__.py:38`).
