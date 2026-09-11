---
type: component
title: "Document Loader Framework"
description: "The DocumentLoader abstraction: SUPPORTED_FORMATS capability detection by extension and python-magic MIME, vision-mode and page-dict output contract, PIL/pypdfium2 image conversion at 300 DPI scale, Playwright URL screenshots with vertical chunking, TTL caching in CachedDocumentLoader, and how Extractor/Process consume capabilities."
tags: [document-loaders, capability-detection, vision, caching, playwright, pdf]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-0272fd3963ebbd7912866173
    resource: repo://extract_thinker/document_loader/llm_interceptor.py
  - id: openwiki-source-35d2ee2f69deeb57b32d69a5
    resource: repo://extract_thinker/document_loader/loader_interceptor.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-4a128e0c974ec840efe2df56
    resource: repo://tests/test_document_loader_pypdf.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Document Loader Framework

All document ingestion runs through the `DocumentLoader` ABC (`extract_thinker/document_loader/document_loader.py`) and its caching subclass `CachedDocumentLoader`. The framework gives the rest of the library three things: a capability probe (`can_handle*`), a normalization helper (`convert_to_images`), and the page-dict output contract.

## Base class state

`DocumentLoader.__init__` holds `content`, a `TTLCache(maxsize=100, ttl=cache_ttl)` (default TTL 300 s), `vision_mode = False`, `max_image_size = None`, `is_url`, and `screenshot_timeout = 1000` ms, with setters `set_vision_mode`, `set_max_image_size`, `set_screenshot_timeout` (`document_loader.py:21-47`). `load()` is the abstract entrypoint; concrete loaders raise `ValueError(f"Cannot handle source: {source}")` when their own `can_handle` refuses.

## Capability detection

`can_handle(source)` never raises — any exception becomes `False` (`document_loader.py:49-66`):

- **Paths**: the file must exist, and its lowercased extension must appear in the class's `SUPPORTED_FORMATS` (`document_loader.py:68-73`). Side effect: URLs are not existing files, so `can_handle` is false for them; `can_handle_vision` deliberately accepts any URL (`document_loader.py:202-207`).
- **Streams**: `python-magic` sniffs the MIME from the buffer, the stream is rewound, and `utils.check_mime_type` maps the format's extensions through `MIME_TYPE_MAPPING` (formats may map to alias lists) (`document_loader.py:75-82`, `utils.py:330-477`).

Secondary probes: `can_handle_vision` (URL | image/PDF extensions | stream openable by PIL or `pdfium.PdfDocument`) and `can_handle_paginate` — PDF-only, extension-based for paths and `application/pdf` MIME for streams (`document_loader.py:192-246`). `Process.split` uses the latter to gate lazy splitting (`process.py:231-236`).

## Image/PDF conversion helpers

`convert_to_images(file, scale=300/72)` renders documents to `{page_index: jpeg_bytes}` (`document_loader.py:92-190`):

- a readable **string** that is a URL triggers screenshot ingestion (below); an openable image file returns `{0: raw_bytes}`; anything else is parsed by `pypdfium2.PdfDocument`;
- **streams** are tried as images (rewound after probing) else as PDFs;
- PDFs render *all* pages at once via `pdf_file.render(pdfium.PdfBitmap.to_pil, page_indices=range(len(pdf_file)), scale=...)`, i.e. the default 300/72 ≈ 300 DPI, each page JPEG-optimized;
- every rendered image passes `_resize_if_needed`, which is a no-op unless `max_image_size` is set, otherwise LANCZOS-scales to fit that maximum (`document_loader.py:152-171`).

URL ingestion uses Playwright: `_check_playwright_dependencies` raises an `ImportError` install hint (`pip install playwright` + `playwright install`), then a headless Chromium session navigates with `wait_until='networkidle'`, makes a best-effort click on an "Accept" cookie button (10 s timeout, ignored on failure), waits `screenshot_timeout` ms, and takes a full-page screenshot; failures surface as `ValueError("Failed to capture screenshot from URL: ...")`. The screenshot is optionally resized and then cut into 1000 px-tall PNG slices by `_split_image_vertically`, returned as `{0: [chunk_bytes...]}` — all URL chunks live under synthetic "page 0" (`document_loader.py:101-119,248-333`).

## Caching layer

`CachedDocumentLoader` re-declares the TTL cache and implements `load()` around a subclass-supplied call: the cache key is `(source-or-stream-bytes, vision_mode)`, so the same file loaded text-then-vision does not collide (`cached_document_loader.py:8-34`). Concrete loaders additionally decorate their own `load` with `cachetools`' `@cachedmethod(cache=attrgetter('cache'), key=lambda self, source: hashkey(..., self.vision_mode))` — e.g. Tesseract at `document_loader_tesseract.py:169-171` and PyPDF at `document_loader_pypdf.py:104-105`; all 16 concrete loaders use this decorator. Note the key uses `str(source)`-style hashing; modified-in-place files are not detected within the TTL.

## Output contract consumed upstream

Loaders return either a list of page dicts (`{"content": str, "image": bytes?, "table"?: ..., "is_spreadsheet"?: ...}`) or occasionally a universal dict; the `Extractor._map_to_universal_format` step tolerates all variants (see extraction-flow page). Consumers:

- `Extractor.get_document_loader` prefers the primary loader, then the extension registry `document_loaders_by_file_type`, then any `can_handle`-positive loader (`extractor.py:92-126`);
- `Process` keeps a parallel registry, but selects by `utils.get_image_type(file)` — a PIL-detected *image format* name — after the default loader, so its per-file-type map is effectively limited to image formats and otherwise falls through to "No suitable document loader found" (`process.py:194-199`, `utils.py:86-98`);
- `Process.load_splitter(ImageSplitter)` flips `vision_mode` on every registered loader automatically, and `Extractor.classify(..., vision=True)` toggles vision on the chosen loader (`process.py:42-63`, `extractor.py:796-801`).

## Interceptor stubs

`loader_interceptor.py` and `llm_interceptor.py` define abstract `process()` hooks; neither is invoked through `process()` anywhere (loader interceptors are collected but never called; LLM interceptors are called via a mismatched `intercept()` name — see extraction-flow wiring caveats).

## Testing conventions

`tests/test_document_loader_base.py` provides a `BaseDocumentLoaderTest` mixin (basic load, vision mode, cache-speed assertions) subclassed by 13 loader test modules; concrete subclasses add their own structure checks, e.g. `TestDocumentLoaderPyPdf` asserts `load()` returns a list of dicts with `"content"` (`tests/test_document_loader_pypdf.py:7-40`). The mixin's `test_vision_mode` expectations (a dict with an `images` map) predate the page-list convention and are overridden or satisfied only where the loader returns that shape — treat per-loader tests, not the mixin, as the contract.
