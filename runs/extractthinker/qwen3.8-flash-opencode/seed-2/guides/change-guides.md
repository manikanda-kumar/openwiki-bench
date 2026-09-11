---
type: guide
title: "Change Guides"
description: "Focused maintenance recipes with exact source seams: adding a document loader, wiring a new LLM model or backend, adjusting classification/splitting prompts, adding a completion strategy, extending evaluation field comparison, and debugging a failing extraction."
tags: [guide, extension, maintenance, debugging]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-1a81c99f517b1ae3898560d0
    resource: repo://extract_thinker/document_loader/document_loader_data.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-72ce7d92abd4e848a4171b49
    resource: repo://extract_thinker/eval/evaluator.py
  - id: openwiki-source-6dca7475707e06d60e40fcef
    resource: repo://extract_thinker/eval/field_comparison.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-a2ad0cecc3781b040423f249
    resource: repo://extract_thinker/models/classification_response.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-edbd5b56a6dcbaf92b6e9ae7
    resource: repo://extract_thinker/models/doc_groups2.py
  - id: openwiki-source-d7ffb9ed5addad208802fd81
    resource: repo://extract_thinker/models/eager_doc_group.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-7e448649cb7992e07c84564f
    resource: repo://tests/test_markdown_converter.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Change Guides

Procedures below use only seams that exist in the source today. After any change, the validation loop is: run the offline loader tests first, then the API-key-dependent tests you can execute — CI itself only gates `tests/critical/` (see testing-and-ci page).

## 1. Add a new document loader

1. Subclass `CachedDocumentLoader` (recommended — the base adds a `TTLCache`; every shipped loader except the abstract base derives from it, e.g. `DocumentLoaderPyPdf(CachedDocumentLoader)`), or raw `DocumentLoader` if you manage caching yourself (`document_loader/document_loader.py:16-87`, `cached_document_loader.py:8-34`).
2. Set `SUPPORTED_FORMATS` to file extensions; base `can_handle()` matches paths by extension and `BytesIO` by `python-magic` MIME through `utils.MIME_TYPE_MAPPING` — a genuinely new format needs an entry there (`document_loader.py:49-82`, `utils.py:330-456`).
3. Implement `load(source)` returning the page-dict contract: `List[Dict]` with `"content"` text and `"image"`/`"images"` bytes when `self.vision_mode` is true (`document_loader_pypdf.py:106-151` is the reference shape). Raise `ValueError(f"Cannot handle source: {source}")` after a failed `can_handle`, matching siblings.
4. Follow house conventions: a `@dataclass` config with `__post_init__` validation for non-trivial options; lazy-import guards for optional dependencies with `ImportError` install hints; `@cachedmethod(cache=attrgetter('cache'), key=hashkey(source, self.vision_mode))` on `load` (as in the Tesseract/PyPDF loaders); override `can_handle_vision`/`can_handle_paginate` only if defaults are wrong (`document_loader.py:192-246`).
5. Export the loader and its config in `extract_thinker/__init__.py` (`__init__.py:4-37`), add a fixture-backed test mirroring `tests/test_document_loader_base.py`, and update `docs/core-concepts/document-loaders/` plus `mkdocs.yml` nav (the docs index documents the config-class/caching conventions, `docs/core-concepts/document-loaders/index.md:30-60`).

Usage-side, no extractor change is needed: `Extractor.load_document_loader()` or the extension registry makes it discoverable through `get_document_loader` (`extractor.py:73-128`).

## 2. Support a new LLM model or backend

- **Plain model on an existing provider**: no code change — model strings pass through to litellm; tests pin preferred names in `global_models.py` (`global_models.py:1-20`). For batch use, the model must also satisfy `Extractor.BATCH_SUPPORTED_MODELS` substring matching; extend that list deliberately (`extractor.py:40-45,1100-1113`).
- **Thinking-reasoning models**: behavior keys off `litellm.supports_reasoning(model)`; unsupported models silently skip the thinking parameter with a print — verify budget constants in `LLM` still fit the new model's context (`llm.py:254-263,155-181`).
- **A new backend**: add an `LLMEngine` member, a construction branch in `LLM.__init__`, and request branches in `request`/`raw_completion` (both currently special-case `PYDANTIC_AI`, `llm.py:79-96,188-201,298-312`). Remember to gate features the backend cannot provide — `extract_batch` rejects `PYDANTIC_AI` at the Extractor level as the precedent (`extractor.py:972-977`), and `load_router` raises for non-DEFAULT backends (`llm.py:121-125`).

## 3. Adjust classification prompts

Text classification is one prompt template in `Extractor._classify_text_only` (`extractor.py:722-772`); vision comparison lives in `_classify_one_image_with_ref`/`_classify_one_image_no_ref` (`extractor.py:609-720`). Whatever wording you choose, the response must keep parsing into `ClassificationResponseInternal {name, confidence: int 1..10}` — `Process`' thresholds and `CONSENSUS_WITH_THRESHOLD` are defined against that 1–10 scale (`models/classification_response.py:4-6`, `process.py:75-76`). The text path also matches the returned name against classification names (case-insensitively), so names must stay distinctive and ASCII-stable or the `None`-dereference quirk at `extractor.py:768` will surface; verify with `tests/test_classify.py`.

## 4. Adjust splitting behavior

Boundary prompts sit in `ImageSplitter`/`TextSplitter.belongs_to_same_document` and `split_eager_doc_group` (`image_splitter.py:37-222`, `text_splitter.py:15-154`). Their output is schema-parsed into `DocGroups2`/`DocGroupsEager`, so JSON keys (`belongs_to_same_document`, `classification_page1/2`, `groupOfDocuments.pages/classification`) are load-bearing. Grouping geometry lives once in the base class: `split_document_into_groups` (overlapping pairs) and `aggregate_doc_groups` (contiguous 1-based groups) — changing group semantics belongs there, not in subclasses (`splitter.py:24-92`). Keep the conservative fallbacks honest: the fallback values (`classification = classifications[0].name`, single `"unknown"` group) are what downstream `Process.extract` uses to select contracts (`process.py:253-257`). Test via `tests/test_process.py` eager/lazy chains.

## 5. Add a completion strategy

1. Add the enum member to `CompletionStrategy` (`models/completion_strategy.py`).
2. Subclass `CompletionHandler` and implement `handle(content, response_model, vision, extra_content)`, following `PaginationHandler`/`ConcatenationHandler` (`completion_handler.py:6-26`).
3. Wire it into both dispatch points: `extract_with_strategy` (`extractor.py:495-504`) and the `_extract` strategy branch (`extractor.py:1132-1143`); both currently `raise ValueError(f"Unsupported completion strategy: ...")` on miss, and `extract()` maps `IncompleteOutputException` under FORBIDDEN, so decide where truncation belongs.
4. Return a parsed `response_model` instance (the pipeline treats the handler result as the final extraction result). Add a truncating-token-limit test in the style of `tests/test_extractor.py:143-161` before trusting it.

## 6. Extend evaluation comparisons

Per-run configuration is public API: `Evaluator.set_field_comparison(field, ComparisonType, similarity_threshold, numeric_tolerance, custom_comparator)` or a `FieldComparisonConfig` passed in the constructor (`eval/evaluator.py:119-143`, `68-75`). A `ComparisonType.CUSTOM` needs a two-arg callable (`eval/field_comparison.py:14-55`). For a *new* comparison kind: add the `ComparisonType` member, an `is_match` branch plus `_..._match` implementation (fuzzy/semantic/numeric show the pattern, including optional-dependency degradation, `field_comparison.py:57-143`), and consider auto-selection in `FieldComparisonManager._initialize_defaults` which currently maps int/float fields to NUMERIC and everything else to EXACT (`field_comparison.py:163-178`). Reports embed `comparison_configs`, so summaries stay truthful without extra changes (`eval/report.py:37-40`); regression-test against `tests/test_evaluator.py`.

## 7. Debug a failing extraction

Work the pipeline in order (`extractor.py:193-335`):

1. **Loader selection**: call `get_document_loader(source)` / `loader.load(source)` directly — most "Failed to extract from source: Cannot handle source" errors are selection failures; remember list sources go to `DocumentLoaderData` and vision-only runs may silently install `DocumentLoaderLLMImage` (`extractor.py:73-126,1398-1409`).
2. **Content shape**: print the universal-mapped content; images only survive into prompts when `vision=True`, spreadsheets render through `json_to_formatted_string`, other dicts YAML-dump (`extractor.py:337-432,1184-1222`).
3. **Error identity**: read the exception text against the mapping contract — "Incomplete output received and FORBIDDEN strategy is set" means truncation/invalid JSON (raise `token_limit`, or switch to `PAGINATE`/`CONCATENATE`); a `VisionError` means a provider `BadRequestError` on a vision request; anything else is wrapped generic (`extractor.py:320-335`).
4. **Transport**: timeouts are milliseconds with a 3000 ms default and `max_retries=1` on the direct path; try `llm.load_router(...)` or `set_timeout` before blaming the model (`llm.py:40,267-296`).
5. **Stdout**: dropped pages, skipped classification layers, and unsupported thinking all appear only as `print`s.
6. **Isolation**: for a deterministic repro, bypass providers — feed pre-built page dicts (`DocumentLoaderData` path) and assert the prompt via an `LlmInterceptor`-style capture, keeping in mind `Extractor` stores per-call state (`extra_content`, `allow_vision`) so don't share one instance across concurrent variants (`extractor.py:221-224`).

Where a guide step references behavior the repository does not establish (e.g. provider-side rate limits, real-world accuracy of a prompt tweak), validate on your own stack — the in-repo tests are the only executable contract here.
