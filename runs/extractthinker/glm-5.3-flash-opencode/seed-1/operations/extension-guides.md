---
type: operations-guide
title: Extension and Change Guides
description: Step-by-step change guides — adding a document loader, defining a new extraction contract, and writing a loader test that plugs into the shared base test class.
tags: [extensibility, contracts, document-loader, testing, change-guide]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-92ee41b85171e4663a071a13
    resource: repo://extract_thinker/models/contract.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-ab84285606e1ddec667b96cc
    resource: repo://tests/test_document_loader_aws_textract.py
  - id: openwiki-source-759ebcb6448249d8008d376e
    resource: repo://tests/test_document_loader_azure_document_intelligence.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-4a128e0c974ec840efe2df56
    resource: repo://tests/test_document_loader_pypdf.py
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Extension and Change Guides

Three representative maintenance tasks, with the contracts each change must satisfy.

## Guide A: Add a document loader

1. **Create the module** under `extract_thinker/document_loader/` following the naming scheme `document_loader_<name>.py`.
2. **Define the config dataclass** (e.g. `MyLoaderConfig`) with `cache_ttl: int = 300` and `__post_init__` validation that raises `ValueError` for invalid values — see `PyPDFConfig` (extract_thinker/document_loader/document_loader_pypdf.py:11-35) and `TesseractConfig` for the convention, including dual-mode construction (config object or legacy keyword args).
3. **Subclass** `CachedDocumentLoader` (or `DocumentLoader` directly if you implement your own caching) and:
   - declare `SUPPORTED_FORMATS` (extensions, lowercase); `can_handle` relies on this for path dispatch and python-magic MIME sniffing for streams (extract_thinker/document_loader/document_loader.py:49-83);
   - implement `load(source) -> List[Dict]`, one dict per page, with `"content"` as the minimum key; in vision mode add `"image": <page image bytes>`; wrap processing failures in `ValueError("Error ...: {e}")` to match the existing uniform surface (pypdf.py:151-152);
   - decorate `load` with `@cachedmethod(cache=attrgetter('cache'), key=...(hashkey(source-or-bytes, self.vision_mode)))` so repeated loads within one TTL window hit cache, matching pypdf/tesseract (document_loader_pypdf.py:104-105);
   - raise `ImportError` with the literal `pip install ...` hint in `_check_dependencies()` called at construction when the engine needs an optional package.
4. **Wire the export** in `extract_thinker/__init__.py`: import the class and its config, and add both to `__all__` so `Extractor`/users can discover it through the public façade (extract_thinker/__init__.py:1-38).
5. **Loader selection caveat**: a per-type loader participates in `Extractor.get_document_loader` only when (a) types call `set_document_loader_for_file_type` with the extension, or (b) `can_handle` probes true. On `Process`, loaders registered before `load_document_loader` conflict and raise — mind the mutually exclusive both-configs invariant (extract_thinker/process.py:31-40).

## Guide B: Define a new extraction contract

1. Subclass `extract_thinker.models.contract.Contract` (a bare pydantic `BaseModel` subclass) — but any `BaseModel` subclass works at runtime since `_validate_dependencies` accepts both (extract_thinker/models/contract.py:1-5, extract_thinker/extractor.py:156-157).
2. Declarative typing drives prompt structure and PAGINATE merging: list-typed fields get concatenated/deduplicated by `PaginationHandler._merge_list_field` using the unique-key candidates `['country', 'region', 'id', 'name']`; name your item-model key field accordingly to get semantic merging rather than raw concatenation (extract_thinker/pagination_handler.py:144-223).
3. For classification integration, contracts referenced by a `Classification` become its extraction type when the process selects the classification (extract_thinker/process.py:247-293).
4. Optional/required fields matter for FORBIDDEN vs PAGINATE: with PAGINATE, all fields are made optional for per-page calls, then revalidated at merge time — required fields are tolerated but end up dropped/"" when not found (extract_thinker/pagination_handler.py:107-126).
5. Never rely on field defaults for prompt fidelity; `_build_messages` derives structure text from `response_model` only where classification prompts include `add_classification_structure` (extract_thinker/utils.py:268).

## Guide C: Add a concrete loader test

1. Create `tests/test_document_loader_<name>.py` and subclass `BaseDocumentLoaderTest` (tests/test_document_loader_base.py:7-52) — the base class defines `loader` and `test_file_path` fixtures plus three tests: basic content load, vision mode semantics, and a cache-speed assertion (second load must be strictly faster).
2. Provide fixtures: a config fixture and a `loader` fixture instantiating the loader, and a `test_file_path` pointing at a committed fixture under `tests/files/` (see pytest fixture pattern in tests/test_document_loader_pypdf.py:7-23).
3. Add loader-specific tests (e.g. text extraction toggling, config validation, per-page shape) with exact fixture-content assertions like `assert "Universityof NewYork" in content`.
4. Note the base vision-mode test requires either an "images"-keyed dict window (`dict`, `"images"` with int keys, per-page bytes) or a `ValueError` — match what your `load` returns, and be aware many concrete loaders return page-list shapes instead, so concrete classes commonly override `test_vision_mode` (as pypdf does, tests/test_document_loader_pypdf.py:66-80).
5. Credential-dependent loaders (AWS/Azure/Google/Mistral) skip or gate via environment variables — copy the pattern from their test files; do not hard-code secrets.

## Change checklist recap

- Update the public façade exports for anything user-facing.
- Maintain the `ValueError` for user/config faults and `ValueError`-wrapping for processing failures convention.
- Reuse `cachedmethod`/TTLCache idioms and keep `vision_mode` in the cache key.
- Add a focused test exercising the changed boundary; run the test suite (see Testing and CI page).
