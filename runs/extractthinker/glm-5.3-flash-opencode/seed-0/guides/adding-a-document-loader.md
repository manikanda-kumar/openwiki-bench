---
type: change-guide
title: Change Guide — Adding a Document Loader
description: Step-by-step instructions for implementing and registering a new DocumentLoader in ExtractThinker, derived from the DocumentLoaderPyPdf reference implementation.
tags: [change-guide, document-loaders, extension, testing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-20348fa03582863679d141a9
    resource: repo://extract_thinker/eval/cli.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-4a128e0c974ec840efe2df56
    resource: repo://tests/test_document_loader_pypdf.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Change Guide: Adding a Document Loader

This guide walks through adding a new document loader, using `DocumentLoaderPyPdf` as the reference implementation. Every step below is grounded in how the existing loaders are actually built.

## 1. Choose the base class

Subclass `CachedDocumentLoader` (which itself extends the `DocumentLoader` ABC). This gives you `can_handle` detection, PDF/URL conversion helpers, vision mode, and TTL caching for free (`extract_thinker/document_loader/cached_document_loader.py:1-34`). Only subclass `DocumentLoader` directly if you intentionally want uncached behavior — note that `Process.split` and `Process.extract` each call `load()` on the same file, so caching matters there.

## 2. Define a config dataclass

Create a `@dataclass` config holding `content`, `cache_ttl`, and loader-specific options, and validate it in `__post_init__`. The PyPDF example validates that `cache_ttl` is positive and `password` is a string (`extract_thinker/document_loader/document_loader_pypdf.py:10-35`). Existing loaders also support a dual constructor — accepting either the config object or legacy keyword arguments — as `DocumentLoaderPyPdf.__init__` shows (`extract_thinker/document_loader/document_loader_pypdf.py:37-81`).

## 3. Guard dependencies

Add a `_check_dependencies()` static method that imports the loader's third-party package and raises an actionable `ImportError` ("Could not import X. Please install it with `pip install X`.") — the pattern used by PyPDF (`extract_thinker/document_loader/document_loader_pypdf.py:96-115`), Tesseract, and all cloud loaders. Call it from `__init__` so misconfiguration fails fast.

## 4. Declare `SUPPORTED_FORMATS`

Set the class attribute to the file extensions your loader accepts; `can_handle` matches extensions case-insensitively for paths and uses `python-magic` MIME detection for streams (`extract_thinker/document_loader/document_loader.py:68-83`). PyPdf declares `SUPPORTED_FORMATS = ['pdf']` (`extract_thinker/document_loader/document_loader_pypdf.py:39`).

## 5. Implement `load()`

Implement `load(source)` returning a **list of page dicts**. Requirements:

- Start by calling `self.can_handle(source)` and raising `ValueError` for unsupported sources (`extract_thinker/document_loader/document_loader_pypdf.py:118-120`).
- Every page dict must include `"content"` (use `""` when there is no text).
- When `self.vision_mode` is on, attach raw image bytes under `"image"` (or `"images"`). You can reuse the base class's `convert_to_images(source)` for PDF rendering (`extract_thinker/document_loader/document_loader_pypdf.py:150-160`).
- Wrap parsing failures in a descriptive `ValueError`.
- Decorate with `@cachedmethod(cache=attrgetter('cache'), key=lambda self, source: hashkey(..., self.vision_mode))` so cache keys include the vision-mode state (`extract_thinker/document_loader/document_loader_pypdf.py:116-119`).

If your loader can produce images, `set_vision_mode` should also update the config (as PyPdf does) and consider overriding `can_handle_vision` (`extract_thinker/document_loader/document_loader_pypdf.py:83-93`).

## 6. Export from the package root

Add both the loader class and its config to `extract_thinker/__init__.py` imports and the `__all__` list — this is how every existing loader is exposed (e.g. `DocumentLoaderPyPdf, PyPDFConfig`, `DocumentLoaderTesseract, TesseractConfig`) (`extract_thinker/__init__.py:6-36`, `extract_thinker/__init__.py:40-90`). Without this step, users cannot `from extract_thinker import YourLoader`, and the eval CLI's dynamic import by class name (`extract_thinker/eval/cli.py:63-72`) will not find it.

## 7. Write tests

Follow the established two-layer test pattern:

1. **Base contract tests**: subclass `BaseDocumentLoaderTest` and provide `loader` and `test_file_path` fixtures. The base class verifies basic loading, vision-mode behavior (images present when `can_handle_vision`, else `ValueError`), and that a second `load()` hits the cache (`tests/test_document_loader_base.py:6-47`).
2. **Loader-specific tests**: verify format-specific content, config validation errors (`pytest.raises(ValueError, match=...)`), and option toggles like `extract_text=False` (`tests/test_document_loader_pypdf.py:8-60`).

Use fixtures under `tests/files/` for test documents; note that cloud-loader tests require provider credentials and are skipped/failing without them.

## 8. Verify

Run the new test module and the broader suite locally (`poetry run pytest tests/test_document_loader_<name>.py -v`); CI runs `pytest tests/critical/` on every push/PR, so keep the critical suite green (`.github/workflows/workflow.yml`). Also run the lint/format toolchain (`ruff`, `flake8`, `black` via pre-commit) before opening a PR.

## Checklist

- [ ] Config dataclass with `__post_init__` validation
- [ ] `_check_dependencies` with actionable `ImportError`
- [ ] `SUPPORTED_FORMATS` declared
- [ ] `load()` returns page dicts with `content`, plus `image`/`images` in vision mode
- [ ] `cachedmethod` decoration including `vision_mode` in the key
- [ ] Exported from `extract_thinker/__init__.py` (`__all__` included)
- [ ] Subclass of `BaseDocumentLoaderTest` plus loader-specific tests
- [ ] Lint/format clean

## Related pages

- [Document Loaders](../document-loaders.md)
- [Extractor: Extraction and Classification Engine](../extractor.md)
- [Testing Guide](../testing.md)
