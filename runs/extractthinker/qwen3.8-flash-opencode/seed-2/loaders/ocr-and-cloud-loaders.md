---
type: integration
title: "OCR and Cloud Loaders"
description: "OCR engines and cloud document-analysis loaders: Tesseract and EasyOCR local OCR, DocumentLoaderLLMImage as the vision fallback, and Azure Document Intelligence, AWS Textract, Google Document AI, Mistral OCR — credentials, config validation, retry behavior, and per-page output shapes."
tags: [ocr, azure, aws-textract, google-document-ai, mistral, vision-loaders]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-497442b44f4fdc31ac3d40ab
    resource: repo://extract_thinker/document_loader/document_loader_aws_textract.py
  - id: openwiki-source-720fec82995d55c9d1a2071a
    resource: repo://extract_thinker/document_loader/document_loader_azure_document_intelligence.py
  - id: openwiki-source-2dbe57a9da9f58355d6f6edf
    resource: repo://extract_thinker/document_loader/document_loader_easy_ocr.py
  - id: openwiki-source-83f922a1b667b592f2203fbd
    resource: repo://extract_thinker/document_loader/document_loader_google_document_ai.py
  - id: openwiki-source-964e22fb6c2de60a25515dfc
    resource: repo://extract_thinker/document_loader/document_loader_llm_image.py
  - id: openwiki-source-2a00d4cc1b4c235e6fd7be9a
    resource: repo://extract_thinker/document_loader/document_loader_mistral_ocr.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# OCR and Cloud Loaders

These loaders add text and structure recognition beyond what PDF text layers provide. All inherit the framework contract (page dicts, `can_handle`, TTL cache) from the loader-framework page; this page covers what each one requires and returns.

## Local OCR

### `DocumentLoaderTesseract` (`document_loader_tesseract.py`)

- **Engine**: the external Tesseract binary via `pytesseract`. `tesseract_cmd` (or `TesseractConfig`) defaults to `TESSERACT_PATH` env then PATH lookup; a missing executable is a construction-time `ValueError` (`document_loader_tesseract.py:87-146`). Formats: jpeg/png/bmp/tiff/pdf/jpg (`:90`).
- **Tuning** via `TesseractConfig`: `lang` (list joined with `+`), `psm`, `oem` (validated sets), extra `config_params` rendered as `-c key=value`, and a per-call `timeout` (`:17-85`).
- **Flow**: single images OCR directly (text page dict, raw bytes attached as `image` when `vision_mode`); PDFs are rasterized with the base `convert_to_images` and OCR'd by up to **4 worker threads** over a queue, results sorted by page number back into page dicts (`:172-320`). A worker's OCR exception becomes that page's `"content"` (`str(e)`), not a failure of the run (`:316-318`).

### `DocumentLoaderEasyOCR` (`document_loader_easy_ocr.py`)

- Takes an `EasyOCRConfig` (holds an initialized `easyocr.Reader`; `include_bbox` toggle) and manages its own `TTLCache(maxsize=128)` (`easy_ocr.py:18-69`).
- `can_handle` is relaxed: any `BytesIO` passes; paths match by raw extension against png/jpg/jpeg/tiff/tif/webp/pdf (`:70-88`).
- Output pages carry `content` (all readtext boxes joined with spaces) and a `detail` list of `{bbox, text, probability}` when `include_bbox` is set; PDFs go through page rasterization and parallel workers like Tesseract, errors wrapped in `ValueError` (`:90-224`).

### `DocumentLoaderLLMImage` (`document_loader_llm_image.py`)

- The Extractor's vision fallback: `vision_mode` forced `True` at construction; formats pdf/jpg/jpeg/png/tiff/bmp (`llm_image.py:44-86,197-202`).
- It does **not** OCR by itself: `load()` renders pages to processed images — optionally format-converted/compressed/resized to `max_image_size` through PIL with iterative quality reduction, falling back to the original bytes on any processing error — so a vision-capable LLM downstream reads them (`:88-135`). An `llm` reference may be stored via config but the load path uses it only for that purpose.

## Cloud document AI

### `DocumentLoaderAzureForm` — Azure Document Intelligence (`document_loader_azure_document_intelligence.py`)

- Credentials: `subscription_key` + `endpoint` (or an `AzureConfig`), also constructible via `from_credentials` (`:134-213`). Formats span pdf/images/office/html (`:137`).
- `AzureConfig.model_id` must be in the pinned `GENERAL_MODELS`/`SPECIALIZED_MODELS` lists (default `prebuilt-layout`); `features` must be in `AVAILABLE_FEATURES` (`ocrHighResolution`, `formulas`, `styleFont`, `barcodes`, `languages`, ...) (`:38-101`).
- `load()` runs `begin_analyze_document` with retry up to `max_retries` (final failure → `ValueError`) and emits pages with: `content` = page lines minus those duplicated in tables, `tables` (built via `build_tables`), `forms` from key-value pairs assigned by bounding-region page number, feature-gated `formulas`/`fonts`/`barcodes`/`languages`, and `image` in vision mode using Azure's 1-based page mapping (`:215-390`).

### `DocumentLoaderAWSTextract` (`document_loader_aws_textract.py`)

- Credentials: `aws_access_key_id`/`secret`/`region_name`, or a pre-built `textract_client` (also `from_client`); missing both raises `ValueError` (`:67-117`). Formats: jpeg/png/pdf/tiff (`:65`).
- `TextractConfig.feature_types` is validated against `TABLES/FORMS/LAYOUT/SIGNATURES`; an empty list means raw text — the loader then calls `detect_document_text` with `["DOCUMENT"]` semantics instead of `analyze_document` (`:25-60`, `api_feature_types`).
- Both PDFs and images are analyzed **synchronously** in-memory (`Document={'Bytes': ...}`) with `max_retries` retry loops that raise `ValueError("Failed to process PDF after N attempts")` (`:207-245`) — the code does not use Textract's async `StartDocumentAnalysis` jobs.
- Output pages: `content` (lines joined), `tables` (all tables repeated on every page dict), `forms`/`signatures` keyed per page, `image` in vision mode (`:151-205`).

### `DocumentLoaderGoogleDocumentAI` (`document_loader_google_document_ai.py`)

- `GoogleDocAIConfig` requires `project_id`, `location`, `processor_id`, and `credentials` (service-account JSON path or string; parsed at client creation) plus optional `processor_version`, `enable_native_pdf_parsing`, `page_range` (`:15-124,149-185`). `DocumentLoaderDocumentAI` is a thin alias subclass (`:288-295`).
- `load()` calls `process_document` with the raw bytes and guessed MIME (paths via `mimetypes`; streams fall back to `application/pdf` when the stream has no `name`) and returns per-page `content` (full text of the page's layout), `tables` (header+body rows), `forms`, `key_value_pairs` when the processor emits them, and `image` in vision mode (`:194-243`).

### `DocumentLoaderMistralOCR` (`document_loader_mistral_ocr.py`)

- `MistralOCRConfig(api_key=..., model="mistral-ocr-latest", pages, image_limit, image_min_size, include_image_base64, allow_image_recursive)`; the loader sets `vision_mode = True` unconditionally and posts to `https://api.mistral.ai/v1/ocr` with a Bearer token (`:22-70,533-556`).
- Image sources are converted to PDF before upload (`_convert_image_to_pdf`) and files are first uploaded to obtain a URL (`_upload_file_to_mistral`, `_get_signed_url`) (`:101-391`).
- Output pages carry `content` in **Markdown**, `page_index`, `dimensions` when provided, and `image` bytes from local rasterization (skipped for URL sources); when `allow_image_recursive` is set, embedded base64 images are extracted, processed, and their `![id](id)` markers in the markdown are replaced with `[Image content: ...]` text, with per-image failures printed and skipped (`:533-655`).

## Selection implications

`Extractor` reaches these loaders only through the primary/registry/can_handle order; cloud loaders' credentials are constructor arguments, so failures (bad key, unreachable service) surface at `load()` time as `ValueError` wrappers or provider SDK errors mapped by each loader's retry loop. Vision paths (`Extractor.extract(vision=True)`, `ImageSplitter`, `MarkdownConverter`) depend on the `image`/`images` keys documented above — EasyOCR notably never attaches page images, and `to_markdown_structured`'s image requirement means EasyOCR-loaded sources cannot feed it (`document_loader_easy_ocr.py:90-131`; see markdown-conversion page).
