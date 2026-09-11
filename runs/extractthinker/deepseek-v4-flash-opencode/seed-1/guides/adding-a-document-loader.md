---
type: "Reference"
title: "Change Guide: Adding a Document Loader"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:16:41.841Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-4a128e0c974ec840efe2df56
    resource: repo://tests/test_document_loader_pypdf.py
generated: { by: "opencode", at: "2026-09-11T09:16:41.841Z" }
---


# Change Guide: Adding a Document Loader

This guide walks through adding a new input engine (for example a vendor OCR service or a file format) to the loader catalog. Follow the conventions used by `DocumentLoaderPyPdf` (`extract_thinker/document_loader/document_loader_pypdf.py`) and `DocumentLoaderTesseract` (`extract_thinker/document_loader/document_loader_tesseract.py`).

## 1. Choose the base class

- **Extend `CachedDocumentLoader`** (`extract_thinker/document_loader/cached_document_loader.py`) for loaders that should cache results. It wraps `load` with a `cachetools.TTLCache` keyed on `(source, vision_mode)`; decorate your `load` with `@cachedmethod(cache=attrgetter('cache'), key=lambda self, source: hashkey(source if isinstance(source, str) else source.getvalue(), self.vision_mode))` so calls share the instance cache.
- Extend `DocumentLoader` directly only if you want no caching.

Both live under `extract_thinker/document_loader/`.

## 2. Declare supported formats

Set the class attribute `SUPPORTED_FORMATS = ["ext1", "ext2", ...]` (extensions without the dot). `DocumentLoader.can_handle` then accepts a source if the file extension matches (`_can_handle_file_path`) or the sniffed MIME type matches via `check_mime_type` (`_can_handle_stream`) in `extract_thinker/utils.py`. `can_handle` returns `False` on any exception, so be permissive with formats you can actually parse.

## 3. Implement `load(source)`

`load` must return the standard page format: a `list[dict]`, where each page has at least a `"content"` text key and, when `self.vision_mode` is enabled, an `"image"` key with the page's bytes. Optional structured metadata keys (`"tables"`, `"forms"`, `"formulas"`, `"barcodes"`, `"languages"`, etc.) are supported downstream. The loader should:

1. Reject unsupported sources: `if not self.can_handle(source): raise ValueError(f"Cannot handle source: {source}")`.
2. Accept both a file path (`str`) and a `BytesIO` stream.
3. Wrap the body in `try/except` and re-raise as `ValueError` with the underlying message, following the pattern in `DocumentLoaderPyPdf.load`.
4. Only attach `"image"` when `self.vision_mode` is True (see the vision step below).

## 4. Add a config dataclass

Create a `@dataclass` config (e.g. `PyPDFConfig`, `TesseractConfig`) with validated options. Conventions:

- Validate in `__post_init__` and raise `ValueError` for invalid values (see `PyPDFConfig` rejecting `cache_ttl <= 0` and non-string passwords; `TesseractConfig` validating `psm`/`oem` against allowed sets).
- The loader constructor accepts **either** the config object **or** the legacy flat constructor arguments, building the config from them when a config isn't passed (`DocumentLoaderPyPdf.__init__` does exactly this).
- `tesseract_cmd`-style required parameters stay required; everything else gets a sane default.

## 5. Implement vision mode

- Respect `set_vision_mode(True)` by adding `"image"` bytes per page.
- Implement `can_handle_vision(source)` to report capability. If your engine has no image path, return `False`; vision callers will fall back to `DocumentLoaderLLMImage`.
- For PDFs/images, reuse the base helpers `self.convert_to_images(source)` to render pages into `{page_index: bytes}` (see `DocumentLoaderPyPdf.load`), or the OCR loaders' `_process_images_parallel` pattern.

## 6. Wire exports

Add the loader and its config to the public API in `extract_thinker/__init__.py`:

```python
from .document_loader.document_loader_new import DocumentLoaderNew, NewConfig
```

and append `"DocumentLoaderNew"` and `"NewConfig"` to `__all__`. Users then import it as `from extract_thinker import DocumentLoaderNew`.

## 7. Add tests

Test files live in `tests/` and follow the shared fixture pattern in `tests/test_document_loader_base.py`:

- `BaseDocumentLoaderTest` (`tests/test_document_loader_base.py`) provides `test_load_content_basic`, `test_vision_mode`, and `test_cache_functionality` (asserting the second load is faster). Subclass it, override the `loader` and `test_file_path` fixtures, and add loader-specific tests.
- Follow `tests/test_document_loader_pypdf.py`: a `loader` fixture returning your loader, a `test_file_path` fixture pointing at a fixture document in `tests/files/`, config-validation tests, and format-specific content assertions.
- If your loader is cloud/vendor based (like `tests/test_document_loader_aws_textract.py`), use mocks or optional credentials so tests skip cleanly when dependencies or credentials are absent.

## Verification

Run the loader tests with the repository's pytest setup (see `pyproject.toml` dev dependencies, `pytest`). At minimum:

```
pytest tests/test_document_loader_<your_loader>.py
```

and the shared base tests will run through your fixtures as well.
