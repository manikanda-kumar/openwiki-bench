---
type: architecture
title: "Architecture Overview"
description: "How ExtractThinker's components (Extractors, Document Loaders, LLM layer, Process orchestration) own the path from a source document to a validated Pydantic result."
tags: [architecture, overview, data-flow, core]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Architecture Overview

ExtractThinker is a Python library (`extract_thinker`, versioned in `pyproject.toml`) that turns arbitrary document sources into structured Pydantic objects by combining pluggable document loaders with an LLM request layer. The package's public surface is declared once in `extract_thinker/__init__.py`, which re-exports `Extractor`, `Process`, `LLM`, the abstract `DocumentLoader`, `CachedDocumentLoader`, roughly seventeen concrete loaders (each paired with a `*Config` dataclass), the splitters, the classification/strategy models, `BatchJob`, and `MarkdownConverter`.

## Component ownership

| Component | Owns | Lives in |
|---|---|---|
| `Extractor` | Loader selection, content normalization, prompt/message building, extraction/classify/batch orchestration, error wrapping | `extract_thinker/extractor.py` |
| `DocumentLoader` subclasses | Turning a file path, stream, or URL into a list of page dicts; capability detection; TTL caching; image rendering | `extract_thinker/document_loader/` |
| `LLM` | Model invocation via `instructor` + `litellm` (default backend) or a `pydantic-ai` agent, token budgets, thinking mode, routers | `extract_thinker/llm.py` |
| `Process` | Multi-document workflows: classification across extractor layers, splitting into doc groups, per-group extraction | `extract_thinker/process.py` |
| `Splitter` (Image/Text) | Deciding document boundaries between pages via LLM calls | `extract_thinker/splitter.py`, `image_splitter.py`, `text_splitter.py` |
| Completion handlers | PAGINATE / CONCATENATE long-output strategies | `pagination_handler.py`, `concatenation_handler.py` |
| `eval` subpackage | Benchmarking extractors: datasets, field comparison, metrics, hallucination scores, reports, CLI | `extract_thinker/eval/` |

The contracts themselves (`Contract`, `Classification`, strategy enums, doc-group models) are plain Pydantic/dataclass containers in `extract_thinker/models/` with no behavior of their own; they are shared vocabulary passed between components (see [Contracts & Shared Models](/openwiki/architecture/contracts-and-models.md)).

## End-to-end extraction flow

`Extractor.extract(source, response_model, vision, content, completion_strategy)` is the central pipeline:

1. **Validate** — `_validate_dependencies` requires an LLM, a document loader (unless vision), and a `BaseModel`/`Contract` subclass.
2. **Select a loader** — `get_document_loader` prefers the primary loader if `can_handle` passes, then an extension-keyed lookup in `document_loaders_by_file_type`, then any registered loader whose `can_handle` matches; list/dict sources fall back to `DocumentLoaderData`, and vision-enabled runs with no loader fall back to `DocumentLoaderLLMImage`.
3. **Normalize to universal format** — `_map_to_universal_format` reduces every loader output to `{"content": str, "images": List[bytes], "metadata": {...}}`; a list of loader pages is joined with blank lines and its `metadata.num_pages` set to the page count, and image bytes are collected only in vision mode.
4. **Merge multi-source input** — when `source` is a list, each entry is loaded and mapped separately, total pages are summed (from `metadata.num_pages` or 1 each) and pushed into `llm.set_page_count`, then texts are joined with a `\n\n--- Document Separator ---\n\n` marker and image lists are concatenated into one merged document before a single `_extract` call.
5. **Request** — `_extract` runs registered `LlmInterceptor`s, builds a two-message conversation (fixed system prompt plus a `##Content` user message, with images inlined as base64 data URLs under `allow_vision`), optionally prepends caller `extra_content` as a second user message, and then dispatches on the completion strategy: `FORBIDDEN` issues one `llm.request(messages, response_model)` call (instructor validates the JSON against the model), `PAGINATE` and `CONCATENATE` delegate to their handlers.
6. **Wrap failures** — everything that escapes is converted to `ExtractThinkerError`; `ValidationError`/`JSONDecodeError` (including string-matched variants) and instructor's `IncompleteOutputException` become "Incomplete output received and FORBIDDEN strategy is set", while vision-mode `litellm.BadRequestError`s are reclassified by `classify_vision_error` into `VisionError`.

The `LLM` layer behind step 5 defaults to `instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)`; the `PYDANTIC_AI` backend instead builds a `pydantic_ai.Agent` and collapses messages into a single prompt at request time. LiteLLM routers (model fallbacks) are accepted only on the default backend.

## Vision and page-count plumbing

Two cross-cutting signals shape requests:

- **Vision mode.** When `extract(vision=True)`, `_handle_vision_mode` either flips `set_vision_mode(True)` on the configured loader or creates a `DocumentLoaderLLMImage` (which always renders pages to JPEG/PNG bytes via `convert_to_images`, including Playwright full-page screenshots for URL sources); a `ValueError` there is raised as `InvalidVisionDocumentLoaderError`.
- **Page count.** Before each request the pipeline computes a page count (from loader metadata, list merging, or source count for batches) and calls `LLM.set_page_count`, which derives the thinking token budget as `page_count * 1500 / 3`, clamped between 1200 and 64000 tokens and capped against a 120000-token content limit. The budget only affects requests when thinking is enabled.

## Process-level orchestration seam

`Process` composes the same pieces for multi-document files: `load_splitter` propagates `set_vision_mode` to all configured loaders, `split` loads pages once and delegates to `Splitter.split_eager_doc_group`/`split_lazy_doc_group`, and `extract` slices the loaded pages per doc group and passes them to `Extractor.extract_async` with `set_skip_loading(True)` — the flag that makes `extract` feed a list of pages straight into `_map_to_universal_format` instead of invoking a loader again. Classification (`classify` / `_classify_tree_async`) fans out across `extractor_groups` layers with consensus/threshold strategies and is covered in [Classification & Splitting (Process)](/openwiki/architecture/classification-and-splitting.md).

## Where to go next

- Loader contract and concrete formats: [Document Loaders](/openwiki/architecture/document-loaders.md)
- Request building and failure wrapping in depth: [Extractor Core](/openwiki/architecture/extractor.md)
- Backends, thinking budgets, dynamic parsing: [LLM Integration](/openwiki/architecture/llm-integration.md)
