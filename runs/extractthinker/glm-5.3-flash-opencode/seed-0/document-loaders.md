---
type: document-loaders
title: Document Loaders
description: The DocumentLoader ABC contract, CachedDocumentLoader caching, the universal page output format, vision mode and PDF/URL conversion, and the catalog of concrete loaders with their configuration dataclasses.
tags: [document-loaders, pdf, ocr, vision, caching]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-720fec82995d55c9d1a2071a
    resource: repo://extract_thinker/document_loader/document_loader_azure_document_intelligence.py
  - id: openwiki-source-1a81c99f517b1ae3898560d0
    resource: repo://extract_thinker/document_loader/document_loader_data.py
  - id: openwiki-source-964e22fb6c2de60a25515dfc
    resource: repo://extract_thinker/document_loader/document_loader_llm_image.py
  - id: openwiki-source-2a00d4cc1b4c235e6fd7be9a
    resource: repo://extract_thinker/document_loader/document_loader_mistral_ocr.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Document Loaders

Document loaders turn a source (file path, `BytesIO` stream, or URL) into the page-dict list that the rest of the library consumes. They are the only component that touches file formats; everything downstream works on normalized content.

## The `DocumentLoader` ABC

`DocumentLoader` (in `extract_thinker/document_loader/document_loader.py:16-87`) defines the ingestion contract:

- **`can_handle(source)`** dispatches on source type: strings go through `_can_handle_file_path` (file must exist and its extension must be in the loader's `SUPPORTED_FORMATS`, case-insensitively); `BytesIO` streams go through `_can_handle_stream`, which sniffs the MIME type with `python-magic` and matches it against the supported formats. Any exception results in `False` — capability checks never raise (`extract_thinker/document_loader/document_loader.py:49-83`).
- **`load(source)`** is the one abstract method; it must return the loader's page representation.
- **`set_vision_mode(enabled)`** toggles `self.vision_mode`; loaders that support images attach raw image bytes to pages only when this is on.
- **`set_max_image_size(size)`** and **`set_screenshot_timeout(ms)`** tune image rendering.

Each concrete loader declares its own `SUPPORTED_FORMATS` class attribute.

## PDF, image, and URL conversion

The base class provides shared conversion machinery:

- `convert_to_images(file, scale=300/72)` renders PDFs page-by-page with `pypdfium2` into JPEG bytes keyed by page index; single images pass through unchanged (`extract_thinker/document_loader/document_loader.py:92-150`, `extract_thinker/document_loader/document_loader.py:173-190`).
- URL sources are detected with `urlparse` and handled by `_capture_screenshot_from_url`: a headless Chromium (Playwright) full-page screenshot, optionally clicking an "Accept" cookie button, waiting `screenshot_timeout` ms, then optionally resizing and splitting the tall screenshot into vertical PNG chunks of 1000px via `_split_image_vertically` (`extract_thinker/document_loader/document_loader.py:263-333`). Missing Playwright raises an `ImportError` with install instructions (`extract_thinker/document_loader/document_loader.py:248-261`).
- `_resize_if_needed` scales images down to `max_image_size` with LANCZOS resampling when configured (`extract_thinker/document_loader/document_loader.py:152-171`).
- `can_handle_paginate(source)` reports whether page-ordered splitting is possible: for paths, only the `pdf` extension; for streams, only the `application/pdf` MIME type (`extract_thinker/document_loader/document_loader.py:223-246`).

## Caching: `CachedDocumentLoader`

`CachedDocumentLoader` wraps `load()` with a `TTLCache` (default `maxsize=100`, `ttl=300` seconds). The cache key is `(source, vision_mode)` — the path string for files, `getvalue()` bytes for streams (`extract_thinker/document_loader/cached_document_loader.py:1-34`). Most concrete loaders subclass it and decorate `load()` with `cachetools.cachedmethod`, adding the vision-mode flag to the hash key (e.g. `extract_thinker/document_loader/document_loader_tesseract.py:141-144`). Consequence: toggling vision mode invalidates the cached result, but repeated loads of the same document within the TTL are free — relevant because `Process.split` and `Process.extract` each call `load()` on the same file.

## Page output format

Loaders return a list of page dicts. The minimal contract is `{"content": str}`; optional keys seen in the codebase include:

- `image` / `images` — raw image bytes when vision mode is on (`extract_thinker/document_loader/document_loader_tesseract.py:189-196`);
- `is_spreadsheet`, `sheet_name`/`name`, `data` — spreadsheet loaders mark pages so `Extractor` renders sheet data as formatted JSON instead of YAML (`extract_thinker/extractor.py:382-387`, `extract_thinker/extractor.py:1248-1249`);
- `metadata` with `num_pages` — consumed by `Extractor` for page accounting (`extract_thinker/extractor.py:309-314`).

`DocumentLoaderData` is the pass-through loader for pre-processed data in exactly this shape; it `can_handle` anything string-like, stream-like, or list/dict-shaped (`extract_thinker/document_loader/document_loader_data.py:21-43`). `Extractor` falls back to it automatically for list/dict sources, which is how split-group pages re-enter extraction without reloading (`extract_thinker/extractor.py:118-120`).

## Loader catalog

All loaders subclass `CachedDocumentLoader` and ship a config dataclass (`*Config`) with `content`, `cache_ttl`, and loader-specific fields; most validate configuration in `__post_init__` and lazily import heavy dependencies, raising actionable `ImportError`s.

| Loader | Formats | Backend / notes |
|---|---|---|
| `DocumentLoaderTesseract` | jpeg, png, bmp, tiff, pdf, jpg | Local Tesseract OCR; `TesseractConfig` validates PSM/OEM values; PDFs OCR'd in parallel with up to 4 worker threads (`extract_thinker/document_loader/document_loader_tesseract.py:20-44`, `:237-276`) |
| `DocumentLoaderPyPdf` | pdf | `pypdf` text extraction, optional password, `pypdfium2` images for vision (`extract_thinker/document_loader/document_loader_pypdf.py:10-35`) |
| `DocumentLoaderPdfPlumber` | pdf | pdfplumber text extraction |
| `DocumentLoaderSpreadSheet` | xls, xlsx, xlsm, xlsb, odf, ods, odt, csv | Emits `is_spreadsheet` pages |
| `DocumentLoaderTxt` | txt | Plain text |
| `DocumentLoaderDoc2txt` | doc, docx | `doc2txt` |
| `DocumentLoaderBeautifulSoup` | HTML formats | Web content |
| `DocumentLoaderLLMImage` | pdf, jpg, jpeg, png, tiff, bmp | Sends page images to an LLM for content generation; used as Extractor's vision fallback (`extract_thinker/extractor.py:1398-1409`) |
| `DocumentLoaderData` | any pre-processed data | Pass-through for universal page dicts |
| `DocumentLoaderAzureForm` | pdf, jpeg, jpg, png, bmp, tiff, heif, docx, xlsx, pptx, html | Azure Document Intelligence API |
| `DocumentLoaderAWSTextract` | jpeg, png, pdf, tiff | AWS Textract API |
| `DocumentLoaderGoogleDocumentAI` | various | Google Document AI API (also exported as `DocumentLoaderDocumentAI`) |
| `DocumentLoaderMarkItDown` | many | MarkItDown conversion |
| `DocumentLoaderDocling` | many | Docling conversion |
| `DocumentLoaderMistralOCR` | pdf, jpg, jpeg, png, tiff, bmp | Mistral OCR API; converts images to PDF via PIL/reportlab when needed (`extract_thinker/document_loader/document_loader_mistral_ocr.py:152-153`) |
| `DocumentLoaderEasyOCR` | png, jpg, jpeg, tiff, tif, webp, pdf | EasyOCR |

Cloud-backed loaders require their provider's credentials from the environment; the repository does not document specific variable names for each provider beyond what the loader code reads.

## Vision mode semantics

Vision mode is set by callers (`Extractor.classify` with `vision=True`, `Process.load_splitter` for `ImageSplitter`, `Extractor._handle_vision_mode`). When enabled, loaders attach page images alongside text, and `can_handle_vision` additionally accepts URLs and any stream openable as an image or PDF (`extract_thinker/document_loader/document_loader.py:192-221`). Loaders that cannot produce images simply return text-only pages, and `Extractor._map_to_universal_format` tolerates missing image keys.

## Extension seam

Adding a loader is a well-trodden path documented step-by-step in [Adding a Document Loader](guides/adding-a-document-loader.md): subclass `CachedDocumentLoader`, declare `SUPPORTED_FORMATS`, implement `load()` returning page dicts, add a config dataclass, and export the loader and config from `extract_thinker/__init__.py`.

## Related pages

- [Extractor: Extraction and Classification Engine](extractor.md)
- [Splitting Strategies and Splitters](splitting.md)
- [Markdown Conversion](markdown-conversion.md)
- [Architecture and Component Map](architecture.md)
