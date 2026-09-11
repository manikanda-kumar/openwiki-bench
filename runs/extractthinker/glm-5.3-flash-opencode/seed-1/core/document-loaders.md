---
type: core-mechanism
title: Document Loaders
description: The DocumentLoader abstraction — capability probing, per-page normalized output, vision mode, caching — and the catalog of concrete loaders for PDFs, images, OCR services, and web content.
tags: [document-loader, ocr, pdf, vision, caching, ttlcache]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
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
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Document Loaders

Loaders are the only components that touch raw document bytes. Each turns a file path or `BytesIO` stream into content `Extractor` can prompt with.

## The DocumentLoader contract

`DocumentLoader` (extract_thinker/document_loader/document_loader.py:16-341) is an abstract base enforcing:

- **Capability probing**: `can_handle(source)` dispatches to `_can_handle_file_path` (extension membership in the loader's `SUPPORTED_FORMATS`) or `_can_handle_stream` (python-magic MIME sniffing; stream position is reset afterwards). Any internal exception means "cannot handle" (extract_thinker/document_loader/document_loader.py:49-83). `can_handle_vision` is lenient — URLs, PDF, and common image extensions (extract_thinker/document_loader/document_loader.py:192-221); `can_handle_paginate` returns true only for PDFs, by extension or MIME check (extract_thinker/document_loader/document_loader.py:223-246).
- **`load(source)`** — the one abstract method; output shape is loader-specific but conventionally a list of per-page dicts with `"content"` strings and optional `"image"` bytes in vision mode.
- **Conversion utilities** shared by loaders: `convert_to_images` renders PDFs via pypdfium2 at scale 300/72, handles URL sources by taking a full-page Playwright screenshot (split into 1000px vertical chunks all labeled page 0), and single images pass through as page 0 (extract_thinker/document_loader/document_loader.py:92-190). Images are optionally resized to `max_image_size` with LANCZOS resampling and JPEG-optimized.
- **Config knobs**: `set_vision_mode`, `set_max_image_size`, `set_screenshot_timeout`; a `TTLCache(maxsize=100, ttl=cache_ttl)` instance is created in the base constructor (extract_thinker/document_loader/document_loader.py:21-47), though the base class itself does not use it in `load`.

## CachedDocumentLoader

`CachedDocumentLoader` (extract_thinker/document_loader/cached_document_loader.py:7-34) implements explicit cache-key handling: `(source-string, vision_mode)` for paths and `(stream bytes, vision_mode)` for streams, returning a TTL hit or caching a miss. Concrete loaders generally bypass this by decorating `load` directly with `cachetools.cachedmethod` keyed on the source string/bytes **and** `self.vision_mode` (for example extract_thinker/document_loader/document_loader_pypdf.py:104-105 and document_loader_tesseract.py:170-171), so a cache entry from a non-vision load is never reused in vision mode.

Important caveat: since `vision_mode` participates in the key but `set_vision_mode` mutates state, a loader cached before vision got enabled re-executes with vision on — the caching protects repeat loads only within the same mode. Cache TTL defaults to 300 seconds, validated as positive by loader configs.

## Config pattern

Every concrete loader pairs a `@dataclass` Config with dual-mode construction (a `XConfig` object or legacy keyword args) and `__post_init__` validation. Examples: `PyPDFConfig` (cache_ttl, password for encrypted PDFs, extract_text, vision_enabled with `__post_init__` validation, extract_thinker/document_loader/document_loader_pypdf.py:11-35) and `TesseractConfig` (tesseract_cmd required; lang joined with `+` for multi-language; PSM 0–13 and OEM 0–3 validated; non-negative timeout; extract_thinker/document_loader/document_loader_tesseract.py:16-84). Dependency checks (`pip install pypdf`, `pip install pytesseract`, playwright, etc. as applicable) run at construction time and raise `ImportError` with the exact pip command.

## Catalog at a glance

| Loader | Formats | Parsing approach |
|---|---|---|
| `DocumentLoaderPyPdf` | pdf | `pypdf` text extraction; pypdfium2 renders page images in vision mode; password support |
| `DocumentLoaderPdfPlumber` | pdf | pdfplumber |
| `DocumentLoaderTesseract` | jpeg/png/bmp/tiff/pdf/jpg | pytesseract OCR; PDFs first rendered to images then OCR'd in parallel (`_process_images_parallel` with a per-message thread pool) |
| `DocumentLoaderEasyOCR` | images | easyocr models (locally downloaded) |
| `DocumentLoaderAWS Textract` (`TextractConfig`) | pdf/images | AWS Textract API (own auth/limits, not established here) |
| `DocumentLoaderAzureForm` | pdf/images | Azure Document Intelligence API |
| `DocumentLoaderGoogleDocumentAI` | pdf | Google Document AI, with file-output processing modes |
| `DocumentLoaderMistralOCR` | pdf/images | Mistral OCR API |
| `DocumentLoaderDocling`, `DocumentLoaderMarkItDown` | many | document converters |
| `DocumentLoaderBeautifulSoup` | html/urls | HTML scraping |
| `DocumentLoaderTxt`, `DocumentLoaderDoc2txt` | txt/doc | text tools |
| `DocumentLoaderSpreadsheet` | xls/xlsx/csv | sheet-by-sheet pages, `is_spreadsheet: True` plus `data` (extractor renders them via `json_to_formatted_string`) |
| `DocumentLoaderLLMImage` | vision sources | contributes raw images to vision LLM payloads |
| `DocumentLoaderData` | python dict/list | wraps in-memory structured payloads, used after splitting |

Definitive per-loader formats live in each module's `SUPPORTED_FORMATS` (for example pypdf restricts to `['pdf']`, extract_thinker/document_loader/document_loader_pypdf.py:39); the table is a navigation aid, not authority — verify there before relying on a specific combination.

## Failure behavior

- All handlers wrap processing failures in `ValueError` with the underlying message (pypdf.py:151-152, tesseract.py:206-207), keeping loader errors uniform across the dispatch layer.
- `Extractor` treats "no suitable loader" as `ValueError` too, so an unmatched extension surfaces as a single error type regardless of which layer misses.
- Stream-based `can_handle`/`can_handle_paginate` always `seek(0)` after sniffing to keep the load path safe, but loaders themselves still re-`seek(0)` defensively.

## Service-loader caveat

Cloud-OCR loaders (AWS, Azure, Google, Mistral) perform their own network calls and credential lookups. The repository establishes their input formats and page output shapes but the exact runtime behavior under throttling/timeout is loader-specific and not additionally wrapped by ExtractThinker — confirm with the per-loader module and its test file before relying on retry guarantees.
