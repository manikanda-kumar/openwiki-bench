---
type: concept
title: Markdown Conversion
description: How ExtractThinker's MarkdownConverter converts documents into Markdown, optionally with structured content and certainty scores, including vision handling, prompts, page processing, and fallback behavior.
tags: [markdown, conversion, llm, structured, content]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
sources:
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---

# Markdown Conversion

The `MarkdownConverter` (`extract_thinker/markdown/markdown_converter.py`) converts a document (via a `DocumentLoader`) into Markdown, either plain (`to_markdown`) or structured (`to_markdown_structured`), using a configured LLM for layout-aware conversion. It shares message-building and image-encoding helpers with `Extractor` for consistency.

## Dependencies and entrypoints

The converter is constructed with optional `document_loader` and `llm`. `load_document_loader` and `load_llm` set them. `_validate_dependencies(require_llm=False)` raises `ValueError` if the document loader is missing, and if `require_llm` also requires an LLM (`markdown_converter.py:111-142`).

- `to_markdown(source, vision=False, pages=None) -> List[str]` (`:531-648`) — returns one Markdown string per page, requires an LLM (raises `ValueError` if absent).
- `to_markdown_structured(source, pages=None) -> List[PageContent]` (`:144-214`) — requires an LLM and vision (raises if the doc contains no images); returns structured content per page.
- `to_markdown_async` and `to_markdown_structured_async` (`:771-783`) — `asyncio.to_thread` wrappers over the synchronous methods.

## Prompts and output models

Two default prompts are embedded:

- `DEFAULT_MARKDOWN_PROMPT` (`:86-103`) — converts the image to well-formatted Markdown.
- `DEFAULT_PAGE_PROMPT` (`:31-84`) — converts the image to Markdown AND a JSON breakdown with `ContentItem` objects carrying a `certainty` (1–10) and the section `content`.

The structured output models (`:12-20`):

- `ContentItem` — `certainty: int` (1–10), `content: str`.
- `PageContent` — `items: List[ContentItem]`.

`_build_messages(message_content, structured=True)` selects the page prompt when structured, returns the multi-part message (`:216-252`).

## Page processing

Pages are processed in parallel:

- `to_markdown_structured` uses `_process_page_with_llm` (`:340-368`), which sets `allow_vision=True`, builds vision messages, and calls `llm.raw_completion`, then parses the JSON via `extract_thinking_json(raw_response, PageContent)`. Individual page failures are caught and stored as HTML-comment error markers, so other pages still complete.
- `to_markdown` uses `_process_markdown_page` (`:650-679`), which builds messages with `structured=False`, calls `llm.request(...)` without a response model, and returns `message.choices[0].message.content`.

Both accept an optional 1-indexed `pages` list to process a subset, validating that all page numbers are positive and within range.

## Vision and placeholder handling

When vision is enabled, `_build_message_content` (`:254-338`):

1. Adds images first (`_add_images_to_message_content` handles `image`/`images` keys, and Mistral-style `{'base64': ...}` dicts), encoding them to `data:image/jpeg;base64,...`.
2. Processes text content (`_process_content_data`), which for structured conversion filters spreadsheet data via `json_to_formatted_string`.
3. Detects image-extraction placeholders matching the regex `\[(?:Image content not extracted|Image processing failed|Image content extraction failed).*?\]` and, if found, appends a special formatting instruction to the LLM (`PLACEHOLDER_INSTRUCTION`) so the model fills in what visual information could not be retrieved.
4. Produces an empty-placeholder string (`[No text content available]` / `[Empty page or only content that failed processing]`) when content is unavailable.

The vision image handling in `_append_images` (`:468-527`) accommodates raw bytes, paths, PIL images, and Mistral-format dicts with base64.

## Fallback to basic conversion

`to_markdown` falls back to `_basic_to_markdown` (`:681-735`) when the LLM path raises an exception and a DocumentLoader is present. `_basic_to_markdown` requires no LLM and, per page, emits the text content plus, in vision mode, the first image as a PNG data URL (`_convert_page_basic`, `:736-769`).

## Async variants

`to_markdown_async(source, vision, pages)` and `to_markdown_structured_async(source, pages)` run the synchronous logic on a worker thread via `asyncio.to_thread`, preserving the same validation and fallback paths.
