---
type: "Reference"
title: "Change Guide for Maintainers"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-2959eb9b0f703c28af9f3dc1
    resource: repo://extract_thinker/document_loader/document_loader_txt.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-0272fd3963ebbd7912866173
    resource: repo://extract_thinker/document_loader/llm_interceptor.py
  - id: openwiki-source-35d2ee2f69deeb57b32d69a5
    resource: repo://extract_thinker/document_loader/loader_interceptor.py
  - id: openwiki-source-b027d6219be9dca2cec9b76a
    resource: repo://extract_thinker/eval/dataset.py
  - id: openwiki-source-6dca7475707e06d60e40fcef
    resource: repo://extract_thinker/eval/field_comparison.py
  - id: openwiki-source-c83661c1f2a81ba4fbc4927d
    resource: repo://extract_thinker/eval/HallucinationDetectionStrategy.py
  - id: openwiki-source-5d4b871e9c654d6fa460c740
    resource: repo://extract_thinker/eval/report.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
  - id: openwiki-source-749f08e74a04a46f1629ea04
    resource: repo://tests/test_process.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---


# Change Guide for Maintainers

This guide walks representative maintenance tasks grounded in the source. Follow the extension seams described below rather than manipulating internals.

## Adding a new document loader

A new source format joins the pipeline by implementing the `DocumentLoader` contract.

1. **Create a subclass** of `DocumentLoader` (`extract_thinker/document_loader/document_loader.py:16`) or `CachedDocumentLoader` (`extract_thinker/document_loader/cached_document_loader.py:7`) for caching reuse.
2. **Set `SUPPORTED_FORMATS`** — the list of extensions your loader handles; this drives `can_handle` (extension or MIME checks, `extract_thinker/document_loader/document_loader.py:49`).
3. **Implement `load(source)`** returning a list of page dicts with at least `content` and, when vision is active, `image`. Follow the page-dict conventions documented in `/openwiki/concepts/document_loaders.md`.
4. **Implement `can_handle_vision(source)`** describing whether vision is supported. If vision is unsupported, make `set_vision_mode(True)` raise `ValueError` (see `DocumentLoaderTxt.set_vision_mode`, `extract_thinker/document_loader/document_loader_txt.py:128`).
5. **Optional** override `can_handle_paginate` if the format supports lazy splitting.
6. **Check dependencies**: most loaders lazy-import their SDK and raise a descriptive `ImportError` in `_check_dependencies` (e.g. `DocumentLoaderPyPdf._check_dependencies`, `extract_thinker/document_loader/document_loader_pypdf.py:82`). Follow this pattern for optional providers.
7. **Provide a Config dataclass** and accept either the config object or legacy positional parameters in `__init__` (all concrete loaders follow this dual-constructor pattern, e.g. `DocumentLoaderPyPdf`).
8. **Export it** from `extract_thinker/__init__.py` so it is part of the public API (`extract_thinker/__init__.py:6-37`).

### Example: minimal loader skeleton

```python
from extract_thinker.document_loader.cached_document_loader import CachedDocumentLoader

class DocumentLoaderFoo(CachedDocumentLoader):
    SUPPORTED_FORMATS = ["foo"]
    def load(self, source):
        # source is a path or BytesIO
        pages = [...read...]
        return [{"content": text, "image": image_bytes if self.vision_mode else None} for ...]
    def can_handle_vision(self, source):
        return True
```

### Testing trick

Follow the loader unit tests in `tests/test_document_loader_*.py`; they feed real fixture files (e.g. `tests/files/invoice.pdf`) and assert the resulting page structure.

## Adding a completion strategy

1. Add a new value to `CompletionStrategy` (`extract_thinker/models/completion_strategy.py`), e.g. `MY_STRATEGY`.
2. Subclass `CompletionHandler` (`extract_thinker/completion_handler.py:5`) and implement `handle(content, response_model, vision=False, extra_content=None)` to return a validated `response_model`.
3. Register the strategy in the dispatch in `Extractor._extract` (`extract_thinker/extractor.py:1134`) and (if it needs pre-loaded content) in `extract_with_strategy` (`extract_thinker/extractor.py:464`).
4. If the strategy needs to run *before* returning a single combined response, also handle the `extract(...)` non-`FORBIDDEN` early-return path (`extract_thinker/extractor.py:235`).

`PaginationHandler` (`extract_thinker/pagination_handler.py:16`) and `ConcatenationHandler` (`extract_thinker/concatenation_handler.py:9`) are the reference implementations.

## Modifying the LLM wrapper

The `LLM` class (`extract_thinker/llm.py:39`) is the single model abstraction. Common changes:

- **Add a backend**: extend `LLMEngine` (`extract_thinker/llm_engine.py`) and branch in `LLM.__init__`/`request`/`raw_completion`.
- **Change default token limits**: constants `DEFAULT_MAX_COMPLETION_TOKENS`, `MAX_TOKEN_LIMIT`, `THINKING_BUDGET_TOKENS`, etc. (`extract_thinker/llm.py:40-53`). Document that `max_tokens` is capped by `min(token_limit, max_tokens)` (`extract_thinker/llm.py:348-356`).
- **Tune thinking budget**: `set_page_count` computes `thinking_budget` and `thinking_token_limit` (`extract_thinker/llm.py:155-181`).
- **Model fallback**: `load_router(Router)` enables per-request routing with `litellm` (`extract_thinker/llm.py:121`).

When changing request params, be aware the same params are replicated in `_request_direct` and `_request_with_router` and in `raw_completion`.

## Changing evaluation logic

The evaluation subsystem lives in `extract_thinker/eval/evaluator.py`.

- **Field-value judging**: override `FieldComparisonConfig.is_match` or add a new `ComparisonType` in `extract_thinker/eval/field_comparison.py:6`.
- **Metrics**: extend `FieldMetrics`/`DocumentMetrics`/`SchemaValidationMetrics`/`ExecutionTimeMetrics` (`extract_thinker/eval/metrics.py`).
- **Hallucination detection**: add strategies to `HallucinationDetectionStrategy` (`extract_thinker/eval/HallucinationDetectionStrategy.py`) and branch in `HallucinationDetector._detect_field_hallucination`.
- **Report shape**: extend `EvaluationReport` (`extract_thinker/eval/report.py`).
- **New dataset**: subclass `EvaluationDataset` (`extract_thinker/eval/dataset.py:8`) and implement `items()` / `__len__`.

Reference: `Evaluator.evaluate` (`extract_thinker/eval/evaluator.py:145`).

## The extension seams at a glance

| Seam | Where | Purpose |
|---|---|---|
| New document loader | subclass `DocumentLoader`/`CachedDocumentLoader` | Support a new source format |
| Interceptor hooks | `Extractor.add_interceptor` (`extract_thinker/extractor.py:61`); interfaces `LoaderInterceptor`/`LlmInterceptor` | Observe/transform before load or before LLM |
| LLM backends | `LLMEngine` + `LLM` branches | New model provider |
| Completion handlers | `CompletionHandler` subclasses | New `CompletionStrategy` |
| Evaluation datasets/comparisons | `EvaluationDataset`, `ComparisonType`, `FieldComparisonManager` | Custom eval scenarios |
| Splitters | `Splitter` subclasses | New page-grouping logic |

## Test conventions

- **Unit test per loader**: `tests/test_document_loader_*.py` use fixture files under `tests/files/` and assertion on the returned page dicts.
- **Critical tests**: `tests/critical/test_critical_*.py` exercise core classification and extraction paths.
- **Process/splitter tests**: `tests/test_process.py` verify eager/lazy splitting with both `ImageSplitter` and `TextSplitter` against `tests/files/bulk.pdf`, asserting extraction produces the expected `Contract` values.
- **LLM backend tests**: `tests/test_llm_backends.py`, `tests/test_ollama.py`.
- **Evaluation tests**: `tests/test_evaluator.py`, with labeled data under `tests/test_data/`.
- Tests read model names from `extract_thinker.global_models` (e.g. `get_lite_model()`), so swapping global models swaps the test models.

Before changing behavior, look at the corresponding `tests/test_*.py` to see the asserted contract — if your change alters an invariant those tests document, update them deliberately.
