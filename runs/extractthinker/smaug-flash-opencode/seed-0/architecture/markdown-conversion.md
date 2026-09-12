---
type: concept
title: Markdown Conversion
description: The MarkdownConverter in ExtractThinker, which turns documents into Markdown, extracting structured per-page content with certainty scores and handling vision and basic fallbacks.
tags: [markdown, conversion, vision, structured]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---

# Markdown Conversion

`MarkdownConverter` (extract_thinker/markdown/markdown_converter.py:23-783)
converts documents to Markdown, optionally using an LLM for structured content
extraction. It mirrors much of the `Extractor` message-building logic to stay
consistent.

## Entry points

- `to_markdown` (markdown_converter.py:531-648): converts a document to a list
  of Markdown strings, one per page, always requiring an LLM. With a document
  loader it loads pages and converts each with the vision prompt
  (`DEFAULT_MARKDOWN_PROMPT`). Without a loader it reads the source text
  directly. If LLM conversion fails and a loader exists, it falls back to
  `_basic_to_markdown`.
- `to_markdown_structured` (markdown_converter.py:144-214): requires vision and
  returns per-page `PageContent` objects, each a list of `ContentItem`s with a
  `certainty` (1-10) and content string (markdown_converter.py:12-19). This uses
  the structured prompt `DEFAULT_PAGE_PROMPT`.
- Async variants `to_markdown_async` / `to_markdown_structured_async` wrap the
  sync methods with `asyncio.to_thread` (markdown_converter.py:771-783).

## Prompts

- `DEFAULT_PAGE_PROMPT` (markdown_converter.py:31-84): instructs the model to
  produce well-formatted Markdown followed by a JSON block with per-section
  certainty scores, and to replace image placeholders with actual content.
- `DEFAULT_MARKDOWN_PROMPT` (markdown_converter.py:86-103): Markdown-only output,
  no JSON.

## Processing

Pages are processed in parallel with a `ThreadPoolExecutor`
(markdown_converter.py:202-214, 587-600). `_process_page_with_llm`
(markdown_converter.py:340-368) always enables vision and calls
`llm.raw_completion`, parsing structured output with `extract_thinking_json`.
`_process_markdown_page` (markdown_converter.py:650-679) requests Markdown only
via `llm.request`. Failures per page are captured as `<!-- Error ... -->` HTML
comments rather than aborting the whole run.

`_build_message_content` (markdown_converter.py:254-338) adds images first, then
the `##Content` text block. When vision is active and the content contains image
extraction placeholders (e.g. `[Image content not extracted...]`), an extra
instruction `PLACEHOLDER_INSTRUCTION` is appended to guide the model
(markdown_converter.py:290-303, 105-109).

## Fallback

`_basic_to_markdown` (markdown_converter.py:681-734) and `_convert_page_basic`
(markdown_converter.py:736-769) produce Markdown without an LLM: page text plus,
in vision mode, the first image as a base64 data URI.
