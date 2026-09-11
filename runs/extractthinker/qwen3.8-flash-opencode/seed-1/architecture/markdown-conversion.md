---
type: subsystem
title: "Markdown Conversion"
description: "MarkdownConverter: LLM-driven document-to-Markdown (to_markdown) and certainty-scored structured PageContent extraction (to_markdown_structured), with parallel per-page processing and placeholder-aware prompts."
tags: [markdown, vision, llm, conversion, parallelism]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
  - id: openwiki-source-7e448649cb7992e07c84564f
    resource: repo://tests/test_markdown_converter.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Markdown Conversion

`MarkdownConverter` (`extract_thinker/markdown/markdown_converter.py`, exported as `MarkdownConverter` and `PageContent` from the package root) turns documents into Markdown. It mirrors `Extractor`'s construction idiom (`load_document_loader`, `load_llm`, `_validate_dependencies`) but targets prose rather than contract-shaped data.

## Structured conversion: `to_markdown_structured`

`to_markdown_structured(source, pages=None)` requires both an LLM and a document loader and is vision-mandatory:

- A list source raises `NotImplementedError`.
- The loader's `set_vision_mode(True)` is called if available (otherwise a warning prints and processing continues); after loading, the method raises `ValueError` if no page carries an `image`.
- Optional `pages` selects 1-indexed pages, validating positive integers and bounds before converting to 0-based slices.
- Pages are processed concurrently in a `ThreadPoolExecutor`; `_process_page_with_llm` always sets `allow_vision`, builds messages, calls `llm.raw_completion`, and parses the reply with `extract_thinking_json(..., PageContent)` — the model must emit Markdown followed by a fenced JSON block, not a bare object.
- Results are written back into an index-aligned list (order preserved); a failed page yields `None` from the LLM path, and the outer gather substitutes an HTML comment `<!-- Error processing page N: ... -->` in the slot. The declared return type is `List[PageContent]`, so callers receive a mixed list of `PageContent` objects and error strings.

`PageContent` is `{"items": [ContentItem]}` where `ContentItem` carries `certainty` (int, constrained 1–10) and `content` (str) — the per-section confidence scores requested by `DEFAULT_PAGE_PROMPT`.

## Plain conversion: `to_markdown`

`to_markdown(source, vision=False, pages=None)` requires an LLM in all configurations and returns a `List[str]`:

- **With a loader**: loader vision mode is set from `vision` (failure only warns), pages load/slice as above, and a vision run without any images just warns and proceeds text-only. Each page goes through `_process_markdown_page`, which calls `llm.request(messages)` **without a response model** and reads `choices[0].message.content` — the instructor path, since the prompt set is `DEFAULT_MARKDOWN_PROMPT` (markdown only, no JSON). Page-level failures become `<!-- Error processing page N ... -->` entries, and successful `None`s are filtered out of the returned list.
- **Without a loader**: the single str source is opened as a text file (or `.read()` for streams), and a one-shot `[system=DEFAULT_MARKDOWN_PROMPT, user=content]` exchange is sent; list sources are rejected with `ValueError`.
- **Fallback**: any exception raised while a loader is configured triggers `_basic_to_markdown` — no LLM at all: pages become `content` plus an optional base64 `![Page Image](data:image/png;base64,...)` for the first image when vision is on — and its joined string is returned as a one-element list. Without a loader the error re-raises.

## Prompting seams

Message assembly is `_build_messages(structured=)` over `_build_message_content`:

- `structured=True` uses `DEFAULT_PAGE_PROMPT` (markdown + certainty JSON + "never emit image placeholders, describe them instead"); `structured=False` uses `DEFAULT_MARKDOWN_PROMPT`.
- In vision mode images are appended as base64 `image_url` parts **before** the text block; text is filtered through `_process_content_data` (a copy of the Extractor helper with the spreadsheet branch inverted relative to the Extractor version).
- Detected extraction placeholders (regex for `[Image content not extracted...]`-style markers) cause `PLACEHOLDER_INSTRUCTION` to be appended to the text sent to the model.
- Empty pages are substituted with explicit `[No text content available]` / `[Empty page ...]` markers.

The `allow_verification` property is defined and defaults `False`, but no code path reads `_allow_verification`, and the only references in `tests/test_markdown_converter.py` are commented out — a placeholder for future verification behavior.

## Async wrappers

`to_markdown_async` / `to_markdown_structured_async` are `asyncio.to_thread` delegations to the sync methods (the async structured wrapper's docstring repeats the stale "returns raw strings" description).

## Focused tests

`tests/test_markdown_converter.py` (~330 lines) exercises both entrypoints with real models and document fixtures, covering structured vs plain output and error-comment behavior; treat it as a live-API suite.

Related: [LLM Integration](/openwiki/architecture/llm-integration.md) for `raw_completion` and `extract_thinking_json` semantics used here.
