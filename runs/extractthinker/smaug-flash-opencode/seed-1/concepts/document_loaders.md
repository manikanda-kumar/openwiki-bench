---
type: concept
title: Document Loaders
description: The DocumentLoader abstraction, the standard page-based load output format, TTLCache caching with vision-mode keys, vision handling, and an inventory of every concrete loader with its supported formats.
tags: [document-loader, caching, vision, ocr, pdf, formats]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
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
  - id: openwiki-source-2959eb9b0f703c28af9f3dc1
    resource: repo://extract_thinker/document_loader/document_loader_txt.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---

# Document Loaders

Document loaders are the abstraction through which ExtractThinker reads a source (file path, in-memory stream, or URL) and turns it into a normalized, list-of-pages data structure that downstream extraction can consume.

## The abstract contract

`DocumentLoader` (`extract_thinker/document_loader/document_loader.py:16`) is an abstract base class. Its key members:

| Member | Purpose |
|---|---|
| `load(source)` | **Abstract.** Reads the source and returns a normalized list of page dicts. |
| `can_handle(source)` | Checks whether the loader can handle a path (`_can_handle_file_path`, compares extension against `SUPPORTED_FORMATS`) or a `BytesIO` stream (`_can_handle_stream` via `magic` + `check_mime_type`). Returns `False` on any exception. |
| `can_handle_vision(source)` | Whether the source can be handled in vision mode. Default checks extensions (pdf/jpg/jpeg/png/tiff/bmp) and URL sources. |
| `can_handle_paginate(source)` | Whether the source supports lazy pagination; the default only returns true for PDFs. |
| `convert_to_images(file, scale=300/72)` | Renders PDFs to dicts of page-index → JPEG bytes, and passes images through directly. Supports file paths, `BytesIO`/`BufferedReader` streams, and URLs. |
| `set_vision_mode(enabled)` | Toggles the loader's `vision_mode` flag. |
| `set_max_image_size(size)` / `set_screenshot_timeout(ms)` | Control image resizing and URL screenshot wait time. |

Common flags/state: `SUPPORTED_FORMATS` (list of extensions), `vision_mode` (`False` by default), `max_image_size` (`None` = no resizing), `is_url`, `screenshot_timeout`.

The base class also handles URL screenshots: `_capture_screenshot_from_url` uses Playwright (headless Chromium), then `_split_image_vertically` slices tall screenshots into chunks.

## The standard page format

Every loader's `load()` returns a **list of page dictionaries**, where each page may contain (depending on loader):

- `content` — the text of the page (string; empty in pure image loaders).
- `image` — rendered page image bytes, present when `vision_mode` is enabled.
- enrichment keys — e.g. `tables`, `forms`, `signatures` (AWSTextract), `formulas`/`fonts`/`barcodes`/`languages` (Azure), `forms`/`key_value_pairs` (Google), `detail` (EasyOCR bbox).

This is the input to `Extractor._map_to_universal_format`, which flattens the list to `{"content": str, "images": [...], "metadata": {...}}`.

## Caching

`CachedDocumentLoader` (`extract_thinker/document_loader/cached_document_loader.py:7`) extends `DocumentLoader` and adds a `cachetools.TTLCache(maxsize=100, ttl=cache_ttl)`. The `load` method computes a cache key of `(source, vision_mode)` — using the raw bytes for streams — so vision and non-vision loads are cached independently.

Most concrete loaders instead use a `@cachedmethod(cache=attrgetter('cache'), key=lambda self, source: hashkey(... , self.vision_mode))` decorator, which keys on `(source, self.vision_mode)` too. (`MistralOCR` keys only on `source`; `EasyOCR` keys only on `source`.)

## Vision mode

Enabling vision via `set_vision_mode(True)` makes a loader include rendered `image` bytes per page amp; it is what lets vision-capable LLMs "see" the pages. Loaders that cannot support vision raise `ValueError` when `set_vision_mode(True)` is called (e.g. `DocumentLoaderTxt.set_vision_mode`, `DocumentLoaderDoc2txt.set_vision_mode`, `DocumentLoaderEasyOCR.set_vision_mode`). `DocumentLoaderLLMImage` is always in vision mode.

## Concrete loaders inventory

| Loader | Source | `SUPPORTED_FORMATS` | Notes |
|---|---|---|---|
| `DocumentLoaderPyPdf` | `document_loader_pypdf.py` | `['pdf']` | Text via pypdf, images (vision) via pypdfium2. Config: `PyPDFConfig` (password, extract_text). |
| `DocumentLoaderPdfPlumber` | `document_loader_pdfplumber.py` | `['pdf']` | Text + tables via pdfplumber. Config `PDFPlumberConfig`. |
| `DocumentLoaderTesseract` | `document_loader_tesseract.py` | `['jpeg','png','bmp','tiff','pdf','jpg']` | Local OCR via pytesseract, parallel worker threads, configurable PSM/OEM/lang. Config `TesseractConfig`. |
| `DocumentLoaderEasyOCR` | `document_loader_easy_ocr.py` | `['png','jpg','jpeg','tiff','tif','webp','pdf']` | Local OCR via easyocr, optional bbox detail. Config `EasyOCRConfig`. |
| `DocumentLoaderSpreadSheet` | `document_loader_spreadsheet.py` | `['xls','xlsx','xlsm','xlsb','odf','ods','odt','csv']` | Each sheet becomes a "page"; uses openpyxl/xlrd. No vision. |
| `DocumentLoaderAzureForm` | `document_loader_azure_document_intelligence.py` | `['pdf','jpeg','jpg','png','bmp','tiff','heif','docx','xlsx','pptx','html']` | Azure Document Intelligence; prebuilt general/specialized models; advanced features (ocrHighResolution, formulas, etc.). Config `AzureConfig`. |
| `DocumentLoaderAWSTextract` | `document_loader_aws_textract.py` | `['jpeg','png','pdf','tiff']` | AWS Textract raw text or analyze for TABLES/FORMS/LAYOUT/SIGNATURES. Config `TextractConfig`. |
| `DocumentLoaderGoogleDocumentAI` | `document_loader_google_document_ai.py` | images (`jpeg`,`jpg`,`png`,`bmp`,`tiff`,`tif`,`gif`,`webp`); docs (`pdf`,`docx`,`xlsx`,`pptx`,`html`) | Google Document AI; extracts pages, tables, forms, key-value pairs. Config `GoogleDocAIConfig`. |
| `DocumentLoaderMistralOCR` | `document_loader_mistral_ocr.py` | `['pdf','jpg','jpeg','png','tiff','bmp']` | Mistral OCR API; markdown output; optional recursive image extraction; always vision-enabled. Config `MistralOCRConfig`. |
| `DocumentLoaderLLMImage` | `document_loader_llm_image.py` | `['pdf','jpg','jpeg','png','tiff','bmp']` | Vision-only fallback loader; converts pages to image bytes. Config `LLMImageConfig`. |
| `DocumentLoaderData` | `document_loader_data.py` | — (accepts any) | Handles already-normalized list-of-dict data, raw strings, or streams. Config `DataLoaderConfig`. |
| `DocumentLoaderTxt` | `document_loader_txt.py` | `['txt']` | Plain text; optional paragraph splitting. No vision. Config `TxtConfig`. |
| `DocumentLoaderDoc2txt` | `document_loader_doc2txt.py` | `['docx','doc']` | Word docs via docx2txt. No vision. Config `Doc2txtConfig`. |
| `DocumentLoaderDocling` | `document_loader_docling.py` | extensive (`docx`,`dotx`,`docm`,`dotm`,`pptx`,... ,`txt`,`xml`,`nxml`,`url`, images, markdown, adoc) | IBM/Docling converter; markdown export. Config `DoclingConfig`. |
| `DocumentLoaderBeautifulSoup` | `document_loader_beautiful_soup.py` | `['html','htm','url']` | BeautifulSoup parser for HTML; optional `header_handling` (skip/summarize/include), token-limit truncation. Config `BeautifulSoupConfig`. |
| `DocumentLoaderMarkItDown` | `document_loader_markitdown.py` | `['pdf','doc','docx','ppt','pptx','xls','xlsx','csv','tsv','txt','html','xml','json','zip','jpg','jpeg','png','bmp','gif','wav','mp3','m4a','url']` | Microsoft MarkItDown; converts to markdown. Config `MarkItDownConfig`. |

## Dependency-gated loaders

Several loaders lazy-import their provider SDK and raise a descriptive `ImportError` at construction time if missing (e.g. `DocumentLoaderPyPdf._check_dependencies` requires `pypdf`, `DocumentLoaderTesseract` requires `pytesseract`, `DocumentLoaderAWSTextract` requires `boto3`, `DocumentLoaderAzureForm` requires `azure-ai-formrecognizer`, `DocumentLoaderGoogleDocumentAI` requires `google-cloud-documentai`, `DocumentLoaderDocling` requires `docling`). This keeps optional providers installable on demand.

## Failure behavior

Loaders typically wrap their internal processing and raise `ValueError(f"Error ...: {str(e)}")` on failure (e.g. `DocumentLoaderPyPdf.load` at `document_loader_pypdf.py:152`, `DocumentLoaderSpreadSheet.load` at `document_loader_spreadsheet.py:110`). Configuration dataclasses validate their inputs and raise `ValueError` for invalid settings (e.g. `TesseractConfig` rejects invalid PSM/OEM; `AzureConfig` rejects unknown model IDs/features).
