---
type: "Reference"
title: "Change Guides"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-c68d1e2bb46b45e4043fb16a
    resource: repo://extract_thinker/models/classification_strategy.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---


# Change Guides

These guides are written for engineers maintaining ExtractThinker. They follow
the existing code structure and test conventions; run the relevant `tests/`
suite after each change. Most non-CI tests need live LLM/cloud credentials
(`load_dotenv()` plus keys), so prefer the focused unit paths noted below when
you only need to verify mechanics.

## Adding a new document loader

A loader's job is to convert a source into the uniform list-of-pages format
(`content`/`image`/`images` + metadata) consumed by the extraction pipeline
(see [Architecture](architecture.md#the-universal-content-format)).

1. **Create the config dataclass.** Follow the existing pattern of a
   `@dataclass` config (e.g. `PyPDFConfig`,
   `extract_thinker/document_loader/document_loader_pypdf.py:8-22`,
   `AzureConfig`, `TextractConfig`). Validate inputs in `__post_init__` the way
   `PyPDFConfig` rejects non-positive `cache_ttl` and non-string `password`
   (`extract_thinker/document_loader/document_loader_pypdf.py:20-23`).
2. **Create the loader class.** Subclass `CachedDocumentLoader`
   (`extract_thinker/document_loader/cached_document_loader.py:7`) so you get
   the TTLCache for free, and:
   - define `SUPPORTED_FORMATS` as a list of lowercase extensions (e.g.
     `['pdf']` in `DocumentLoaderPyPdf`, `['txt']` in `DocumentLoaderTxt`);
   - implement `load(self, source: Union[str, BytesIO]) -> List[Dict[str, Any]]`
     returning one dict per page with at least `"content"`;
   - honor `self.vision_mode` by attaching page `image` bytes when enabled
     (see `DocumentLoaderPyPdf.load`, `extract_thinker/document_loader/document_loader_pypdf.py:97-131`);
   - override `can_handle_vision` and, if the format cannot be paged,
     `can_handle_paginate` (base implementations in
     `extract_thinker/document_loader/document_loader.py:192-246`);
   - use `@cachedmethod(cache=attrgetter('cache'), key=...)` with a key of
     `(source bytes-or-path, self.vision_mode)` exactly like the existing
     loaders so caching and vision states stay consistent.
3. **Check optional dependencies.** Loaders that depend on third-party packages
   raise a helpful `ImportError` when the dependency is missing; copy the
   `_check_dependencies()`/lazy `_get_<lib>()` pattern from
   `DocumentLoaderTesseract._check_dependencies`
   (`extract_thinker/document_loader/document_loader_tesseract.py:128-147`).
4. **Export the public name.** Add the loader (and its config) to
   `extract_thinker/__init__.py` imports and `__all__`
   (`extract_thinker/__init__.py:1-90`).
5. **Write tests.** New loader tests mirror the base contract test
   `tests/test_document_loader_base.py`: `test_load_content_basic`,
   `test_vision_mode`, and `test_cache_functionality`. Existing loader test
   files (e.g. `tests/test_document_loader_pypdf.py`,
   `tests/test_document_loader_txt.py`) provide fixtures with real test files
   under `tests/files/`.

## Adding a new classification strategy

Classification strategies decide how `Process.classify` combines the answers of
multiple extractors (`extract_thinker/process.py:74-125`).

1. **Add the enum member.** Extend `ClassificationStrategy`
   (`extract_thinker/models/classification_strategy.py`) with your strategy
   name.
2. **Implement the selection branch.** In `Process.classify_async`
   (`extract_thinker/process.py:96-122`), each layer runs its extractors
   concurrently via `asyncio.gather` of `_classify_async`, producing a list of
   `ClassificationResponse`. Existing branches:
   - `CONSENSUS` — succeeds when all names are identical;
   - `HIGHER_ORDER` — picks `max(..., key=lambda c: c.confidence)`;
   - `CONSENSUS_WITH_THRESHOLD` — consensus plus every confidence ≥ threshold.
   Add your own branch following the same shape: return on success, otherwise
   `continue` to the next extractor layer. If no layer satisfies the strategy,
   the method raises `ValueError("No consensus could be reached ...")`.
3. **Respect validation.** Both `Process.classify` and `classify_async` reject a
   non-integer `threshold` outside `1..10` with `ValueError`
   (`extract_thinker/process.py:74-90`); `_classify_tree_async` additionally
   accepts float thresholds.
4. **Test it.** `tests/test_classify.py` wires multiple extractors per layer
   with `add_classify_extractor` (e.g. `arrange_process_with_extractors`,
   `tests/test_classify.py:63-70`). Add a case that asserts your strategy picks
   the expected classification.

## Adding a new completion strategy

Completion strategies handle long documents by changing how the LLM request is
shaped. The enum lives in `extract_thinker/models/completion_strategy.py`
(`CONCATENATE`, `PAGINATE`, `FORBIDDEN`).

1. **Add the enum member** in `completion_strategy.py`.
2. **Create a handler subclass.** Extend `CompletionHandler`
   (`extract_thinker/completion_handler.py:5-27`) and implement `handle(content,
   response_model, vision, extra_content)`. `PaginationHandler` extracts each
   page in parallel and merges results with LLM-based conflict resolution;
   `ConcatenationHandler` uses `raw_completion` with retry/continuation to join
   partial JSON (see [Completion Strategies](completion-strategies.md)).
3. **Wire the dispatch.** `Extractor.extract_with_strategy`
   (`extract_thinker/extractor.py:464-504`) is the routing point used when a
   non-FORBIDDEN strategy is passed; `_extract`
   (`extract_thinker/extractor.py:1132-1143`) also dispatches on
   `self.completion_strategy`. Add a branch that constructs your handler and
   returns `handler.handle(...)`. Note the handlers are constructed with the
   extractor's `self.llm`.
4. **Verify the failure contract.** With `FORBIDDEN`, incomplete output from the
   LLM must surface as `ExtractThinkerError`; keep that invariant intact
   (`extract_thinker/extractor.py:1144-1147`).
5. **Test it.** `tests/test_extractor.py` exercises `CompletionStrategy`
   imports and extraction flows; add a focused test that passes your strategy to
   `extractor.extract(..., completion_strategy=...)` and asserts the merged
   result shape.

## Cross-cutting conventions

- **Never break the universal format.** Everything downstream (`_extract`,
  completion handlers, MarkdownConverter) expects `content`/`images`/`metadata`
  page dicts. Normalize inside `load`.
- **Keep the exception taxonomy.** Use `ExtractThinkerError` and its subclasses
  (`extract_thinker/exceptions.py`) rather than raw exceptions in public paths.
- **Cache with the vision key.** The `cachedmethod` key must include
  `self.vision_mode`, otherwise vision and text loads collide in the TTLCache.
