---
type: core-concept
title: Document Loaders
description: The DocumentLoader abstraction — capability detection, vision rasterization, URL screenshots, TTL caching, config dataclasses — and the concrete loader family (OCR, PDF, cloud, web, spreadsheet, data).
tags: [document-loader, ocr, pdf, vision, caching, integrations]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
sources:
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-497442b44f4fdc31ac3d40ab
    resource: repo://extract_thinker/document_loader/document_loader_aws_textract.py
  - id: openwiki-source-720fec82995d55c9d1a2071a
    resource: repo://extract_thinker/document_loader/document_loader_azure_document_intelligence.py
  - id: openwiki-source-08a4573fafce761770cd8690
    resource: repo://extract_thinker/document_loader/document_loader_beautiful_soup.py
  - id: openwiki-source-1a81c99f517b1ae3898560d0
    resource: repo://extract_thinker/document_loader/document_loader_data.py
  - id: openwiki-source-83f922a1b667b592f2203fbd
    resource: repo://extract_thinker/document_loader/document_loader_google_document_ai.py
  - id: openwiki-source-964e22fb6c2de60a25515dfc
    resource: repo://extract_thinker/document_loader/document_loader_llm_image.py
  - id: openwiki-source-2a00d4cc1b4c235e6fd7be9a
    resource: repo://extract_thinker/document_loader/document_loader_mistral_ocr.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-672aaa160239e06162bf2ee0
    resource: repo://extract_thinker/document_loader/document_loader_spreadsheet.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# Document Loaders

All loaders live in `extract_thinker/document_loader/` and extend the abstract `DocumentLoader` base, usually through `CachedDocumentLoader`. They convert sources (file path, `BytesIO` stream, and for some loaders a URL) into a standard list of page dicts that the `Extractor` normalizes further.

## The `DocumentLoader` ABC

- **State** (document_loader.py:21-35): `content`, a `TTLCache(maxsize=100, ttl=cache_ttl)` (default 300s), `vision_mode` flag, `max_image_size`, `is_url`, and a configurable `screenshot_timeout` (ms).
- **Capability detection** (`can_handle`, document_loader.py:49-82): file paths are matched by extension against the subclass's `SUPPORTED_FORMATS`; `BytesIO` streams are sniffed with `libmagic` (`magic.from_buffer(..., mime=True)`) and mapped via `check_mime_type`, with the stream rewound afterwards. The whole check swallows exceptions and returns `False`.
- **Loading contract** (`load`, document_loader.py:84-87): abstract; every concrete implementation is decorated with `@cachedmethod` keyed on `(source or source.getvalue(), self.vision_mode)` so toggling vision mode busts the cache (e.g. document_loader_pypdf.py:104-105).
- **Vision rasterization** (`convert_to_images`, document_loader.py:92-190): images are returned as-is under page index 0; PDFs are rendered by `pypdfium2` at scale `300/72` (~300 DPI) and JPEG-encoded per page; `max_image_size` triggers LANCZOS downscale preserving aspect ratio (only when explicitly set; default is `None`, i.e. no resizing).
- **URL support** (document_loader.py:263-333): when a string source is a URL and vision is used, a full-page screenshot is captured with headless Chromium via Playwright (with a best-effort "Accept" cookie-banner click and a `screenshot_timeout` wait); tall screenshots are split into 1000-px vertical PNG chunks that all become "page 0". Missing Playwright raises an `ImportError` with install instructions (document_loader.py:248-261).
- **Vision/pagination capability** (document_loader.py:192-246): `can_handle_vision` returns True for URLs and for `pdf/jpg/jpeg/png/tiff/bmp` paths, opening streams as image or PDF to probe; `can_handle_paginate` is true only for PDF (extension for paths, MIME for streams) — `Process.split(..., SplittingStrategy.LAZY)` depends on it (process.py:232-236).

## `CachedDocumentLoader`

`CachedDocumentLoader` (cached_document_loader.py:1-34) adds a caching `load()` wrapper (source+vision_mode key into a `TTLCache`) — though note most concrete loaders subclass it yet override `load` with their own `@cachedmethod` decorator rather than calling `super().load`.

## Conventions across the family

1. **Config dataclasses** — each loader has a companion `*Config` dataclass (e.g. `TesseractConfig`, `PyPDFConfig`, `MistralOCRConfig`) with `__post_init__` validation (positive `cache_ttl`, legal PSM/OEM sets, required keys), and constructors accept *either* a config object or the legacy individual kwargs (document_loader_pypdf.py:41-75, document_loader_tesseract.py:92-146).
2. **Lazy optional dependencies** — heavy/cloud SDKs (`pypdf`, `pytesseract`, `openpyxl`, `bs4`+`requests`, `docling`, `markitdown`, `mistral`, AWS/Azure/GCP clients) are *not* in `pyproject.toml` core deps; each loader calls a static `_check_dependencies()` in `__init__` and a `_get_*()` lazily at use time, raising `ImportError` with the exact `pip install ...` hint (document_loader_pypdf.py:82-102, document_loader_beautiful_soup.py:102-131).
3. **Standard page shape** — `{"content": str, "image": bytes|None}`. Loaders add fields: spreadsheets append `"name"` and `"is_spreadsheet": True` (document_loader_spreadsheet.py:95-101); Mistral OCR returns markdown `content` plus `page_index`, optional `dimensions`, and extracted images; `DocumentLoaderLLMImage` returns empty text with only `image` bytes (document_loader_llm_image.py:137-165).

## Loader family

| Loader | Declared `SUPPORTED_FORMATS` | Mechanism |
|---|---|---|
| `DocumentLoaderTesseract` (+`TesseractConfig`) | jpeg, png, bmp, tiff, pdf, jpg | Local Tesseract binary OCR; PDFs are rasterized then OCR'd page-parallel (document_loader_tesseract.py:87-90, 209-225) |
| `DocumentLoaderPyPdf` (+`PyPDFConfig`) | pdf | pypdf text extraction; vision mode attaches `pypdfium2` page renders; supports encrypted PDFs via `password` (document_loader_pypdf.py:37-39, 106-152) |
| `DocumentLoaderPdfPlumber` (+`PDFPlumberConfig`) | pdf | pdfplumber text/table extraction |
| `DocumentLoaderSpreadSheet` | xls, xlsx, xlsm, xlsb, odf, ods, odt, csv | openpyxl with `data_only=True`; each sheet is one "page", rows joined by `" \| "` (document_loader_spreadsheet.py:13, 57-111) |
| `DocumentLoaderTxt` / `DocumentLoaderDoc2txt` | txt / docx, doc | plain text; doc2txt package for Word |
| `DocumentLoaderBeautifulSoup` (+`BeautifulSoupConfig`) | html, htm, url | requests-fetch for URLs (timeout 10s), BeautifulSoup parsing with configurable header handling, token-bounded pages, element stripping (default removes `script/style/nav/footer`) (document_loader_beautiful_soup.py:52-100, 219-260) |
| `DocumentLoaderMarkItDown` / `DocumentLoaderDocling` | office/OCR/markdown wide sets incl. `url` | Microsoft MarkItDown / IBM Docling converters; Docling URLs export as one Markdown page (document_loader_markitdown.py:63-68, document_loader_docling.py:104-128, 217-237) |
| `DocumentLoaderAzureForm` (+`AzureConfig`) | pdf, jpeg, jpg, png, bmp, tiff, heif, docx, xlsx, pptx, html | Azure Document Intelligence `begin_analyze_document` poller; parses pages, tables, key-value pairs, formulas, styles, barcodes, languages (document_loader_azure_document_intelligence.py:134-137, 215-370) |
| `DocumentLoaderAWSTextract` (+`TextractConfig`) | jpeg, png, pdf, tiff | AWS Textract; block-tree parsing of tables and form fields (document_loader_aws_textract.py:62-65, 151, 259-274) |
| `DocumentLoaderGoogleDocumentAI` / alias `DocumentLoaderDocumentAI` (+`GoogleDocAIConfig`) | images + pdf/docx/xlsx/pptx/html | Google Cloud Document AI processor client keyed by project/location/processor id, with optional native PDF parsing and page ranges (document_loader_google_document_ai.py:56-120, 288-291) |
| `DocumentLoaderMistralOCR` (+`MistralOCRConfig`) | pdf, jpg, jpeg, png, tiff, bmp | Mistral OCR REST API (`mistral-ocr-latest`, bearer key); images are converted to PDF first; optional recursive per-image extraction (document_loader_mistral_ocr.py:22-57, 533-600) |
| `DocumentLoaderLLMImage` (+`LLMImageConfig`) | pdf, jpg, jpeg, png, tiff, bmp | Vision-only fallback loader, permanently in vision mode; compresses/resizes images to a byte budget via quality stepping then LANCZOS scaling (document_loader_llm_image.py:44-51, 86, 88-135, 137-165) |
| `DocumentLoaderData` (+`DataLoaderConfig`) | none (structural) | Pass-through of already-standard page dicts, strings (file-or-literal), streams, and raw dicts — used when the Extractor receives list/dict sources (document_loader_data.py:21-130; extractor.py:118-120) |

## Gotchas observable in source

- `DocumentLoaderTesseract.__init__` requires the configured `tesseract_cmd` to be an existing file (`ValueError` otherwise), and the container mode re-reads it from the `TESSERACT_PATH` environment variable (document_loader_tesseract.py:136-146).
- `set_vision_mode(True)` on a loader whose `can_handle_vision` is False (e.g. BeautifulSoup in non-vision) surfaces as a `ValueError` inside `load()` (document_loader_beautiful_soup.py:232-234).
- Stream `can_handle` and `can_handle_paginate` read the full buffer via `getvalue()`; the cache keys also use `getvalue()`, so very large in-memory streams are hashed per call.
- Interceptor ABCs (`LoaderInterceptor.process(file, content)`, `LlmInterceptor.process(messages, response)`) live in this package but are invoked (only partially) by the Extractor; see `core/extractor.md` (loader_interceptor.py, llm_interceptor.py; extractor.py:1122-1124).

## Related pages

- `architecture/overview.md` — where loaders sit in the pipeline
- `core/extractor.md` — loader selection and universal-format mapping
- `guides/change-playbooks.md` — adding a new loader
