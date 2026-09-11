---
type: concept
title: Document Loaders
description: The document-loader subsystem that turns files, streams, URLs, and raw data into a standardized list-of-pages format for the extraction pipeline, including format detection, caching, vision mode, and the full catalog of concrete loaders.
tags: [document-loaders, ocr, vision, caching, pydantic]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:16:41.841Z
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
  - id: openwiki-source-2f495aad52dcc8e8ff83d945
    resource: repo://extract_thinker/document_loader/document_loader_docling.py
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
  - id: openwiki-source-35d2ee2f69deeb57b32d69a5
    resource: repo://extract_thinker/document_loader/loader_interceptor.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
generated: { by: "opencode", at: "2026-09-11T09:16:41.841Z" }
---

# Document Loaders

Document loaders are the input layer of ExtractThinker. Every loader converts a source (file path, `BytesIO` stream, URL, or pre-processed data) into the **standard page format** the rest of the pipeline consumes: a list of page dictionaries, each with a `content` text key and, in vision mode, an `image` bytes key. Some loaders attach additional structured metadata (tables, forms, formulas, barcodes, languages).

## The DocumentLoader contract

`DocumentLoader` (`extract_thinker/document_loader/document_loader.py`) is an abstract base class providing the shared machinery:

- **Format detection** — `can_handle(source)` decides whether a loader accepts a source. For a string path it checks the file extension against `SUPPORTED_FORMATS` (`_can_handle_file_path`); for a `BytesIO` stream it uses `python-magic` to sniff the MIME type and matches it through `check_mime_type` against the loader's formats (`_can_handle_stream`). Any exception falls back to `False`.
- **`load(source)`** — the abstract method each concrete loader implements; it must return the list-of-pages format.
- **Vision mode** — `set_vision_mode(enabled)` toggles whether loaders also attach `image` bytes per page. `can_handle_vision(source)` reports capability; URLs are always considered vision-capable, and for images/PDFs it checks the extension or attempts to open the stream.
- **PDF/image rendering helpers** — `convert_to_images(source, scale)` renders a PDF (via `pypdfium2`) or reads an image into `{page_index: bytes}`. URLs are fetched with Playwright headless Chromium: the page is navigated to `networkidle`, a cookie "Accept" banner is clicked if present, then a full-page screenshot is taken and split vertically into chunks (`_split_image_vertically`, default 1000 px) since a tall screenshot becomes "page 0". `set_screenshot_timeout` controls the settle time.
- **`can_handle_paginate(source)`** — only `pdf` extensions (or PDF MIME for streams) support pagination; this gates lazy splitting.

## Caching layer

`CachedDocumentLoader` (`extract_thinker/document_loader/cached_document_loader.py`) wraps `load` with a `cachetools.TTLCache` (default `cache_ttl=300`s, `maxsize=100`). The cache key is `(source, vision_mode)` — the raw path or stream bytes plus the current vision flag — so the same document re-rendered in text-only and vision mode is cached separately. Individual loaders decorate `load` with `@cachedmethod`.

## Config dataclasses

Every loader accepts either a dedicated `@dataclass` config object or the legacy flat-constructor arguments, and validates parameters in `__post_init__`:

- `TesseractConfig` — `tesseract_cmd` (required), `isContainer`, `lang`, `psm`/`oem` (validated against allowed sets), `config_params`, `timeout`.
- `PyPDFConfig` — `vision_enabled`, `password`, `extract_text`; `cache_ttl` must be positive.
- `PDFPlumberConfig`, `TxtConfig` (encoding/whitespace/paragraph splitting), `Doc2txtConfig`, `DataLoaderConfig`, `LLMImageConfig` (max image size/format/quality).
- `AzureConfig` — `subscription_key`, `endpoint`, `model_id` (validated against general + specialized prebuilt model lists), `features` (validated against `ocrHighResolution`, `formulas`, `styleFont`, `barcodes`, `languages`, `keyValuePairs`, `queryFields`, `searchablePDF`), `max_retries`.
- `TextractConfig` — AWS credentials or a pre-built `textract_client`, `feature_types` (must be a subset of `TABLES`, `FORMS`, `LAYOUT`, `SIGNATURES`), `max_retries`.
- `GoogleDocAIConfig` — `project_id`, `location`, `processor_id`, `credentials` (JSON string or file path), `processor_version`, `enable_native_pdf_parsing`, `page_range`.
- `MistralOCRConfig` — `api_key` (required), `model`, `include_image_base64`, `pages`, `image_limit`, `image_min_size`.
- `BeautifulSoupConfig` — `header_handling` (`skip`/`summarize`/`include`), `max_tokens`, `request_timeout`, `parser`, `remove_elements`.
- `MarkItDownConfig`, `DoclingConfig` (OCR/table-structure options), `EasyOCRConfig`.

## Concrete loaders

| Loader | Formats | Engine | Notable output |
|---|---|---|---|
| `DocumentLoaderTesseract` | `jpeg png bmp tiff pdf jpg` | pytesseract OCR | text per page; parallel OCR of PDF pages (≤4 threads); returns original image in vision mode. |
| `DocumentLoaderPyPdf` | `pdf` | pypdf text + pypdfium2 images | text per page; image in vision mode; optional PDF password. |
| `DocumentLoaderPdfPlumber` | `pdf` | pdfplumber | text per page. |
| `DocumentLoaderSpreadSheet` | `xls xlsx xlsm xlsb odf ods odt csv` | openpyxl/xlrd | each sheet becomes a page with `is_spreadsheet: True` and pipe-joined row text; helpers render sheets to PNG/PDF. |
| `DocumentLoaderAzureForm` | `pdf jpeg jpg png bmp tiff heif docx xlsx pptx html` | Azure Document Intelligence | text, `tables`, `forms` (key/value), plus `formulas`, `fonts`, `barcodes`, `languages` when enabled. |
| `DocumentLoaderAWSTextract` | `jpeg png pdf tiff` | AWS Textract | text lines plus `tables`, `forms`, `signatures` depending on `feature_types`; retries up to `max_retries`. |
| `DocumentLoaderGoogleDocumentAI` | images, `pdf docx xlsx pptx html` | Google Document AI | text, `tables`, `forms`, `key_value_pairs`; `DocumentLoaderDocumentAI` is a deprecated alias. |
| `DocumentLoaderMistralOCR` | `pdf jpg jpeg png tiff bmp` | Mistral OCR API | markdown text and extracted images; always vision-enabled. |
| `DocumentLoaderEasyOCR` | `png jpg jpeg tiff tif webp pdf` | EasyOCR | OCR text per page. |
| `DocumentLoaderBeautifulSoup` | `html htm url` | BeautifulSoup4 | cleaned web/HTML text; header handling and element removal options. |
| `DocumentLoaderMarkItDown` | Microsoft/OpenXML, PDF, HTML, images, more | MarkItDown | markdown text. |
| `DocumentLoaderDocling` | Word/PowerPoint/Excel, `pdf`, HTML/Markdown/AsciiDoc, images | Docling | text plus per-page `markdown`; OCR/table options. |
| `DocumentLoaderTxt` | `txt` | built-in | text (optionally paragraph-split, whitespace-preserved). |
| `DocumentLoaderDoc2txt` | `docx doc` | doc2txt | text from Word documents. |
| `DocumentLoaderLLMImage` | `pdf jpg jpeg png tiff bmp` | pypdfium2 + PIL | image-only pages (`content=""`, `image=bytes`) with configurable compression/resize; used as the automatic vision fallback. |
| `DocumentLoaderData` | any | passthrough | wraps pre-formatted list-of-dicts/string/stream content, validating each page has a `content` key. |

## Extension seam: interceptors

`LoaderInterceptor` (`extract_thinker/document_loader/loader_interceptor.py`) is an abstract hook (`process(file, content)`) that can be registered on an `Extractor` via `add_interceptor`; it is the intended seam for observing or mutating loaded content without subclassing a loader. `LlmInterceptor` (`process(messages, response)`) is the analogous hook around LLM calls.

## Representative tests

Per-loader test files cover the base contract and each engine: `tests/test_document_loader_base.py`, `tests/test_document_loader_pypdf.py`, `tests/test_document_loader_tesseract.py`, `tests/test_document_loader_spreadsheet.py`, and one file per cloud/vendor loader (Azure, Textract, Google Document AI, Docling, EasyOCR, Mistral OCR, MarkItDown, BeautifulSoup, LLM Image, Data, Txt, Word).
