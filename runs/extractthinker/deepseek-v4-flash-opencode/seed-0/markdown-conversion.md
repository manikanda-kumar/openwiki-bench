---
type: concept
title: Markdown Conversion
description: The MarkdownConverter — converting documents to plain or structured Markdown with an LLM, the PageContent/ContentItem models, vision-based page processing, and non-LLM fallback.
tags: [markdown, conversion, vision, llm]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
sources:
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# Markdown Conversion

`MarkdownConverter` (`extract_thinker/markdown/markdown_converter.py:31-...`)
turns documents into Markdown. It is the only component that writes Markdown as
its primary output rather than structured Pydantic data. It mirrors the
`Extractor` message-building code so conversion and extraction behave
consistently.

## Output models

- `ContentItem` (`markdown_converter.py:20-23`) — a chunk of extracted content
  with an integer `certainty` between 1 and 10.
- `PageContent` (`markdown_converter.py:26-28`) — a page's `items` list.

These are used by the structured conversion path.

## Configuration and dependency validation

`MarkdownConverter(document_loader, llm)` holds the same two dependencies as
`Extractor`, set via `load_document_loader` / `load_llm`
(`markdown_converter.py:124-131`). `_validate_dependencies(require_llm)`
(`markdown_converter.py:133-140`) requires a document loader, and an LLM when
`require_llm=True`.

`allow_verification` is a property-backed boolean flag
(`markdown_converter.py:77-83`) that toggles verification behavior on the
converter; it has no effect in the base conversion paths shown here.

## Prompts

Two system prompts drive the LLM:

- `DEFAULT_PAGE_PROMPT` (`markdown_converter.py:44-...`) — instructs the model to
  convert the image into well-formatted Markdown **and** append a JSON breakdown
  into `PageContent` items with certainty scores. Used by the structured path.
- `DEFAULT_MARKDOWN_PROMPT` (`markdown_converter.py:95-...`) — asks only for
  Markdown, with no JSON. Used by the plain path.

Both instruct the model to replace image placeholders
(e.g. `[img-1.jpeg]`) with actual descriptions rather than echoing them. When
vision processing produced placeholder text like
`[Image content not extracted...]`, `_build_message_content` detects the pattern
and appends `PLACEHOLDER_INSTRUCTION`
(`markdown_converter.py:117-...`, `271-300`) telling the model how to handle it.

## Structured conversion (`to_markdown_structured`)

`to_markdown_structured(source, pages=None)` (`markdown_converter.py:137-...`):

1. Requires an LLM (`require_llm=True`) and a single source (lists raise
   `NotImplementedError`).
2. Enables vision mode on the loader and loads pages; raises `ValueError` if no
   page contains an image (it is a vision-only operation).
3. Validates `pages` as positive integers not exceeding the page count, then
   slices the page list.
4. Processes pages concurrently with a `ThreadPoolExecutor`; each page runs
   `_process_page_with_llm` which calls `llm.raw_completion` with the
   `DEFAULT_PAGE_PROMPT` and parses the response with
   `extract_thinking_json(raw_response, PageContent)`
   (`markdown_converter.py:320-360`). Per-page failures become an HTML-comment
   error string instead of aborting the batch.

## Plain Markdown conversion (`to_markdown`)

`to_markdown(source, vision=False, pages=None)` (`markdown_converter.py:365-...`)
always requires an LLM. With a document loader, pages are loaded, optionally
sliced by `pages`, and processed in parallel via `_process_markdown_page`, which
uses the `DEFAULT_MARKDOWN_PROMPT` (structured=False) and returns the raw content
(`markdown_converter.py:430-462`). Without a document loader, the source is read
as text (path or stream) and sent to `llm.request` directly.

On any exception in the loader path, `to_markdown` falls back to
`_basic_to_markdown` (`markdown_converter.py:464-...`): a **non-LLM** conversion
that emits each page's `content` text plus, in vision mode, a base64 data-URI
image tag for the first image (`_convert_page_basic`,
`markdown_converter.py:533-...`). This means Markdown output is produced even
when the LLM path fails, provided a loader is available.

## Async wrappers

`to_markdown_async` and `to_markdown_structured_async`
(`markdown_converter.py:583-...`) run the synchronous methods in a worker thread
via `asyncio.to_thread`.

## Relationship to the rest of the pipeline

Markdown conversion is an output sink rather than a step in extraction: it is
not used by `Extractor` or `Process`. It shares the message-building and
`extract_thinking_json` machinery with the extraction path but uses
`raw_completion`/`request` directly, and it depends on the same document loaders
and `LLM` wrapper documented in [Document Loaders](document-loaders.md) and
[LLM Integration](llm-integration.md).
