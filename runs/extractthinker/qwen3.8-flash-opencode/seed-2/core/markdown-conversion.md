---
type: component
title: "Markdown Conversion"
description: "MarkdownConverter turns documents into Markdown: an LLM-driven structured mode returning certainty-scored PageContent, a plain Markdown mode, a no-LLM basic fallback, shared Extractor-style message building, per-page parallelism, and async wrappers."
tags: [markdown, converter, vision, prompts, parallelism]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-7e448649cb7992e07c84564f
    resource: repo://tests/test_markdown_converter.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Markdown Conversion

`MarkdownConverter` (`extract_thinker/markdown/markdown_converter.py`) is the third LLM-driven surface besides `Extractor` and the splitters. Its own docstring says the message-building helpers were "copied from the Extractor class for consistency", and indeed the vision/text message construction mirrors the extraction flow (`markdown_converter.py:21-26,446-529`). It is exported from the package root as `MarkdownConverter` and `PageContent` (`extract_thinker/__init__.py:37`).

## Two output modes plus a fallback

1. **`to_markdown_structured(source, pages=None)`** → `List[PageContent]`. The LLM is mandatory (`_validate_dependencies(require_llm=True)`, `markdown_converter.py:144-161`). It forces the loader into vision mode (warning-printing if the loader lacks `set_vision_mode`), raises `ValueError` when no page carries an `image` ("requires a document containing images"), validates 1-indexed `pages` selection against the page count, then runs one LLM request per page concurrently (`markdown_converter.py:163-214`). The per-page contract is the `DEFAULT_PAGE_PROMPT` (`markdown_converter.py:29-84`): emit well-formed Markdown preserving all original content, replacing image placeholders with descriptions, followed by a JSON block of `{"items": [{"certainty": 1-10, "content": "..."}]}` sections. The raw completion is parsed with `extract_thinking_json(..., PageContent)` — the same fenced/bare-JSON extractor the dynamic LLM mode uses (`markdown_converter.py:340-368`; `utils.py:479-540`). Model classes: `ContentItem {certainty: 1..10, content}` and `PageContent {items: List[ContentItem]}` (`markdown_converter.py:12-19`).
2. **`to_markdown(source, vision=False, pages=None)`** → `List[str]`, one Markdown string per page, in page order. The LLM is always required (`markdown_converter.py:549-551`). With a loader configured, pages are processed in a `ThreadPoolExecutor` through `_process_markdown_page`, which uses `DEFAULT_MARKDOWN_PROMPT` (Markdown only, no JSON) and returns `llm.request(messages)` content un-parsed (`markdown_converter.py:650-679`). Failed pages become embedded `<!-- Error processing page N: ... -->` strings rather than aborting the batch (`markdown_converter.py:593-602`). Without a loader it falls back to reading the source as text and issuing one Markdown prompt (`markdown_converter.py:603-638`); any exception with a loader present triggers `_basic_to_markdown` — a **no-LLM** conversion that joins page `content` and, with `vision=True`, embeds the first page image as a base64 PNG data-URL (`markdown_converter.py:681-769`).
3. List sources are explicitly unsupported: `to_markdown_structured` and `_basic_to_markdown` raise `NotImplementedError`, and loader-less `to_markdown` raises `ValueError` for lists (`markdown_converter.py:163-165,607-608,693-694`).

## Message construction shared with Extractor

`_build_messages`/`_build_message_content` reproduce the extraction conventions with the Markdown prompts substituted: a system turn carrying either prompt, then a user turn that is a joined string for text or an ordered list of `image_url` parts (base64 JPEG data URLs) plus a `## Content` text part when vision is on (`markdown_converter.py:216-338`). It adds two twists beyond the Extractor:

- **Placeholder handling**: when text contains loader-inserted markers like `[Image content not extracted...]`, a regex detects them and appends `PLACEHOLDER_INSTRUCTION` telling the model how to treat them (`markdown_converter.py:289-304`).
- **Mistral-style image dicts**: `_append_images` recognizes `{"base64": "data:image/..."}` entries from the Mistral OCR loader and strips the data-URL prefix before embedding (`markdown_converter.py:501-527`).

## Verification toggle is inert

`allow_verification` is a documented property (`markdown_converter.py:119-127`), but nothing in the conversion logic ever reads `_allow_verification` — setting it changes no behavior in the current code, and its only appearance in tests is commented out (`tests/test_markdown_converter.py:173`).

## Async wrappers

`to_markdown_structured_async` and `to_markdown_async` are `asyncio.to_thread` passthroughs to the sync methods (`markdown_converter.py:771-783`).

## Representative tests

`tests/test_markdown_converter.py` covers the matrix of loader × mode: PyPDF basic (no vision/vision), LLM conversion asserting invoice text `"0012"` survives, structured conversion asserting `PageContent` items (`test_pypdf_structured_conversion`, `tests/test_markdown_converter.py:73-91`), spreadsheet content ("Monthly Income") without vision, and Mistral OCR image/PDF/bulk conversions; tests hitting live providers are marked `@pytest.mark.slow` (`tests/test_markdown_converter.py:112-264`).
