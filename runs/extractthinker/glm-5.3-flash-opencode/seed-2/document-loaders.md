---
type: subsystem
title: Document Loaders
description: The DocumentLoader contract, caching, vision and pagination capabilities, URL screenshot support, and the catalog of loader implementations with their external dependencies.
tags: [document-loaders, pdf, ocr, caching, vision, integration]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-1a81c99f517b1ae3898560d0
    resource: repo://extract_thinker/document_loader/document_loader_data.py
  - id: openwiki-source-67a2c4f10acd4e83de86b47f
    resource: repo://extract_thinker/document_loader/document_loader_pdfplumber.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# Document Loaders

Document loaders are the ingestion seam: they convert a file path, `BytesIO` stream, or URL into a list of page dictionaries that the rest of the library consumes. All loaders subclass `DocumentLoader` (ABC, `extract_thinker/document_loader/document_loader.py`) and typically `CachedDocumentLoader` for caching.

## The base contract

`DocumentLoader` provides:

- **Capability checks** (`can_handle`, `#L49-L82`): file paths are matched by extension against the subclass's `SUPPORTED_FORMATS`; streams are sniffed by python-magic MIME. Any error returns `False` rather than raising.
- **Abstract `load(source)`** (`#L84-L87`): each implementation turns the source into pages. The de facto page schema is `{"content": str, "image": None|bytes, ...}` — subclasses add keys like `tables`, `"thumbnails"`, or `"is_spreadsheet"`.
- **Shared conversion machinery** (`#L92-L191`): `convert_to_images` rasterizes PDFs with `pypdfium2` at a default scale of 300/72, resizes if `max_image_size` is set, and handles **URLs by taking a Playwright browser screenshot** with the configured millisecond timeout (`screenshot_timeout`, `#L21-L47, 263-L301`). Long pages are split vertically into ~1000px chunks (`_split_image_vertically`, `#L303-L333`), and URL chunks are all reported as "page 0".
- **Vision and pagination capability** (`#L192-L246`): `can_handle_vision` accepts URL input always and otherwise image/PDF formats; `can_handle_paginate` returns True for PDF only (by extension or MIME) — this is what gates Process's lazy split.

## Caching

`CachedDocumentLoader.load` (`extract_thinker/document_loader/cached_document_loader.py#L12-L31`) caches per-instance results in a `TTLCache(maxsize=100, ttl=cache_ttl)` (default TTL 300s) keyed by `(source bytes or path, vision_mode)`, so toggling vision invalidates prior hits. Concrete loaders frequently re-declare the same TTL cache with `@cachedmethod` plus their own key function (e.g., `document_loader_pdfplumber.py#L104-L105`).

## Catalog of implementations

All are exported from `extract_thinker/__init__.py`. Local-only loaders:

| Loader | Formats | Backend |
|---|---|---|
| `DocumentLoaderPyPdf` | pdf | pypdf text extraction |
| `DocumentLoaderPdfPlumber` | pdf | pdfplumber text + tables |
| `DocumentLoaderDocling` | pdf, images, office (list in `SUPPORTED_FORMATS`, `document_loader_docling.py#L104`) | docling |
| `DocumentLoaderMarkItDown` | pdf, office, web (list at `document_loader_markitdown.py#L63`) | markitdown |
| `DocumentLoaderTesseract` | jpeg/png/bmp/tiff/jpg/pdf | pytesseract OCR ("TESSERACT_PATH" binary needed) |
| `DocumentLoaderEasyOCR` | png/jpg/jpeg/tiff/tif/webp/pdf | easyocr |
| `DocumentLoaderTxt` | txt | plain text |
| `DocumentLoaderDoc2txt` | docx, doc | doc2txt |
| `DocumentLoaderSpreadSheet` | xls/xlsx/xlsm/xlsb/odf/ods/odt/csv | spreadsheet parsing; sets `is_spreadsheet` pages |
| `DocumentLoaderBeautifulSoup` | html-ish list (`document_loader_beautiful_soup.py#L55`) | BeautifulSoup |
| `DocumentLoaderData` | pre-processed lists of `{"content", "image"}` dicts, strings, streams | no external parsing; used as the fall-through for already-split content and manual data |

Cloud loaders (require the provider SDK/credentials and raise ImportError at construction if absent):

| Loader | Backend |
|---|---|
| `DocumentLoaderAzureForm` | Azure Document Intelligence |
| `DocumentLoaderAWSTextract` | AWS Textract |
| `DocumentLoaderGoogleDocumentAI` | Google Document AI |
| `DocumentLoaderMistralOCR` | Mistral OCR |

Vision-special loader: `DocumentLoaderLLMImage` (`document_loader_llm_image.py`) — formats pdf/jpg/jpeg/png/tiff/bmp (`#L49`); it feeds images to the LLM itself rather than producing text. `Extractor` instantiates it as the vision fallback when no other loader fits and `allow_vision` is set (`extract_thinker/extractor.py#L122-L124`).

## Loader resolution by Extractor

`Extractor.get_document_loader` (`extract_thinker/extractor.py#L92-L126`) tries, in order: (1) the primary loader if it can handle the source; (2) extension lookup in the per-type registry; (3) any registered loader's `can_handle`; (4) `DocumentLoaderData` for list/dict sources (resulting from splitting); (5) `DocumentLoaderLLMImage` when `allow_vision`. If all fail it returns `None`, which callers turn into `ValueError("No suitable document loader found for the input.")`.

## Failure and cache semantics

- Loaders raise `ValueError` on unusable sources (e.g., `document_loader_pdfplumber.py#L120-L121, 153-154`).
- Caching is per-instance and process-local — no shared or persistent cache exists in the repository.
- The base test harness (`tests/test_document_loader_base.py`) asserts three invariants: non-null content, vision-mode images produced (or `ValueError` where unsupported), and a second load strictly faster than the first, proving caching. Concrete loader tests (`tests/test_document_loader_*.py`) instantiate each loader and run this suite against fixture files in `tests/files/`.

Related: [Extractor and Extraction Flow](/openwiki/extractor-and-extraction-flow.md) · [Change Guides](/openwiki/change-guides.md#guide-1-add-a-new-document-loader)
