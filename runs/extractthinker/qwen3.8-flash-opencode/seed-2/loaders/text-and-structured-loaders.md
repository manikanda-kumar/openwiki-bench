---
type: integration
title: "Text and Structured-Format Loaders"
description: "Non-OCR document loaders: PyPDF and PdfPlumber PDF text/tables, Txt, Doc2txt Word, Spreadsheet sheets, BeautifulSoup web/HTML, MarkItDown and Docling multi-format converters, and the DocumentLoaderData passthrough — page-dict shapes, configs, and the shared lazy-dependency pattern."
tags: [document-loaders, pdf, spreadsheet, html, docling, markitdown, data]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-08a4573fafce761770cd8690
    resource: repo://extract_thinker/document_loader/document_loader_beautiful_soup.py
  - id: openwiki-source-1a81c99f517b1ae3898560d0
    resource: repo://extract_thinker/document_loader/document_loader_data.py
  - id: openwiki-source-0da9b8d49bc56592f18b2325
    resource: repo://extract_thinker/document_loader/document_loader_doc2txt.py
  - id: openwiki-source-2f495aad52dcc8e8ff83d945
    resource: repo://extract_thinker/document_loader/document_loader_docling.py
  - id: openwiki-source-37b0d6a9d3960991060f574f
    resource: repo://extract_thinker/document_loader/document_loader_markitdown.py
  - id: openwiki-source-67a2c4f10acd4e83de86b47f
    resource: repo://extract_thinker/document_loader/document_loader_pdfplumber.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-672aaa160239e06162bf2ee0
    resource: repo://extract_thinker/document_loader/document_loader_spreadsheet.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-2959eb9b0f703c28af9f3dc1
    resource: repo://extract_thinker/document_loader/document_loader_txt.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-0bb2d607395087d4b60226f1
    resource: repo://tests/create_test_spreadsheet.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Text and Structured-Format Loaders

These loaders produce text (and table/sheet structures) without an OCR engine or cloud document-AI service. Two conventions apply to all of them:

- **Lazy optional dependencies.** Except for the pure-Python pypdfium path, each loader defers its heavy import (`pypdf`, `pdfplumber`, `docx2txt`, `openpyxl`, `bs4`+`requests`, `markitdown`, `docling`, `numpy`/`pandas` for sheet rendering) behind `_check_dependencies`/`_get_*` guards that raise `ImportError` with a `pip install` hint — `document_loader_tesseract.py:148-170` shows the canonical form. Core `pyproject.toml` deliberately keeps them out.
- **Page-dict output.** `load()` returns `List[Dict]`; `"content"` is the text; loaders that can render set `"image"` under `vision_mode`, and refuse it via `can_handle_vision() -> False` when they cannot (Txt `:124-126`, Spreadsheet `:119-121`, Doc2txt, Txt `set_vision_mode` warnings).

## PDF text loaders

- **`DocumentLoaderPyPdf`** (`document_loader_pypdf.py`): `pdf`-only. `PyPDFConfig` carries `password` and `extract_text`; pages are `{"content": extracted or ""}`, and vision mode renders every page to JPEG through the base `convert_to_images` and injects `image` (`:106-151`).
- **`DocumentLoaderPdfPlumber`** (`document_loader_pdfplumber.py`): `pdf`-only. `PDFPlumberConfig(table_settings, extract_tables=True, vision_enabled)`; pages add a `"tables"` key of `List[List[List[str]]]` cell grids next to `content`, with optional `image` in vision mode (`:12-163`).

## Plain text and Word

- **`DocumentLoaderTxt`** (`document_loader_txt.py`): `txt` only. `TxtConfig(encoding='utf-8', preserve_whitespace, split_paragraphs)`; by default the file is one page, and with `split_paragraphs` it splits on `\n\n` producing pseudo-pages `{"content": ...}` (`:78-121`).
- **`DocumentLoaderDoc2txt`** (`document_loader_doc2txt.py`): `doc`/`docx` via `docx2txt.process`, then splits text on a configured `page_separator` into page dicts (`:105-143`). It also overrides `can_handle` for its extension list (`:143-161`).

## Spreadsheets

`DocumentLoaderSpreadSheet` (`document_loader_spreadsheet.py`) supports xls/xlsm/xlsb/odf/ods/odt/csv (openpyxl-driven; note the workbook path uses `openpyxl.load_workbook(..., data_only=True)` so computed values, not formulas, are read). Each **sheet becomes a pseudo-page**: `{"content": " | ".join per row, "image": None, "name": sheet_name, "is_spreadsheet": True}`, empty rows skipped (`:57-110`). Downstream, `Extractor` special-cases that flag: `_map_to_universal_format` guards that the sheet name appears in the text (`extractor.py:381-387`), prompt rendering formats `data` via `json_to_formatted_string` instead of YAML (`extractor.py:1215-1216`), and batch input builds `{"data", "is_spreadsheet"}` (`extractor.py:1420-1425`). The loader also carries pandas/matplotlib-based `convert_to_image`/`convert_to_pdf` helpers for rendering sheets visually, while `can_handle_vision` stays `False` (`:119-291`). Tests use `tests/create_test_spreadsheet.py` fixtures.

## Web and multi-format converters

- **`DocumentLoaderBeautifulSoup`** (`document_loader_beautiful_soup.py`): formats `html`, `htm`, `url`; `can_handle` is overridden so URLs always qualify (`:261-264`). `BeautifulSoupConfig` validates `header_handling ∈ {skip, summarize, include}`, positive `max_tokens`/`request_timeout`, parser, and `remove_elements` (default strips `script/style/nav/footer`). `load()` fetches URLs with `requests.get(source, timeout=10)` — note the literal 10 overrides the configured `request_timeout` at this call site (`:219-260`) — decodes files/streams, and `process_html()` converts to text truncated to `max_tokens` via `num_tokens_from_string` (`:135-208`). Vision is rejected.
- **`DocumentLoaderMarkItDown`** (`document_loader_markitdown.py`): the broadest list — pdf, Office docs, csv/tsv, txt, html/xml/json, zip, images, and audio formats (`:63-68`). It runs Microsoft MarkItDown and returns either one page (`{"content": text_content, "image": None}`, plus `images` from URL rasterization when configured) or pages split on `config.page_separator` (`:170-253`).
- **`DocumentLoaderDocling`** (`document_loader_docling.py`): supports the Word/PowerPoint/Excel families, pdf, html/xhtml, markdown, AsciiDoc, images, xml/nxml, txt, and URLs (`:104-128`), with `DoclingConfig` exposing converter options. Pages carry `content` (and per-page markdown export, `:95-101`); URL sources collapse to a single page with `document.export_to_markdown()` (`load`, `:217-264`). Docling is the loader used by the docs/URL extraction tests and the multi-source extraction test (`tests/test_extractor.py:382-437`).

## `DocumentLoaderData` — the passthrough adapter

`DocumentLoaderData` (`document_loader_data.py`) is the "universal-format" loader rather than a format parser: `can_handle` accepts any string, readable stream, list-of-dicts, or dict, and `load()` returns pre-formatted `{"content", "image"}` page lists validated/normalized by `_validate_and_format_list`, wraps raw strings, reads streams to text, or passes dicts through (`:21-147`). It is what `Extractor.get_document_loader` selects for list/dict sources (post-split content, evaluator data) and auto-installs for dict sources (`extractor.py:118-120,218-219`), with a `supports_vision` config flag. Because it accepts any extension-less string, an *invalid file path* string reaches a real loader first — but if `DocumentLoaderData` ends up handling a nonexistent path, its `_load_from_string` treats the path as literal text content rather than erroring; this is the reason `vision=True` tests see different failures than text tests (compare `tests/test_extractor.py:131-140`).

## Testing

Per-loader suites mirror the formats: `tests/test_document_loader_pypdf.py`, `_pdfplumber.py`, `_txt.py`, `_word.py`, `_spreadsheet.py`, `_beautifulsoup.py`, `_markitdown.py`, `_docling.py`, `_data.py`, each subclassing the `BaseDocumentLoaderTest` mixin and adding format-specific assertions; spreadsheet fixtures are generated by `tests/create_test_spreadsheet.py`.
