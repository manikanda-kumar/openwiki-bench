---
type: architecture-overview
title: ExtractThinker Architecture and Component Map
description: How ExtractThinker's Extractor, Process, document loaders, LLM layer, splitters, completion handlers, and data models fit together, and how a document flows from source to structured output.
tags: [architecture, overview, orchestration, data-flow]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-72ce7d92abd4e848a4171b49
    resource: repo://extract_thinker/eval/evaluator.py
  - id: openwiki-source-f388e22431a1a1afe07448ea
    resource: repo://extract_thinker/eval/setup.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# ExtractThinker Architecture and Component Map

ExtractThinker is a Python library for intelligent document processing (IDP): it loads documents, converts them to a common content representation, and uses LLMs to extract structured data into Pydantic models. The package name is `extract_thinker` (version 0.1.14, `pyproject.toml:1-7`).

## Ownership boundaries

The library is organized around a small set of cooperating subsystems, each owning one concern:

| Subsystem | Code | Responsibility |
|---|---|---|
| Public API surface | `extract_thinker/__init__.py` | Exports the supported API; filters Pydantic v2 config warnings at import time (`extract_thinker/__init__.py:38`) |
| Single-document orchestration | `extract_thinker/extractor.py` | `Extractor`: loader selection, extraction, classification, batch dispatch, error funneling |
| Multi-document orchestration | `extract_thinker/process.py` | `Process`: load → split → per-group extract pipeline with layered classification |
| Document ingestion | `extract_thinker/document_loader/` | `DocumentLoader` ABC, `CachedDocumentLoader`, ~17 concrete loaders, interceptor interfaces |
| LLM abstraction | `extract_thinker/llm.py`, `extract_thinker/llm_engine.py` | `LLM`: backend selection, structured output, thinking budgets, router fallback |
| Splitting | `extract_thinker/splitter.py`, `image_splitter.py`, `text_splitter.py` | Page-boundary detection via LLM comparison, eager/lazy grouping |
| Completion strategies | `extract_thinker/completion_handler.py`, `pagination_handler.py`, `concatenation_handler.py` | Alternative strategies for long-content extraction |
| Data models | `extract_thinker/models/` | `Contract`, `Classification`, responses, strategy enums, document groups |
| Batch jobs | `extract_thinker/batch_job.py` | OpenAI Batch API lifecycle wrapper |
| Evaluation | `extract_thinker/eval/` | `Evaluator`, metrics, datasets, hallucination detection, cost tracking, CLI |
| Markdown conversion | `extract_thinker/markdown/markdown_converter.py` | LLM-driven document-to-Markdown conversion with certainty scoring |

Everything is exported through the package root: `Extractor`, `Process`, `LLM`, the `DocumentLoader` base plus concrete loaders with their config dataclasses, splitters, `Contract`, `Classification`, strategy enums, `BatchJob`, and `MarkdownConverter` (`extract_thinker/__init__.py:1-90`).

## Dependency direction

Dependencies flow strictly downward from orchestrators to infrastructure:

```
Process ──▶ Extractor ──▶ DocumentLoader (ABC + concrete loaders)
   │             │
   │             ├──▶ LLM ──▶ litellm/instructor (DEFAULT) or pydantic-ai (PYDANTIC_AI)
   │             ├──▶ PaginationHandler / ConcatenationHandler ──▶ LLM
   │             └──▶ BatchJob ──▶ OpenAI Batch API
   └──▶ Splitter (ImageSplitter / TextSplitter) ──▶ LLM

eval/ ──▶ Extractor, litellm cost/token helpers
markdown_converter ──▶ DocumentLoader, LLM
models/ ──▶ pure Pydantic (no runtime dependencies)
```

- `Extractor` and `Process` never call LLM providers directly; all model traffic goes through `LLM` (`extract_thinker/extractor.py:1141`, `extract_thinker/llm.py:296`).
- Splitters own their own `LLM` instance constructed from a model string (`extract_thinker/image_splitter.py:13-15`, `extract_thinker/text_splitter.py:11-13`), separate from the Extractor's LLM.
- `models/` contains only Pydantic definitions, so it has no downstream coupling.
- The eval framework consumes a caller-supplied `Extractor` and optionally uses `litellm.completion_cost` and `litellm.token_counter` for cost metrics (`extract_thinker/eval/evaluator.py:1-14`).

## The universal content format

The central data contract is a plain dictionary that every loader's output is normalized into before extraction:

```python
{
    "content": str,          # joined page text
    "images": List[bytes],   # image bytes when vision=True
    "metadata": {}           # e.g. {"num_pages": N}
}
```

`Extractor._map_to_universal_format` builds this from loader output, handling already-universal dicts, lists of page dicts, raw strings, and a legacy dict format; it also normalizes singular `image` keys into an `images` list (`extract_thinker/extractor.py:337-432`). Concrete loaders return lists of page dicts with a `content` key and, when vision mode is on, an `image`/`images` key (for example, the Tesseract loader attaches `page_dict["image"]` only when `vision_mode` is set, `extract_thinker/document_loader/document_loader_tesseract.py:189-196`).

This format is what enables the list-merge behavior in `extract()`: multiple sources are each loaded, converted, counted for pages, and merged with a `"--- Document Separator ---"` text join plus a combined image list (`extract_thinker/extractor.py:239-289`).

## End-to-end extraction flow

For `Extractor.extract(source, response_model)`:

1. **Validation** — `_validate_dependencies` requires a document loader (unless vision mode), an LLM, and a `BaseModel`/`Contract` response model (`extract_thinker/extractor.py:139-157`).
2. **Mode setup** — vision mode configures the loader or falls back to `DocumentLoaderLLMImage` (`extract_thinker/extractor.py:1398-1409`); a non-`FORBIDDEN` completion strategy redirects to `extract_with_strategy` before the normal path (`extract_thinker/extractor.py:235-236`).
3. **Loading** — a loader is selected (see below), its `load()` returns page dicts, and the result is mapped to the universal format.
4. **Page accounting** — the page count is pushed onto the LLM via `set_page_count`, which is only consumed when thinking mode is active (`extract_thinker/extractor.py:303-314`, `extract_thinker/llm.py:155-181`).
5. **Message building** — `_build_messages` wraps content in a fixed system prompt ("You are a server API that receives document information and returns specific fields in JSON format.") and, in vision mode, appends base64 `image_url` parts (`extract_thinker/extractor.py:1332-1366`).
6. **Strategy dispatch** — `FORBIDDEN` sends a single structured request through `llm.request`; `PAGINATE`/`CONCATENATE` delegate to their handlers (`extract_thinker/extractor.py:1132-1143`).
7. **Error funneling** — failures are translated into `ExtractThinkerError`, with `IncompleteOutputException` under the `FORBIDDEN` strategy and JSON/Pydantic validation errors mapped to an "incomplete output" message, and vision-mode errors classified by `classify_vision_error` (`extract_thinker/extractor.py:320-335`, `extract_thinker/exceptions.py:1-13`).

## Process pipeline flow

`Process` handles documents that contain multiple sub-documents:

1. `load_file(path)` records the source (`extract_thinker/process.py:201-203`).
2. `split(classifications, strategy)` loads pages through the configured loader, requires at least 2 pages, then produces document groups: `EAGER` asks the splitter to group the whole document in one LLM call; `LAZY` compares consecutive page pairs and is restricted to sources where `document_loader.can_handle_paginate(...)` is true — i.e. PDFs (`extract_thinker/process.py:205-238`, `extract_thinker/document_loader/document_loader.py:223-246`).
3. `extract()` runs per-group extraction concurrently with `asyncio.gather`, matches each group's classification name to a `Classification` carrying its own `extractor` and contract, sets `extractor.set_skip_loading(True)` because group pages are already loaded, and resets it in a `finally` block (`extract_thinker/process.py:240-307`).

Classification quality is controlled by extractor *layers* (`add_classify_extractor` accepts `List[List[Extractor]]`) and three strategies: `CONSENSUS` (all extractors in a layer agree), `HIGHER_ORDER` (max confidence), and `CONSENSUS_WITH_THRESHOLD` (agreement plus per-classifier confidence ≥ threshold); if no layer produces a result, `classify_async` raises (`extract_thinker/process.py:65-125`, `extract_thinker/models/classification_strategy.py:1-5`). A `ClassificationTree` input instead walks the hierarchy level by level, enforcing the threshold at each level (`extract_thinker/process.py:127-188`).

## Loader selection and the loader registry

Both orchestrators keep a default loader plus a per-extension registry. `Extractor.get_document_loader` tries, in order: the primary loader if it `can_handle` the source; an extension-based lookup for string paths; a capability scan over all registered loaders; `DocumentLoaderData` when the source is a list or dict (the shape produced by splitting); and finally `DocumentLoaderLLMImage` when vision is allowed (`extract_thinker/extractor.py:92-126`). `Process` is stricter: the default loader wins, otherwise it looks up by image file type and returns `None` (raising later) if nothing matches (`extract_thinker/process.py:193-199`).

The `DocumentLoader` ABC owns source-type detection (file extension lists per loader, `python-magic` MIME sniffing for streams), PDF-to-image rendering through `pypdfium2` at a default 300/72 scale, headless-Chromium URL screenshots via Playwright with vertical chunking, optional vision mode, and a `TTLCache` that `CachedDocumentLoader` uses to memoize `load()` per source+vision-mode key (`extract_thinker/document_loader/document_loader.py:16-150`, `extract_thinker/document_loader/cached_document_loader.py:1-34`).

## LLM layer

`LLM` (in `extract_thinker/llm.py`) supports two backends selected via the `LLMEngine` enum (`extract_thinker/llm_engine.py:1-9`):

- `DEFAULT` — `instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)`, giving Pydantic-validated structured output (`extract_thinker/llm.py:79-84`).
- `PYDANTIC_AI` — a `pydantic_ai.Agent` created lazily with the model name; errors are surfaced as `ValueError` (`extract_thinker/llm.py:85-96`, `extract_thinker/llm.py:189-201`).

Optional features include a LiteLLM `Router` for model fallbacks (rejected on the pydantic-ai backend, `extract_thinker/llm.py:121-125`), temperature and timeout control, a "dynamic" mode that prompts for `<think>`-wrapped JSON and parses it with `extract_thinking_json` instead of using instructor (`extract_thinker/llm.py:144-236`), and thinking-mode token budgeting derived from page count: content tokens are clamped to `MAX_TOKEN_LIMIT` (120k) and the thinking budget to `[MIN_THINKING_BUDGET=1200, MAX_THINKING_BUDGET=64000]` (`extract_thinker/llm.py:42-48`, `extract_thinker/llm.py:155-181`).

## Extension seams

- **New document loader**: subclass `CachedDocumentLoader`, declare `SUPPORTED_FORMATS`, implement `load()` returning the page-dict list, add a config dataclass, and export from the package root. See the [Adding a Document Loader guide](guides/adding-a-document-loader.md).
- **New completion strategy**: extend the `CompletionStrategy` enum and either handle it in `Extractor._extract`/`extract_with_strategy` or add a `CompletionHandler` subclass.
- **New splitter**: subclass `Splitter` and implement the three abstract members; the pairwise aggregation in `Splitter.aggregate_doc_groups` is reusable (`extract_thinker/splitter.py:50-93`).
- **Model/provider choice**: any LiteLLM model string works in `LLM` and in splitters; `extract_thinker/global_models.py` holds convenience model getters used by tests/examples.

## What the repository does *not* establish

There is no persistence layer beyond the OpenAI batch JSONL files and loader TTL caches, no queueing/retry infrastructure (instructor gets `max_retries=1`, `extract_thinker/llm.py:280-283`), and no deployment configuration — the library is intended to be embedded in a host application. Runtime behavior against real LLM providers depends entirely on network access and provider keys, which the repository does not ship.

## Related pages

- [Extractor: Extraction and Classification Engine](extractor.md)
- [Process: Multi-Document Split-and-Extract Workflow](process-workflow.md)
- [Document Loaders](document-loaders.md)
- [LLM Integration Layer](llm-integration.md)
- [Quickstart](quickstart.md)
