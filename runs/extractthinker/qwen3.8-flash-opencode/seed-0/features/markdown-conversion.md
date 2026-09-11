---
type: feature
title: Markdown Conversion
description: The MarkdownConverter subsystem that turns loaded document pages into Markdown or structured PageContent via LLM prompts, with a basic non-LLM fallback.
tags: [markdown, converter, vision, fallback]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
  - id: openwiki-source-7e448649cb7992e07c84564f
    resource: repo://tests/test_markdown_converter.py
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# Markdown Conversion

`MarkdownConverter` (extract_thinker/markdown/markdown_converter.py, exported from the package root) converts documents into Markdown. It reuses the Extractor's message-building logic (the `_build_message_content`/`_add_images_to_message_content`/`_append_images` helpers are explicitly "Copied from Extractor class") but targets Markdown generation instead of contract extraction.

## Models

`ContentItem` is a single extracted piece with a `certainty` integer 1-10; `PageContent` is the list of items parsed from one page (markdown_converter.py:12-19). These are also the public surface (`MarkdownConverter, PageContent` in `__init__.py`).

## `to_markdown_structured(source, pages=None)`

The structured path (markdown_converter.py:144-214) **always requires an LLM** (`_validate_dependencies(require_llm=True)`) and forces vision: it calls `set_vision_mode(True)` on the loader, raises `ValueError` if the loader produced no page images, and rejects list sources with `NotImplementedError`. Optional `pages` is a 1-indexed filter validated against the page count. Each page goes through `_process_page_with_llm` in a `ThreadPoolExecutor` (results kept in index order; failed pages become HTML-comment error strings): the system message is `DEFAULT_PAGE_PROMPT` (markdown + a JSON block of certainty-scored items), images are embedded as base64 `image_url` parts, and `llm.raw_completion` output is parsed into `PageContent` with `extract_thinking_json` — i.e. the same think-tag/JSON-leniency parser used by dynamic LLM mode (markdown_converter.py:340-368, utils.py:479-540). `to_markdown_structured_async` is a thread wrapper (markdown_converter.py:771-777).

## `to_markdown(source, vision=False, pages=None)`

The plain-Markdown path (markdown_converter.py:531-648) also hard-requires an LLM. With a loader configured it sets loader vision mode to the `vision` value (both True→False and False→True, a deliberate fix in commit 43818af for the flag sticking after a vision run), warns if vision is enabled but no images were loaded, validates `pages`, and processes pages in parallel through `_process_markdown_page`, which sends `DEFAULT_MARKDOWN_PROMPT` ("response should ONLY include the formatted Markdown") and extracts `choices[0].message.content` from an unmodeled `llm.request`. Per-page failures become `<!-- Error processing page N -->` entries. Without a loader it reads the file/stream as text and issues a single LLM request; note that branch returns `request()`'s result directly, which — lacking the `.choices` extraction of the page path — yields the raw response object rather than a string (markdown_converter.py:603-638). Any exception in the whole method with a loader configured falls back to `_basic_to_markdown` (markdown_converter.py:640-648).

## Basic fallback

`_basic_to_markdown` (markdown_converter.py:681-769) performs no LLM calls: it loads pages (loader vision mode again following the `vision` argument) and maps each page to `content` text, appending the first `images` entry as a base64 PNG data-URI Markdown image **only when vision=True**; pages are converted in a thread pool and joined with blank lines.

## Placeholder handling

When vision content contains loader-inserted failure placeholders matching `[Image content not extracted...]`-style patterns, `PLACEHOLDER_INSTRUCTION` is appended to the text block so the model replaces placeholders with descriptions rather than echoing them (markdown_converter.py:105-109, 289-304).

## Source-observed caveats

- Both per-page processors set `self.allow_vision = True` permanently on the converter (markdown_converter.py:351, 661); once either LLM path runs on an instance, subsequent messages are built in multimodal shape even if a later call passes `vision=False` (message shape chosen at markdown_converter.py:236-252).
- `_process_content_data`'s spreadsheet branch is inverted relative to the Extractor twin: it formats `data` only when `is_spreadsheet` is explicitly False, and otherwise stringifies the whole dict minus the flag (markdown_converter.py:393-408 vs extractor.py:1209-1219).
- `allow_verification` is an exposed property with no reads anywhere in the package — an unused seam (markdown_converter.py:117-127).

## Tests

`tests/test_markdown_converter.py` covers PyPDF (vision on/off), structured conversion asserting `PageContent` items with `certainty > 9`, spreadsheets, and Mistral OCR flows (image/PDF/bulk) gated on `MISTRAL_API_KEY`/`GEMINI_API_KEY`-style credentials — all live-LLM tests, none in CI.

## Related pages

- `core/document-loaders.md` — where pages/images come from
- `core/llm-integration.md` — `request` vs `raw_completion`, `extract_thinking_json`
