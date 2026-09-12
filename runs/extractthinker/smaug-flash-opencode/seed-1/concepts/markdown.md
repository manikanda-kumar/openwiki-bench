---
type: concept
title: Markdown Conversion
description: The MarkdownConverter component that converts documents to Markdown, including structured and plain conversion modes, LLM-based vision processing, page selection, placeholder handling, and fallback behavior.
tags: [markdown, converter, vision, llm, page-content]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
sources:
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---

# Markdown Conversion

`MarkdownConverter` (`extract_thinker/markdown/markdown_converter.py:23`) transforms documents into Markdown. It requires a `DocumentLoader` (and usually an `LLM`), reusing the message-building conventions of `Extractor` but emitting human-readable Markdown rather than structured data.

## Response models

- `ContentItem` (`extract_thinker/markdown/markdown_converter.py:12`): `certainty` (int, 1–10) and `content` (str).
- `PageContent` (`extract_thinker/markdown/markdown_converter.py:17`): `items: List[ContentItem]`.

These type structured per-page content in the "structured" conversion path.

## Entry points

`MarkdownConverter(document_loader, llm)` accepts the same loader/LLM pairing as `Extractor` and exposes `load_document_loader` / `load_llm` and an `allow_verification` property.

### to_markdown_structured

`to_markdown_structured(source, pages=None)` (`extract_thinker/markdown/markdown_converter.py:144`):

- Requires an LLM (`require_llm=True`).
- Configures vision on the loader, loads pages, and requires that images were actually loaded (else `ValueError`).
- Validates the optional 1-indexed `pages` list (positive ints, within page count), converts to 0-indexed.
- Processes each page via `_process_page_with_llm` in a `ThreadPoolExecutor`; failed pages are replaced with `<!-- Error processing page N: ... -->`.
- Returns a list of `PageContent` objects.

### to_markdown

`to_markdown(source, vision=False, pages=None)` (`extract_thinker/markdown/markdown_converter.py:531`):

- Requires an LLM.
- Loads pages through the loader with vision configured to `vision`.
- Processes each via `_process_markdown_page`.
- When no loader is set, reads file/str content directly and asks the LLM with `DEFAULT_MARKDOWN_PROMPT`.
- On failure with a loader, falls back to `_basic_to_markdown`.

## Prompts

Two class-level prompt templates drive `_build_messages` via the `structured` flag:

- `DEFAULT_PAGE_PROMPT` (`markdown_converter.py:31`): asks the model to emit well-formatted Markdown **plus** a JSON block with `items` broken into logical sections with certainty scoreshare, and instructs the model to replace image placeholders with actual descriptions.
- `DEFAULT_MARKDOWN_PROMPT` (`markdown_converter.py:86`): asks for **only** the Markdown content, no JSON.

`_build_messages(message_content, structured)` (`markdown_converter.py:216`) sets the system message to one of these prompts.

## Page processing

- `_process_page_with_llm` (`markdown_converter.py:340`): sets `allow_vision = True`, builds messages from vision content, calls `self.llm.raw_completion(messages)`, and parses with `extract_thinking_json(raw_response, PageContent)`.
- `_process_markdown_page` (`markdown_converter.py:650`): sets `allow_vision = True`, builds messages with `structured=False`, calls `self.llm.request`, returns `response.choices[0].message.content`.

## Vision flag and content building

`_build_message_content(content, vision)` (`markdown_converter.py:254`):

- Images first (via `_add_images_to_message_content`, appending base64 `image_url` blocks; handles plain images, lists, and Mistral-style dicts with `base64`).
- Text via `_process_content_data` (filters image keys; formats spreadsheets).
- If vision and placeholder markers are detected (`[Image content not extracted...]` etc.), appends a `PLACEHOLDER_INSTRUCTION` telling the model what those markers mean.
- Wraps the final text in `## Content`.

## Fallback: _basic_to_markdown

`_basic_to_markdown` (`markdown_converter.py:681`) performs Markdown conversion **without an LLM**:

- Requires only a document loader.
- Loads pages, optionally validates `pages`.
- Per page, `_convert_page_basic` embeds page text plus (if vision) the first image from `images` as a base64 data-URL PNG.
- Failed pages are recorded as HTML comments.

## Async variants

- `to_markdown_structured_async(...)` (`markdown_converter.py:771`) wraps the structured call in `asyncio.to_thread`.
- `to_markdown_async(...)` (`markdown_converter.py:779`) wraps `to_markdown`.

## Dependency on the Extractor conventions

The class copies `_process_content_data`, `_convert_content_to_string`, and `_add_images_to_message_content`/`_append_images` from `Extractor` for consistency (`markdown_converter.py:370` onward).
