---
type: guide
title: Adding a New Document Loader
description: A focused maintenance guide for contributing a new DocumentLoader subclass in ExtractThinker, following existing conventions for config, formats, vision mode, registration, and tests.
tags: [guide, document-loaders, contribution]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---

# Adding a New Document Loader

This guide walks through adding a new `DocumentLoader` to ExtractThinker,
following the conventions used by existing providers such as Tesseract, PyPDF,
and Mistral OCR.

## 1. Base contract

Subclass `DocumentLoader` (extract_thinker/document_loader/document_loader.py:16)
the abstract base, or `CachedDocumentLoader`
(extract_thinker/document_loader/cached_document_loader.py:7) to inherit the
TTL-cache wrapper. Set `SUPPORTED_FORMATS` to the file extensions your loader
accepts (e.g. `['pdf']`), and implement `load(source)` returning a list
of page dicts with at least `content`, plus `image`/`images` when vision mode is
enabled.

`can_handle` is inherited and resolves sources by extension and MIME type
against `SUPPORTED_FORMATS`; override it only if your loader accepts sources
that aren't plain files (URLs, streams without extension).

## 2. Config dataclass

Follow the pattern of `TesseractConfig`/`PyPDFConfig`: define a `@dataclass`
holding `content`, `cache_ttl`, and your provider options, with a
`__post_init__` that validates required fields and ranges
(document_loader_tesseract.py:16-84). The loader constructor accepts either a
config object or legacy individual arguments and builds the config accordingly.
`super().__init__(config.content, config.cache_ttl)` initializes the cache.

## 3. Vision and pagination

If the loader can render page images, honor `set_vision_mode` and include
`image`/`images` in the page dicts. Use the base `convert_to_images` to render
PDFs/images (document_loader.py:92-150). Override `can_handle_vision` when
vision support differs from general support. For pagination-capable loaders,
override `can_handle_paginate` (used by lazy splitting); the base implementation
only accepts PDF.

## 4. Caching

Annotate `load` with `@cachedmethod` using a key that includes both the source
value and `self.vision_mode`, e.g. (document_loader_tesseract.py:170-172), and
set the cache attribute used by `CachedDocumentLoader`.

## 5. Register and export

Add the import and `__all__` entry in `extract_thinker/__init__.py`
(__init__.py:1-90) so users can `from extract_thinker import MyLoader,
MyLoaderConfig`.

## 6. Add tests

Add a focused test under `tests/` mirroring the existing loader tests (e.g.
`tests/test_document_loader_tesseract.py`). Note that provider-backed loaders
that require external API keys or binaries should be guarded so tests skip when
the dependency/credential is unavailable.
