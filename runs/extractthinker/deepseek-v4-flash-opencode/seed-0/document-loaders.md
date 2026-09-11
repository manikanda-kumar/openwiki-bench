---
type: concept
title: Document Loaders
description: The DocumentLoader family — the base contract, caching, capability checks, vision mode, the universal page output format, and every concrete loader with its config and dependencies.
tags: [document-loader, ocr, pdf, extraction, cache]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
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
  - id: openwiki-source-0da9b8d49bc56592f18b2325
    resource: repo://extract_thinker/document_loader/document_loader_doc2txt.py
  - id: openwiki-source-2f495aad52dcc8e8ff83d945
    resource: repo://extract_thinker/document_loader/document_loader_docling.py
  - id: openwiki-source-2dbe57a9da9f58355d6f6edf
    resource: repo://extract_thinker/document_loader/document_loader_easy_ocr.py
  - id: openwiki-source-83f922a1b667b592f2203fbd
    resource: repo://extract_thinker/document_loader/document_loader_google_document_ai.py
  - id: openwiki-source-964e22fb6c2de60a25515dfc
    resource: repo://extract_thinker/document_loader/document_loader_llm_image.py
  - id: openwiki-source-37b0d6a9d3960991060f574f
    resource: repo://extract_thinker/document_loader/document_loader_markitdown.py
  - id: openwiki-source-2a00d4cc1b4c235e6fd7be9a
    resource: repo://extract_thinker/document_loader/document_loader_mistral_ocr.py
  - id: openwiki-source-672aaa160239e06162bf2ee0
    resource: repo://extract_thinker/document_loader/document_loader_spreadsheet.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-2959eb9b0f703c28af9f3dc1
    resource: repo://extract_thinker/document_loader/document_loader_txt.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# Document Loaders

Document loaders convert a source — a file path, `BytesIO` stream, or URL — into
the uniform list-of-pages format that the rest of the pipeline consumes. They
are the input layer of ExtractThinker; see
[Architecture](architecture.md#the-universal-content-format).

## The base contract

`DocumentLoader` (`extract_thinker/document_loader/document_loader.py:16-341`)
is an abstract base class. Every loader must implement
`load(source) -> List[Dict[str, Any]]`, returning one dict per page with at
least a `"content"` text key and, in vision mode, `"image"`/`"images"` bytes.

Shared constructor options: `content` (initial content), `cache_ttl` (seconds),
and `screenshot_timeout` (milliseconds, used only for URL screenshots).

### Capability checks

- `can_handle(source)` (`document_loader.py:49-66`) — file paths are checked by
  extension against `SUPPORTED_FORMATS`; `BytesIO` streams are checked by MIME
  type via `python-magic` and `check_mime_type` (`document_loader.py:68-82`).
- `can_handle_vision(source)` (`document_loader.py:192-221`) — true for
  URLs and for `pdf/jpg/jpeg/png/tiff/bmp` extensions.
- `can_handle_paginate(source)` (`document_loader.py:223-246`) — true only for
  PDFs, which is why lazy splitting is PDF-only.

### Vision mode and image conversion

`set_vision_mode(enabled)` (`document_loader.py:41-43`) tells a loader to attach
rendered page images. `convert_to_images(file, scale=300/72)`
(`document_loader.py:92-99`) renders PDFs to per-page JPEG bytes with
pypdfium2 (`_convert_pdf_to_images`) and returns image files/streams as-is. For
URL sources, `_capture_screenshot_from_url` uses Playwright (headless Chromium)
to capture a full-page screenshot, which is then split into vertical chunks by
`_split_image_vertically` (`document_loader.py:263-333`). `set_max_image_size`
limits the longest edge when resizing.

## Caching

`CachedDocumentLoader` (`extract_thinker/document_loader/cached_document_loader.py:7-34`)
wraps `load` with a `cachetools.TTLCache(maxsize=100, ttl=cache_ttl)`. The cache
key is `(source path-or-bytes, self.vision_mode)`, so text and vision loads of
the same source never collide. Concrete loaders apply the cache with
`@cachedmethod(cache=attrgetter('cache'), key=hashkey(...))` on their `load`.

## The loader family

### OCR loaders

- **Tesseract** (`DocumentLoaderTesseract`) — local OCR over
  `jpeg/png/bmp/tiff/pdf/jpg`. Requires the `tesseract` binary and the
  `pytesseract` package. `TesseractConfig` validates `psm` (0–13), `oem` (0–3),
  and a non-negative `timeout`; `isContainer` reads `TESSERACT_PATH` instead of
  the configured command. PDF pages are OCR'd in parallel (max 4 worker threads).
- **EasyOCR** (`DocumentLoaderEasyOCR`) — OCR over
  `png/jpg/jpeg/tiff/tif/webp/pdf` using `EasyOCRConfig` (`lang_list`, `gpu`,
  `download_enabled`, `include_bbox`). Unlike other loaders it is constructed
  with a config object and validates `lang_list` non-empty and `cache_ttl > 0`.
- **Mistral OCR** (`DocumentLoaderMistralOCR`) — hosted OCR via the Mistral API
  (`api_key`, `model="mistral-ocr-latest"`, page/image options). Supports
  `pdf/jpg/jpeg/png/tiff/bmp` and overrides `can_handle_paginate`.
- **LLM Image** (`DocumentLoaderLLMImage`) — emits pages with an empty
  `"content"` and raw `"image"` bytes for `pdf/jpg/jpeg/png/tiff/bmp`, so a
  vision-capable LLM can read the image directly. This is the fallback loader
  when `Extractor` has `allow_vision=True` and no other loader matches.

### Cloud document intelligence loaders

- **Azure Document Intelligence** (`DocumentLoaderAzureForm`) — requires
  `azure-ai-formrecognizer`. `AzureConfig` (`subscription_key`, `endpoint`,
  `model_id="prebuilt-layout"`, `max_retries=3`, `features`) validates the model
  id against general (`prebuilt-read/layout/document`) and specialized prebuilt
  models, and validates feature names (`ocrHighResolution`, `formulas`,
  `styleFont`, `barcodes`, `languages`, `keyValuePairs`, `queryFields`,
  `searchablePDF`). Pages carry `tables`, `forms`, and enabled feature output.
- **AWS Textract** (`DocumentLoaderAWSTextract`) — requires
  `boto3`-configured credentials. `TextractConfig` allows feature types from
  `TABLES/FORMS/LAYOUT/SIGNATURES`; an empty list means raw text only.
  Supports `jpeg/png/pdf/tiff`.
- **Google Document AI** (`DocumentLoaderGoogleDocumentAI` /
  `DocumentLoaderDocumentAI`) — requires `google-cloud-documentai`.
  `GoogleDocAIConfig` requires `project_id`, `location`, `processor_id`,
  `credentials`, defaults `processor_version="rc"`, and validates that
  `page_range` is a list of positive integers. A `DocumentLoaderDocumentAI`
  subclass is provided for a simplified constructor.

### PDF/office/text loaders

- **PyPDF** (`DocumentLoaderPyPdf`) — pypdf text extraction plus pypdfium2 page
  images in vision mode; supports encrypted PDFs via a `password`. `PyPDFConfig`
  validates positive `cache_ttl` and string `password`.
- **PdfPlumber** (`DocumentLoaderPdfPlumber`) — pdfplumber text + table
  extraction (`table_settings`, `extract_tables=True`, `vision_enabled`).
- **Spreadsheet** (`DocumentLoaderSpreadSheet`) — openpyxl/xlrd over
  `xls/xlsx/xlsm/xlsb/odf/ods/odt/csv`; each sheet becomes a page with
  `is_spreadsheet: True` and pipe-joined cell rows; vision unsupported.
- **TXT** (`DocumentLoaderTxt`) — utf-8 text; `split_paragraphs` turns each
  paragraph into a page; `set_vision_mode(True)` raises `ValueError`.
- **Doc2txt** (`DocumentLoaderDoc2txt`) — `docx/doc` via docx2txt; rejects
  `extract_images=True` at config validation.
- **BeautifulSoup** (`DocumentLoaderBeautifulSoup`) — HTML/web loader with
  `header_handling` (`skip`/`summarize`/`include`), `max_tokens` per page,
  `request_timeout`, `parser`, and `remove_elements`.
- **MarkItDown** (`DocumentLoaderMarkItDown`) — Microsoft MarkItDown over many
  formats with optional LLM enhancement (`llm_client`, `llm_model`) and
  `mime_type_detection`/`default_extension`/`page_separator`.
- **Docling** (`DocumentLoaderDocling`) — IBM Docling with `format_options`
  (advanced per-format pipelines), `ocr_enabled`, `table_structure_enabled`,
  `force_full_page_ocr`, and `do_cell_matching`.
- **Data** (`DocumentLoaderData`) — accepts pre-processed standard-format data
  (dict/list of page dicts, paths, streams). `can_handle` accepts any string,
  readable object, dict, or list of dicts, so it is the fallback for
  already-loaded content (e.g. results of splitting).

## Dependency and failure conventions

Each optional dependency is lazy-loaded, and a missing package raises a
descriptive `ImportError` (e.g.
`DocumentLoaderTesseract._check_dependencies`,
`document_loader_tesseract.py:128-147`). All loaders raise `ValueError` for
sources they cannot handle or that fail during processing, preserving the
`can_handle`-first convention.

## Testing

Loader tests live in `tests/test_document_loader_*.py` and share the base
contract tests in `tests/test_document_loader_base.py` (`test_load_content_basic`,
`test_vision_mode`, `test_cache_functionality`), using sample files under
`tests/files/`.
