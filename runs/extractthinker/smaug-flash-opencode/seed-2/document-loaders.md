---
type: "Reference"
title: "Document Loaders"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
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
  - id: openwiki-source-37b0d6a9d3960991060f574f
    resource: repo://extract_thinker/document_loader/document_loader_markitdown.py
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
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---


# Document Loaders

A **DocumentLoader** is responsible for loading and preprocessing a document source (file path, `BytesIO` stream, URL, or pre-processed data) into a canonical **list of page dictionaries**. This uniform output is what lets the same Extractor/LLM pipeline consume any loader.

## The loader contract

`DocumentLoader` (`extract_thinker/document_loader/document_loader.py`) is an abstract base class with:

- `SUPPORTED_FORMATS` — declared by each subclass; a list of file extensions the loader can handle.
- `can_handle(source)` — true if the loader can process the source; it matches file extensions for paths and MIME types (via `python-magic`) for streams (`document_loader.py:49-83`).
- `load(source)` — abstract; must return a list of pages.
- `set_vision_mode(enabled)` — toggles whether the loader also returns rendered page images (`document_loader.py:41-43`).
- `can_handle_vision(source)` — true if the loader can render the source as vision content (`document_loader.py:192-221`).
- `can_handle_paginate(source)` — true only for PDF sources, used by the lazy-splitting path (`document_loader.py:223-246`).
- `convert_to_images(file, scale=300/72)` — renders a PDF/image/URL into a dict keyed by page index of JPEG/PIL image bytes (`document_loader.py:92-191`). For URLs it captures a full-page screenshot via Playwright, splitting tall pages vertically into chunks.
- `max_image_size` / `set_max_image_size`, and `screenshot_timeout` / `set_screenshot_timeout` for URL screenshotting.

Most concrete loaders override only `load` (and `can_handle` in specialized cases), relying on the base helper methods.

## Caching

`CachedDocumentLoader` (`extract_thinker/document_loader/cached_document_loader.py`) adds a `cachetools.TTLCache` (default size 100, TTL 300s) whose key is the tuple `(source-content-or-path, vision_mode)`. This means repeated loads of the same document in the same vision mode hit the cache. Many loaders also apply `@cachedmethod` on `load` for method-level caching keyed on the same values.

## The page-based content contract

Each loader returns a `List[Dict]`. Minimum page shape:

```
{"content": str}
```

With vision mode enabled, pages additionally carry:

```
{"content": str, "image": bytes}        # single rendered page image
{"content": str, "images": [bytes,...]} # multiple images
```

- `DocumentLoaderPyPdf` — text via pypdf (`PdfReader.extract_text`) and, in vision mode, rendered page images via pypdfium2 (`document_loader_pypdf.py:106-152`). Supports an optional password and an `extract_text` toggle.
- `DocumentLoaderTesseract` — OCR text via pytesseract; processes PDFs by rendering pages to images and OCR-ing them in parallel (up to 4 threads). Config includes `lang`, `psm`, `oem`, `config_params`, and `timeout` (`document_loader_tesseract.py:87-319`).
- `DocumentLoaderSpreadSheet` — treats each sheet as a separate "page"; converts sheet rows into a tabular string. Supports xls/xlsx/xlsm/xlsb/odf/ods/odt/csv (`document_loader_spreadsheet.py`).
- `DocumentLoaderData` — a passthrough loader that accepts already-normalized lists of dicts (validating each has a `"content"` key), plain strings/filenames, dicts, or readable streams, and returns page data directly. Used by the Extractor for split/pre-processed content (`document_loader_data.py`).
- `DocumentLoaderLLMImage` — a vision-only loader that converts PDFs/images to page images (no text); used as the **fallback** when `allow_vision` is set and no other loader is available (`document_loader_llm_image.py`, `extractor.py:119-125`).
- `DocumentLoaderDoc2txt` — extracts Word/rich text via `docx2txt`.
- `DocumentLoaderTxt` — plain text with configurable encoding, whitespace preservation, and paragraph splitting (`document_loader_txt.py`).

## External document-intelligence integrations

These loaders call third-party services and require credentials/config:

- `DocumentLoaderAzureForm` — Azure Document Intelligence (`azure-ai-formrecognizer`). Config selects a model ID (general: `prebuilt-read`/`prebuilt-layout`/`prebuilt-document`; or specialized like `prebuilt-invoice`) and optional features (`ocrHighResolution`, `formulas`, `styleFont`, `barcodes`, `languages`, `keyValuePairs`, `queryFields`, `searchablePDF`). Returns content, tables, forms, formulas, fonts, barcodes, languages per page. Retries up to `max_retries` (`document_loader_azure_document_intelligence.py:213-391`).
- `DocumentLoaderAWSTextract` — AWS Textract (`jpeg/png/pdf/tiff`). Config includes credentials, region, `feature_types` from `TABLES/FORMS/LAYOUT/SIGNATURES` (empty for raw text only), and `max_retries` (`document_loader_aws_textract.py`).
- `DocumentLoaderGoogleDocumentAI` — Google Document AI. Config requires `project_id`, `location`, `processor_id`, `credentials`; supports native PDF parsing and `page_range` (`document_loader_google_document_ai.py`).
- `DocumentLoaderMistralOCR` — Mistral OCR API (`mistral-ocr-latest`). Config includes `api_key`, `include_image_base64`, `pages`, `image_limit`, `image_min_size`, `allow_image_recursive`; always vision-enabled (`document_loader_mistral_ocr.py`).
- `DocumentLoaderEasyOCR` — local EasyOCR inference with `lang_list`, `gpu`, `download_enabled`, optional bounding boxes (`document_loader_easy_ocr.py`).
- `DocumentLoaderDocling` — Docling for layout/table/OCR parsing of PDF and images; config exposes pipeline options like OCR, table-structure detection, cell matching (`document_loader_docling.py`).
- `DocumentLoaderMarkItDown` — converts a wide range of formats to Markdown via MarkItDown, with MIME detection and optional LLM enhancement (`document_loader_markitdown.py`).
- `DocumentLoaderBeautifulSoup` — loads HTML (files, streams, or URLs) via BeautifulSoup; config controls header handling, `max_tokens`, `request_timeout`, removed elements (`document_loader_beautiful_soup.py`).

Many loaders validate their configs in `__post_init__`, raising `ValueError` for invalid psm/oem (Tesseract), unsupported model IDs/features (Azure), or invalid feature types (Textract).

## Loader selection in Extractor

`Extractor.get_document_loader(source)` (`extract_thinker/extractor.py:92-126`) resolves the loader: it first returns the primary `document_loader` if it `can_handle` the source, then tries extension-based lookup in `document_loaders_by_file_type`, then any registered loader by capability, then `DocumentLoaderData()` for list/dict sources, and finally `DocumentLoaderLLMImage()` if `allow_vision` is set.
