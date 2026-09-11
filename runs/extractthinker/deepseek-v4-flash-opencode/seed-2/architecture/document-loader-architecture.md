---
type: concept
title: "Document loader architecture and the page contract"
description: "The DocumentLoader abstraction: the ABC and CachedDocumentLoader, capability checks (can_handle / can_handle_vision / can_handle_paginate), vision and pagination modes, PDF/image conversion helpers, TTLCache semantics, the standard page-dict output contract, and the config-dataclass pattern."
tags: [document-loader, architecture, caching, vision, page-contract]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:31:28.803Z
---

# Document loader architecture and the page contract

Document loaders are the front door of ExtractThinker: they convert a *source* (a file path, a `BytesIO` stream, or a URL) into a normalized list of page dictionaries that the `Extractor` can serialize into an LLM prompt. Everything downstream — extraction, classification, splitting, markdown conversion — depends on this contract.

## Ownership boundary

A loader owns **bytes -> pages**. It never talks to the LLM and never knows about contracts. The `Extractor` owns loader selection and prompt building; see [extraction pipeline](extraction-pipeline.md). This separation is what lets a single `Extractor` swap OCR engines, PDF parsers, and cloud services.

## The DocumentLoader ABC

`DocumentLoader` (extract_thinker/document_loader/document_loader.py) is an abstract base class providing:

- `SUPPORTED_FORMATS`: a class-level list of file extensions.
- `can_handle(source)`: accepts a `str` path or `BytesIO`; for paths it checks the extension against `SUPPORTED_FORMATS` (`_can_handle_file_path`), for streams it uses `python-magic` MIME detection against `check_mime_type` (`_can_handle_stream`).
- `can_handle_vision(source)`: whether the source can be handled in vision mode. The base implementation accepts URLs and pdf/jpg/jpeg/png/tiff/bmp extensions for paths, and tries to open the stream as an image or PDF.
- `can_handle_paginate(source)`: whether the source supports page-based operations. The base implementation only returns `True` for `pdf` (paths) or MIME `application/pdf` (streams).
- `set_vision_mode(enabled)` / `vision_mode`: flag that loaders read when deciding whether to attach page images.
- `convert_to_images(file, scale=300/72)`: renders a source to `Dict[int, bytes]` of JPEG-encoded page images using pypdfium2 for PDFs, returns the raw file bytes `{0: ...}` for images, and — when the path is a URL — captures a full-page screenshot with Playwright (headless Chromium), optionally splitting the tall screenshot into vertical chunks (`_split_image_vertically`, default `chunk_height=1000`).
- `_resize_if_needed`: when `max_image_size` is set, resizes images with LANCZOS to fit within the maximum dimension.
- `abstractmethod load(source)`: every loader implements this and returns the page list.

Loader constructors follow a **config-dataclass pattern**: a `@dataclass` (e.g. `PyPDFConfig`, `TesseractConfig`) validates its own inputs in `__post_init__`, and the loader accepts either the dataclass or individual legacy parameters. Most loaders also check that their optional third-party dependency is importable and raise `ImportError` with install instructions.

## The page contract

`load()` returns a `List[Dict]`, one dict per page. The keys are conventions, not a single enforced schema:

- `content` — the extracted text for the page (always present).
- `image` — bytes of the rendered page, attached **only when `vision_mode` is enabled**.
- `images` — a list of image bytes used by some loaders (e.g. Mistral OCR image results, docling URLs).
- `tables` / `forms` / `signatures` / `barcodes` / `formulas` / `languages` — enriched structure extracted by cloud services such as Azure Document Intelligence and AWS Textract.
- `is_spreadsheet: True` + `name` — flags spreadsheet pages so `Extractor._map_to_universal_format` includes the sheet name and `_process_content_data` renders `data` as a table (see `DocumentLoaderSpreadSheet`).

`Extractor._map_to_universal_format` normalizes this list (and legacy dict/string shapes) into the internal `{"content", "images", "metadata"}` dict. Vision-mode attachment is how `PAGINATE` and vision extraction get their images later.

## Caching

`CachedDocumentLoader` (extract_thinker/document_loader/cached_document_loader.py) wraps `load` with a `cachetools.TTLCache(maxsize=100, ttl=cache_ttl)` keyed on `(source, vision_mode)` — a `str` source uses the path, a stream uses `source.getvalue()`. Concrete loaders typically annotate their own `load` with `@cachedmethod(cache=attrgetter('cache'), key=lambda self, source: hashkey(source if isinstance(source, str) else source.getvalue(), self.vision_mode))`. The cache is per-loader-instance, so two `Extractor`s with different loader instances do not share results. The base test class verifies that a second `load` is measurably faster and returns equal results (`tests/test_document_loader_base.py` `test_cache_functionality`).

## Capability gates downstream

These methods are the contract that higher layers rely on:

- `Extractor.get_document_loader` prefers the primary loader if it `can_handle`, then an extension-based lookup, then iterates registered loaders; if nothing matches and the source is a list/dict it returns `DocumentLoaderData()`, and if `allow_vision` it falls back to `DocumentLoaderLLMImage`.
- `Process.split` with `SplittingStrategy.LAZY` requires `document_loader.can_handle_paginate(file_path)` and raises `ValueError("Document Type does not support lazy splitting. for now only pdf is supported")` otherwise (process.py).
- `Extractor.classify(..., vision=True)` calls `document_loader.set_vision_mode(True)` before loading.

## Representative loaders

- `DocumentLoaderPyPdf` (PDF): `pypdf` for per-page text (optional password, `extract_text` flag), pypdfium2 for page images in vision mode. `can_handle_vision` additionally requires `config.vision_enabled`.
- `DocumentLoaderTesseract` (OCR): supports `jpeg/png/bmp/tiff/pdf/jpg`; renders PDF pages to images and OCRs them with up to 4 worker threads (`_process_images_parallel`); `TesseractConfig` validates PSM (0-13), OEM (0-3), and timeout; resolves the binary from `TESSERACT_PATH` when `isContainer=True` and raises if the binary is not a file.

Both are covered in [local loaders](local-loaders.md); the cloud-backed ones in [managed document intelligence](managed-document-intelligence.md). See [adding a document loader](../guides/adding-a-document-loader.md) for the change guide.