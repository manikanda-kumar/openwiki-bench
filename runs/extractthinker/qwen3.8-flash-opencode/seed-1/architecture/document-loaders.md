---
type: subsystem
title: "Document Loaders"
description: "The DocumentLoader hierarchy: capability detection (can_handle/vision/paginate), TTL caching, the universal page format, URL screenshots, and the concrete loaders grouped by backend."
tags: [document-loaders, ocr, caching, vision, cloud-services]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
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
  - id: openwiki-source-2dbe57a9da9f58355d6f6edf
    resource: repo://extract_thinker/document_loader/document_loader_easy_ocr.py
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
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-a6f692d25c6d9ff8f733af5d
    resource: repo://tests/test_document_loader_txt.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Document Loaders

Loaders own the only sanctioned way to get bytes off disk (or from a cloud service) into ExtractThinker's page format: a `List[Dict]` where each dict carries `"content"` (str) and optionally `"image"` (bytes) or spreadsheet payloads. The abstract base is `DocumentLoader` (`extract_thinker/document_loader/document_loader.py`); nearly every concrete loader subclasses `CachedDocumentLoader`, which layers a `TTLCache(maxsize=100, ttl=cache_ttl)` (default 300 s) keyed on `(source, vision_mode)` — stream sources are keyed by their full bytes. Most loaders *additionally* decorate `load` with `@cachedmethod(attrgetter('cache'), key=hashkey(source, vision_mode))`, so caching is implemented twice in practice.

## Capability predicates

- `can_handle(source)`: for paths, requires `os.path.isfile` and an extension (lowercased) in the class's `SUPPORTED_FORMATS`; for `BytesIO`, sniffs `magic.from_buffer(..., mime=True)` and maps through `check_mime_type` against `utils.MIME_TYPE_MAPPING`. Any exception returns `False`.
- `can_handle_vision(source)`: URL strings are always accepted; paths must have a pdf/image extension; streams are probed by opening with PIL then `pypdfium2.PdfDocument`.
- `can_handle_paginate(source)`: true only for PDF (`'pdf'` extension or `application/pdf` mime) — this gates `SplittingStrategy.LAZY` in `Process.split`.

## Shared mechanisms in the base class

- `convert_to_images(file, scale=300/72)` renders PDFs to per-page JPEG bytes via `pypdfium2`, returns plain images as `{0: bytes}`, and for URL sources captures a full-page Playwright screenshot (headless Chromium, `wait_until='networkidle'`, a best-effort "Accept" cookie click, then a configurable `screenshot_timeout` ms wait), splits the tall screenshot into vertical chunks, and keys them all under page `0`. Missing Playwright raises `ImportError` with `pip install playwright` + `playwright install` instructions.
- `set_max_image_size(size)` optionally downscales rendered images (LANCZOS, aspect-preserving); unset by default.
- `set_vision_mode(True)` makes loaders that support it attach rendered page images to their output.

## The Config-dataclass idiom

Each loader accepts either its `*Config` dataclass or positional/scalar parameters, and the dataclass `__post_init__` validates values (e.g., `TesseractConfig` rejects PSM outside 0–13, OEM outside 0–3, negative timeout). `DocumentLoaderTesseract` resolves its binary from `tesseract_cmd` or the `TESSERACT_PATH` environment variable, defaults to `"tesseract"` on PATH, OCRs PDF pages by rendering them first, and runs multi-page image OCR in worker `threading.Thread`s over queues. Heavyweight third-party packages (`pypdf`, `openpyxl`/`xlrd`, `easyocr`, `docling`, `bs4`/`requests`, `pytesseract`, `markitdown`) are imported lazily inside methods so the package imports cleanly without them, raising `ImportError` with the exact pip command.

## Loader inventory

| Loader | Formats (SUPPORTED_FORMATS) | Engine / dependency | Notes |
|---|---|---|---|
| `DocumentLoaderPyPdf` | pdf | `pypdf` (+password support) | page `content` = `extract_text() or ''` |
| `DocumentLoaderPdfPlumber` | pdf | `pdfplumber` | |
| `DocumentLoaderTxt` | txt | stdlib | encoding/whitespace/paragraph config |
| `DocumentLoaderDoc2txt` | docx, doc | python-docx | |
| `DocumentLoaderSpreadSheet` | xls, xlsx, xlsm, xlsb, odf, ods, odt, csv | `openpyxl` + `xlrd` | emits `{is_spreadsheet: True, sheet_name/data}` pages the Extractor formats via `json_to_formatted_string` |
| `DocumentLoaderTesseract` | jpeg, png, bmp, tiff, pdf, jpg | Tesseract binary + `pytesseract` | external OCR engine |
| `DocumentLoaderEasyOCR` | png, jpg, jpeg, tiff, tif, webp, pdf | `easyocr` models | local neural OCR |
| `DocumentLoaderBeautifulSoup` | html, htm, url | `bs4` + `requests` | token-bounded extraction, header handling config |
| `DocumentLoaderMarkItDown` | pdf, doc/ppt/xls families, csv/tsv, txt, html/xml/json, zip, images, audio, url | `markitdown` | |
| `DocumentLoaderDocling` | office families, pdf, html variants, md, adoc | `docling` converter | |
| `DocumentLoaderAzureForm` | pdf, images, heif, docx, xlsx, pptx, html | Azure `DocumentAnalysisClient` | explicit `subscription_key`+`endpoint` (or `AzureConfig`); model/features config |
| `DocumentLoaderAWSTextract` | jpeg, png, pdf, tiff | `boto3` | credentials in `TextractConfig` |
| `DocumentLoaderGoogleDocumentAI` | images, pdf, docx, xlsx, pptx, html | Google Document AI | `project_id`/`processor_id`/service-account `credentials` validated non-empty |
| `DocumentLoaderMistralOCR` | pdf, jpg, jpeg, png, tiff, bmp | HTTP `api.mistral.ai/v1/ocr` | `api_key` required at config validation; uploads files first |
| `DocumentLoaderLLMImage` | pdf, jpg, jpeg, png, tiff, bmp | base image rendering | `vision_mode = True` always; pages have empty `content`, image-only |
| `DocumentLoaderData` | any str/stream/list/dict | none | pass-through for already-universal pages; the list-source fallback |

`__init__.py` re-exports each loader and its config class; cloud loaders are inert (just `ImportError` at use time) without the respective SDK installed.

## Focused tests

`tests/test_document_loader_base.py` defines a shared `BaseDocumentLoaderTest` contract (load shape, `can_handle` behavior, vision flags) reused by per-loader suites like `tests/test_document_loader_txt.py`, which also assert `*Config.__post_init__` validation errors. Local-engine suites (tesseract, azure, textract, google, mistral, easyocr) require the corresponding binary/credentials and are not runnable offline.

Related: [Adding a Document Loader](/openwiki/guides/adding-a-document-loader.md) for the step-by-step change recipe; [Extractor Core](/openwiki/architecture/extractor.md) for how loader output is consumed.
