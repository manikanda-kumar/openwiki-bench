---
type: change-guide
title: "How to Add a Document Loader"
description: "Step-by-step change guide: implement a Config dataclass and CachedDocumentLoader subclass returning the page-dict format, register exports, route it in Extractor/Process, and test it."
tags: [document-loaders, extension, guide, testing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-672aaa160239e06162bf2ee0
    resource: repo://extract_thinker/document_loader/document_loader_spreadsheet.py
  - id: openwiki-source-2959eb9b0f703c28af9f3dc1
    resource: repo://extract_thinker/document_loader/document_loader_txt.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-a6f692d25c6d9ff8f733af5d
    resource: repo://tests/test_document_loader_txt.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# How to Add a Document Loader

This guide adds a new loader the way the existing ~17 loaders are built. Worked reference: `extract_thinker/document_loader/document_loader_txt.py` (simplest full example) and `document_loader_spreadsheet.py` (external-dependency example).

## 1. New module and Config dataclass

Create `extract_thinker/document_loader/document_loader_<name>.py`. Note the package has **no `__init__.py`** — imports always use the full module path. Define a `@dataclass <Name>Config` following the established idiom:

- fields with sane defaults (`content: Optional[Any] = None`, `cache_ttl: int = 300`, then format-specific options);
- `__post_init__` that *raises `ValueError`* on invalid values — e.g., `TxtConfig` rejects `cache_ttl <= 0` and non-string `encoding` (`document_loader_txt.py:29-35`); `TesseractConfig` validates enumerated ranges (`document_loader_tesseract.py:48-70`).

## 2. The loader class

Subclass `CachedDocumentLoader` (not the raw ABC) to inherit the TTL cache; the base class itself leaves `load` abstract. Then:

1. **Class attributes**: `SUPPORTED_FORMATS = [...]` — lowercase extensions without dots. This drives `can_handle` for paths and mime checking for streams.
2. **Dual constructor**: accept either the Config object or scalar parameters, mirroring `DocumentLoaderTxt.__init__` — `if isinstance(first_arg, XConfig): self.config = first_arg else: build it` — then `super().__init__(self.config.content, self.config.cache_ttl)`.
3. **Vision stance**: for non-vision formats pin `self.vision_mode = False` and override `can_handle_vision` to `False` and `set_vision_mode(enabled)` to raise `ValueError` when enabled (txt idiom, `document_loader_txt.py:74,124-131`). For vision-capable formats, inherit the base `set_vision_mode` and use `self.vision_mode` in `load` to decide whether to attach `"image"` bytes (render via the inherited `convert_to_images`).
4. **`load()`**: decorate with the standard cache key so re-reads are instant and cache invalidates on mode flips:

   ```python
   @cachedmethod(cache=attrgetter('cache'),
                 key=lambda self, source: hashkey(source if isinstance(source, str) else source.getvalue(), self.vision_mode))
   ```

   Start with `if not self.can_handle(source): raise ValueError(...)`; return the page-dict contract — a `List[Dict]` where each page has `"content": str` and optional `"image": bytes` (`document_loader_txt.py:78-122`). Wrap internal failures in `ValueError(f"Error loading ...: {str(e)}")`. Spreadsheet-style payloads add `is_spreadsheet`/`sheet_name` keys, which `Extractor._map_to_universal_format` surfaces as `Sheet:` lines and `_process_content_data` renders via `json_to_formatted_string`.
5. **Heavy optional dependencies**: never import at module top-level. Follow `document_loader_spreadsheet.py:26-42`: a `_check_dependencies()` called from `__init__` plus a lazy `_get_<pkg>()`, each raising `ImportError` naming the exact `pip install` command.

## 3. Routing consequences

Your loader becomes selectable through existing mechanisms with no Extractor changes:

- **Extension map (Extractor)**: callers register `extractor.document_loaders_by_file_type[".<ext>"] = loader` — `Extractor.get_document_loader`/`get_document_loader_for_file` look up `os.path.splitext(source)` results, which **include the leading dot** (`extractor.py:75-77,107-109`).
- **Capability path**: `can_handle` streams rely on `utils.check_mime_type`, so a brand-new file format needs its mime added to `MIME_TYPE_MAPPING` in `extract_thinker/utils.py:330-456` to be stream-routable.
- **Process routes by detected image type**, not extension (`get_image_type` is PIL format), so per-file-type `Process` loaders are only reachable for formats PIL recognizes (`process.py:194-199`).
- **Lazy splitting** works only when you keep or extend `can_handle_paginate` semantics (PDF-only in the base class).

## 4. Register the export

Add both classes to `extract_thinker/__init__.py` imports and the `__all__` list (pattern at lines 4-36 / 40-90), otherwise `from extract_thinker import DocumentLoaderMyFormat` fails and docs examples break.

## 5. Tests

Create `tests/test_document_loader_<name>.py`: subclass `BaseDocumentLoaderTest` from `tests/test_document_loader_base.py`, providing the `loader` and `test_file_path` fixtures the inherited tests consume (see `tests/test_document_loader_txt.py:8-24`), then add format-specific assertions on returned page content and Config validation errors. **Caveat found in the base suite**: `test_vision_mode` asserts the legacy dict-with-`images` result shape and calls `set_vision_mode(True)` unconditionally (`test_document_loader_base.py:20-34`) — non-vision loaders that raise in `set_vision_mode` (like TXT) and list-returning loaders need an override of that test rather than inheritance. Run `pytest tests/test_document_loader_<name>.py` to validate offline.

## 6. Docs site (optional)

The mkdocs documentation mirrors each concept under `docs/core-concepts/document-loaders/` and is listed in `mkdocs.yml` nav; add a page there and a nav entry when a loader ships, matching existing per-loader docs.

Related: [Document Loaders](/openwiki/architecture/document-loaders.md) for behavioral details of the hierarchy you are extending; [Testing, CI & Release](/openwiki/operations/testing-ci-release.md) for what CI does and does not run.
