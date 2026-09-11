---
type: change-guide
title: Change Playbooks
description: Step-by-step maintenance guides with exact code seams for adding a document loader, completion strategy, or LLM backend, tuning thinking/token budgets, extending classification, and writing contracts.
tags: [how-to, extension, loaders, backends, strategies]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
sources:
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-c68d1e2bb46b45e4043fb16a
    resource: repo://extract_thinker/models/classification_strategy.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-92ee41b85171e4663a071a13
    resource: repo://extract_thinker/models/contract.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-4a128e0c974ec840efe2df56
    resource: repo://tests/test_document_loader_pypdf.py
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# Change Playbooks

Concrete, source-verified recipes. Line references are from the current tree; re-locate them by symbol before editing.

## 1. Add a document loader

1. **Create the loader + config** next to the family in `extract_thinker/document_loader/`: subclass `CachedDocumentLoader`, declare `SUPPORTED_FORMATS` (extensions used by `_can_handle_file_path` and MIME-mapped by `check_mime_type` for streams), and add a `@dataclass XxxConfig` with `__post_init__` validation — follow `document_loader_pypdf.py` (`PyPDFConfig` at L11-34, class at L37-75) as the template. Accept both a config object and legacy kwargs in `__init__`.
2. **Lazy-import the backend SDK**: copy the `_check_dependencies()` (called from `__init__`) + `_get_*()` pattern (document_loader_pypdf.py:82-102) so missing optional packages raise `ImportError` with the pip command; do **not** add heavy/cloud SDKs to `pyproject.toml` core deps (only playwright/pillow/pypdfium2 etc. live there, pyproject.toml:7-19).
3. **Implement `load(source)`** returning `List[Dict]` pages shaped `{"content": str, "image": bytes|None}` (the shape `_map_to_universal_format` consumes, extractor.py:369-402); decorate it with `@cachedmethod(cache=attrgetter('cache'), key=... hashkey(source or source.getvalue(), self.vision_mode))` like pypdf.py:104-105. For rasterization needs, reuse the base `convert_to_images` (document_loader.py:92-132).
4. **Respect the capability hooks**: override `can_handle_vision`/`can_handle_paginate` only if the base defaults (document_loader.py:192-246) are wrong — `can_handle_paginate` gates lazy splitting in `Process.split` (process.py:232-236).
5. **Register the public surface**: import the class and config in `extract_thinker/__init__.py` and append both names to `__all__` (`__init__.py`: imports at L4-35, list at L40-89).
6. **Test it**: subclass `BaseDocumentLoaderTest` (tests/test_document_loader_base.py:7-40) which pins load/vision/cache behavior, provide the `loader` and `test_file_path` fixtures, and add focused checks like `tests/test_document_loader_pypdf.py` does (config validation, invalid file, text-extraction control).

## 2. Add a completion strategy

1. **Enum member**: add to `CompletionStrategy` (models/completion_strategy.py:4-7).
2. **Handler**: subclass `CompletionHandler` and implement `handle(content, response_model, vision, extra_content)` (completion_handler.py:5-27); copy structure from `ConcatenationHandler` (simplest, concatenation_handler.py:9-60).
3. **Wire both dispatch points** in the Extractor or the call will silently behave differently by entry path:
   - pre-load path: `extract()` → `extract_with_strategy` branches at extractor.py:495-504, selected by the check at L235-236;
   - post-message path: `_extract` branches at extractor.py:1132-1143.
4. **Test against the FORBIDDEN baseline**, mirroring `test_pagination_handler`/`test_concatenation_handler` (tests/test_extractor.py:171-233, 280-317).

## 3. Add an LLM backend

1. **Enum**: add a member to `LLMEngine` (llm_engine.py:4-11).
2. **Construction branch**: extend `LLM.__init__`'s if/elif chain (llm.py:79-96) — the current contract is: set `self.client` (DEFAULT), or `self.agent` plus a lazy import guard (PYDANTIC_AI, llm.py:85-96, 98-119). Anything unsupported raises `ValueError(f"Unsupported backend: ...")`.
3. **Request branches**: `LLM.request` (llm.py:188-201) and `raw_completion` (llm.py:300-312) both special-case PYDANTIC_AI before the litellm paths; add yours there. `load_router` currently restricts routers to `LLMEngine.DEFAULT` by name (llm.py:121-125) — revisit if your backend supports routing.
4. **Callers that gate on backends**: `Extractor.extract_batch` hard-rejects `PYDANTIC_AI` (extractor.py:972-977); decide whether your backend supports batching and update the message.
5. **Watch the enum-name trap**: stale tests reference `llm_engine.LITELLM` (tests/test_llm_backends.py:6) — when renaming/adding members, grep for old member names across tests.

## 4. Tune thinking budgets and token limits

All constants live at the top of `LLM` (llm.py:40-53): `DEFAULT_MAX_COMPLETION_TOKENS` (the single 8000 cap used unless `token_limit=` is passed, llm.py:348-355), `DEFAULT_PAGE_TOKENS`/`DEFAULT_THINKING_RATIO`/`MIN_THINKING_BUDGET`/`MAX_THINKING_BUDGET` (the `set_page_count` formula, llm.py:155-181), and `THINKING_BUDGET_TOKENS` (pre-page-count default). Per-instance override is the `token_limit` constructor parameter, applied as `min(token_limit, model_max)` in `_request_direct`/`_request_with_router`/`raw_completion`. The Extractor recomputes budgets from page counts on every extract (extractor.py:266-268, 303-314) and `Process.extract` flows through it (process.py:282-288), so a constant change here changes all call sites; timeouts are changed via `set_timeout` (llm.py:344-346). `litellm.supports_reasoning` gates whether the thinking parameter is sent at all (llm.py:255-263); models lacking it proceed with only a printed warning.

## 5. Extend classification

- **New consensus behavior**: strategies are matched inside `Process.classify_async`'s per-layer loop (process.py:102-124) against `ClassificationStrategy` members (models/classification_strategy.py:4-7); add the member plus an `elif` branch there, keeping the "layer fails → try next layer → final ValueError" contract. Threshold validation (int, 1-10) happens in `classify`/`classify_async` (process.py:74-90) — the tree path accepts floats (process.py:134-135).
- **Tree models**: extend `ClassificationNode`/`ClassificationTree` usage via `_classify_tree_async` (process.py:127-188); nodes must be identifiable by `Classification.uuid` because descent matches on uuid, not name (process.py:169-176).
- **Per-class prompt signal**: `Extractor._classify_text_only` embeds each classification's contract structure via `add_classification_structure(c)` (extractor.py:731-735) and lowercases-equals matches the reply — returned names that don't exactly correspond to a provided `Classification.name` crash with AttributeError (extractor.py:761-771); if you change matching, keep this invariant documented.
- **Vision classification** is per-candidate comparison with max-confidence selection and an `Unknown/confidence 1` fallback (extractor.py:555-607); reference images come from `Classification.image` (set via `set_image`, models/classification.py:28-31).

## 6. Write a contract and run extraction (smallest change, most common)

Contracts are plain Pydantic models — `Contract` is an empty `BaseModel` subclass (models/contract.py:1-5) and everything else (nested models, `List[...]`, `Field` descriptions, validators) is standard Pydantic v2, e.g. `tests/models/invoice.py` and `tests/critical/test_critical_extraction.py:10-37` (with a `field_validator` coercing float quantities to int). Run:

```python
from extract_thinker import Extractor, Contract, DocumentLoaderPyPdf

class InvoiceContract(Contract):
    invoice_number: str
    total_amount: float

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())   # pip install pypdf
extractor.load_llm("gpt-4o-mini")                        # litellm naming; provider key in env
result = extractor.extract("invoice.pdf", InvoiceContract)
```

(README.md:57-80; loaders outside the core dependency set must be `pip install`ed separately — see `workflow.yml` installing `pypdf` explicitly for the critical tests.) Structured field names/types are turned into prompt guidance by `add_classification_structure` (utils.py:268-330), so `Field(description=...)` and descriptive names measurably affect output; keep fields required unless partial results are wanted (the PAGINATE strategy deliberately optionals-izes everything, utils.py:247-267).

## Verification checklist (all playbooks)

- `poetry install && poetry run pytest tests/critical/` — the only suite CI runs (`.github/workflows/workflow.yml:17-26`); critical tests call real models via `groq/...` and need `GROQ_API_KEY`.
- Loader/strategy/backend-specific suites live in `tests/` and require vendor credentials; state which env var gates each new test, mirroring `TESSERACT_PATH`/`AWS_*`/`AZURE_*` usage.
- Lint/format per `.pre-commit-config.yaml`, `.ruff.toml`, `.flake8`.

## Related pages

- `core/document-loaders.md`, `core/completion-strategies.md`, `core/llm-integration.md`, `core/extractor.md`, `core/process-orchestration.md`, `operations/ci-packaging-testing.md`
