---
type: architecture
title: Architecture and Core Data Flow
description: How ExtractThinker's modular components fit together, the universal content format, and the end-to-end control flow from raw document to validated structured data.
tags: [architecture, data-flow, extractor, universal-format, interceptors]
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
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# Architecture and Core Data Flow

ExtractThinker is a document-intelligence library that turns raw files (PDFs,
images, spreadsheets, web pages, and more) into validated structured data using
LLMs. It is described in the README as "an ORM for seamless document processing
workflows" and is deliberately specialized for Intelligent Document Processing
(IDP) rather than general-purpose LLM orchestration.

## Component ownership

The package (`extract_thinker/`) is split into focused modules:

| Component | Responsibility | Primary sources |
|---|---|---|
| Document loaders | Turn a source (path, stream, URL) into a uniform list of pages with `content`/`images`/`metadata` | `document_loader/` |
| `LLM` | Wrap model access (litellm+instructor or pydantic-ai), thinking mode, dynamic parsing | `llm.py`, `llm_engine.py` |
| `Extractor` | Orchestrate loading + LLM calls to produce a validated `response_model` | `extractor.py` |
| `Contract` | Pydantic model describing the desired output schema | `models/contract.py` |
| `Classification` | Named document type + contract + optional reference image + extractor | `models/classification.py` |
| `Splitter` / `ImageSplitter` / `TextSplitter` | Group pages into documents using an LLM | `splitter.py`, `image_splitter.py`, `text_splitter.py` |
| `Process` | High-level chain: load file → split by classification → extract per group | `process.py` |
| Completion handlers | Handle very long content via pagination or concatenation | `completion_handler.py`, `pagination_handler.py`, `concatenation_handler.py` |
| `BatchJob` | OpenAI Batch API integration for async extraction | `batch_job.py` |
| `MarkdownConverter` | Convert documents to Markdown (optionally structured) | `markdown/markdown_converter.py` |
| `eval/` | Evaluation toolkit: datasets, metrics, hallucination detection, reports | `eval/` |

The public surface is re-exported from `extract_thinker/__init__.py:1-90`,
which is what downstream users import (`Extractor`, `LLM`, `Contract`,
`Process`, `Classification`, all loader classes, strategies, and
`MarkdownConverter`). Importing the package also calls
`filter_pydantic_v2_warnings()` (`extract_thinker/__init__.py:38`) to suppress a
specific Pydantic V2 config-keys warning.

## The universal content format

Every document loader normalizes its output to a list of page dictionaries.
Each page has the shape:

```python
{
    "content": str,      # extracted text for the page
    "image": bytes,      # optional, present when vision_mode is enabled
    "images": [bytes],   # optional, a list variant used by some loaders
    # plus loader-specific metadata keys (tables, forms, formulas, ...)
}
```

The `Extractor._map_to_universal_format` method (`extract_thinker/extractor.py:337-432`)
coerces several shapes into the single "universal format" consumed by the
extraction logic:

```python
{
    "content": str,          # joined text
    "images": List[bytes],   # optional, used when vision=True
    "metadata": {}
}
```

It handles content that is already in universal form, a list of page dicts, a
plain string, and the legacy dictionary format. Spreadsheet pages flagged with
`is_spreadsheet` are handled specially so sheet content is preserved.

## End-to-end control flow

A minimal successful extraction flows like this:

1. The caller configures an `Extractor` with a document loader and an LLM
   (`extractor.load_document_loader(...)` and `extractor.load_llm(...)`).
2. `extract(source, response_model, vision=...)` validates dependencies first
   (`_validate_dependencies`, `extract_thinker/extractor.py:139-157`): a
   document loader must be present unless `vision=True`, an LLM is always
   required, and `response_model` must be a `BaseModel`/`Contract` subclass.
3. The right loader is chosen. For a single source, `get_document_loader`
   (`extract_thinker/extractor.py:92-126`) prefers the primary loader, then an
   extension-based lookup in `document_loaders_by_file_type`, then any
   registered loader that `can_handle`s the source. Lists/dicts fall back to
   `DocumentLoaderData`; if `allow_vision` is set, `DocumentLoaderLLMImage` is
   the final fallback.
4. `loader.load(source)` returns the list of pages; `_map_to_universal_format`
   normalizes it (`extract_thinker/extractor.py:337-432`).
5. `_extract` (`extract_thinker/extractor.py:1115-1147`) runs `llm_interceptors`,
   builds the message content (`_build_message_content`), optionally prepends
   `extra_content`, and dispatches on the completion strategy (FORBIDDEN,
   PAGINATE, CONCATENATE).
6. `LLM.request(messages, response_model)` (`extract_thinker/llm.py:183-236`)
   performs the model call and returns a parsed `response_model` instance.
7. The caller receives the validated `Contract`/`BaseModel` result.

For a list of sources, each source is loaded and normalized, the text is merged
with `"\n\n--- Document Separator ---\n\n"`, images are merged, and page counts
are summed and pushed into the LLM via `set_page_count` before a single
extraction runs (`extract_thinker/extractor.py:239-289`).

## Vision mode

Vision mode is an extraction option (`extract(source, ..., vision=True)`)
rather than a separate pipeline. When enabled:

- `_handle_vision_mode` validates the loader and routes to vision-specific
  handling; a `ValueError` from that path is wrapped as
  `InvalidVisionDocumentLoaderError` (`extract_thinker/extractor.py:226-230`).
- Document loaders are told to include rendered page images by calling
  `set_vision_mode(True)` (base implementation `extract_thinker/document_loader/document_loader.py:41-43`).
- Loaders that support it render PDF pages to JPEG bytes (e.g. via
  `convert_to_images`), and `_map_to_universal_format` collects those bytes into
  the `images` list.
- `_build_message_content` then adds `image_url` blocks
  (`data:image/jpeg;base64,...`) alongside the text block
  (`extract_thinker/extractor.py:1149-1182`).
- Models that do not support vision surface as `litellm.BadRequestError`, which
  `classify_vision_error` re-raises as `VisionError`
  (`extract_thinker/utils.py:542-563`).

## Interceptors

`Extractor` supports two interceptor seams, registered via
`add_interceptor` (`extract_thinker/extractor.py:61-71`):

- `LoaderInterceptor` — the abstract contract defines `process(file, content)`
  (`extract_thinker/document_loader/loader_interceptor.py:1-7`). Loader
  interceptors are collected but are not invoked by the base `extract` path
  shown above.
- `LlmInterceptor` — abstract contract defines `process(messages, response)`
  (`extract_thinker/document_loader/llm_interceptor.py:1-7`). LLM interceptors
  are invoked in `_extract` before the LLM call
  (`extract_thinker/extractor.py:1122-1124`), so they can observe or mutate the
  LLM instance/request.

## Failure handling

The library layers a single public exception taxonomy:

- `ExtractThinkerError` — base exception for the library
  (`extract_thinker/exceptions.py:1-3`).
- `VisionError(ExtractThinkerError)` and
  `InvalidVisionDocumentLoaderError(VisionError)` — vision-specific failures
  (`extract_thinker/exceptions.py:5-11`).

`Extractor.extract` wraps almost all failures. With the FORBIDDEN strategy, an
`IncompleteOutputException` from instructor (or `ValidationError`/`JSONDecodeError`
signatures) is surfaced as `ExtractThinkerError("Incomplete output received and
FORBIDDEN strategy is set")` (`extract_thinker/extractor.py:320-335`). Vision
errors are classified via `classify_vision_error`; everything else is wrapped as
`ExtractThinkerError("Failed to extract from source: ...")`.

## Persistence and state

ExtractThinker is a stateless library; it does not persist documents or results
to a database. The only on-disk artifacts are:

- loader-level `TTLCache` instances (`cachetools.TTLCache`) used by
  `CachedDocumentLoader` and subclasses (`extract_thinker/document_loader/cached_document_loader.py:8-34`), keyed by source bytes + `vision_mode`.
- OpenAI batch job input/output `.jsonl` files written to
  `extract_thinker_batch/` in the current working directory, cleaned up after
  retrieval (`extract_thinker/batch_job.py:195-212`).

## Extension seams

The cleanest extension points are the ABCs: subclass `DocumentLoader`
(`load` must be implemented) to support a new format, subclass `Splitter` to
implement a new grouping strategy, subclass `CompletionHandler` to add a new
completion strategy, and subclass `LlmInterceptor`/`LoaderInterceptor` to hook
the pipeline.
