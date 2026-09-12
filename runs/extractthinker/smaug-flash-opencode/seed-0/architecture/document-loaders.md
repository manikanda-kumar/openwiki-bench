---
type: concept
title: Document Loaders
description: The DocumentLoader abstraction in ExtractThinker, including the base contract, caching, vision mode, format support, loader selection, and representative provider loaders.
tags: [document-loaders, OCR, pdf, vision, caching]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-497442b44f4fdc31ac3d40ab
    resource: repo://extract_thinker/document_loader/document_loader_aws_textract.py
  - id: openwiki-source-2a00d4cc1b4c235e6fd7be9a
    resource: repo://extract_thinker/document_loader/document_loader_mistral_ocr.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---

# Document Loaders

Document loaders are responsible for reading a source (file path, `BytesIO`
stream, or URL) and producing the page-based list consumed by extraction and
classification logic.

## Base contract

`DocumentLoader` (extract_thinker/document_loader/document_loader.py:16-341)
is an abstract base class. Each subclass declares `SUPPORTED_FORMATS`, an
extension list, and must implement `load(source)`.

`can_handle` (document_loader.py:49-66) resolves a source to a loader using
either the file extension (`_can_handle_file_path`, via `get_file_extension`)
or the detected MIME type for streams (`_can_handle_stream`, via `magic` and
`check_mime_type`, document_loader.py:68-82).

Shared functionality includes:

- `convert_to_images` (document_loader.py:92-150): renders PDF pages or
  images into a dict of page-index -> image bytes using pypdfium2, with
  optional resizing via `_resize_if_needed`. For URLs it takes a full-page
  screenshot with Playwright (document_loader.py:263-301) and splits tall
  images vertically (document_loader.py:303-333).
- `set_vision_mode` / `set_max_image_size` / `set_screenshot_timeout`.
- `can_handle_vision` (document_loader.py:192-221) and `can_handle_paginate`
  (document_loader.py:223-246), which checks only PDF.

## Caching and loaders

`CachedDocumentLoader` (extract_thinker/document_loader/cached_document_loader.py:7-34)
wraps `load` with a `cachetools.TTLCache` keyed on `(source, vision_mode)`.
Concrete loaders annotate their `load` with `@cachedmethod(...)` and build keys
from the source value plus `vision_mode`; Tesseract additionally TTL-caches at
the method level.

## Output shape

`load` returns a list of page dicts. Common keys:

- `content`: extracted text/markdown.
- `image`: rendered page image bytes (present when vision mode is enabled).
- `markdown`: page markdown (Docling).
- Provider-specific keys such as `tables`, `forms`, `signatures` (AWS
  Textract) or `images` (Mistral).

`Extractor._map_to_universal_format` (extractor.py:337-432) normalizes any
loader result into `{"content": str, "images": [...], "metadata": {...}}`
passed on to the LLM.

## Representative loaders

- `DocumentLoaderPyPdf` (document_loader_pypdf.py:37-156): uses pypdf for
  text and pypdfium2 for images; supports `PyPDFConfig` with password,
  cache_ttl, and `extract_text`.
- `DocumentLoaderTesseract` (document_loader_tesseract.py:87-351): runs local
  Tesseract OCR on jpeg/png/bmp/tiff/pdf, processing PDF pages in parallel
  threads; `TesseractConfig` validates psm/oem/timeout and exposes the command
  line arguments.
- `DocumentLoaderLLMImage` (document_loader_llm_image.py:44-203): fallback
  vision loader converting PDFs/images to per-page image bytes for vision LLMs,
  with optional size cap, format conversion, and JPEG compression.
- `DocumentLoaderMistralOCR` (document_loader_mistral_ocr.py:55-706): calls the
  Mistral OCR REST API, uploading files and retrieving signed URLs, and always
  runs in vision mode.
- `DocumentLoaderDocling` (document_loader_docling.py:95-356): uses Docling to
  parse many formats including Office, HTML, Markdown, images, and URLs,
  exporting per-page Markdown.
- `DocumentLoaderAWSTextract` (document_loader_aws_textract.py:62-352): uses
  AWS Textract (`detect_document_text` or `analyze_document`) with a choice of
  feature types (TABLES, FORMS, LAYOUT, SIGNATURES).

## Loader selection in Extractor

`Extractor` holds a default `document_loader` and optionally
`document_loaders_by_file_type` keyed by extension.
`get_document_loader` (extractor.py:92-126) prefers a set loader that `can_handle`
the source, then extension lookup, then iterating all registered loaders. For
list/dict sources it returns `DocumentLoaderData`, and if `allow_vision` it
falls back to `DocumentLoaderLLMImage`.
