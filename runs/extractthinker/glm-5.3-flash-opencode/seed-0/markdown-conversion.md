---
type: markdown-conversion
title: Markdown Conversion
description: MarkdownConverter turns documents into LLM-generated Markdown — plain or structured with per-item certainty scores — with parallel per-page processing and message building copied from Extractor.
tags: [markdown, conversion, llm, vision]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
  - id: openwiki-source-7e448649cb7992e07c84564f
    resource: repo://tests/test_markdown_converter.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Markdown Conversion

`MarkdownConverter` (in `extract_thinker/markdown/markdown_converter.py`) converts documents into Markdown using an LLM. It is exported as part of the public API together with its `PageContent` model (`extract_thinker/__init__.py:37`).

## Two output modes

- **`to_markdown(source, vision=False, pages=None)` → `List[str]`** — one Markdown string per page. Requires an LLM; with a document loader it sets vision mode per the `vision` flag, loads pages, validates optional 1-indexed `pages` selections (non-positive or out-of-range values raise `ValueError`), and processes pages in parallel with a `ThreadPoolExecutor`; a failed page becomes an HTML comment `<!-- Error processing page N: ... -->` rather than aborting the run (`extract_thinker/markdown/markdown_converter.py:531-620`). Without a loader, it reads text sources directly (file path or file-like object) and multiple sources raise `ValueError` (`extract_thinker/markdown/markdown_converter.py:621-650`).
- **`to_markdown_structured(source, pages=None)` → `List[PageContent]`** — vision-mandatory structured mode. It requires the loader to produce images (otherwise `ValueError("to_markdown_structured requires a document containing images...")`), always enables vision mode, and parses each page's LLM response into `PageContent` via `extract_thinking_json` (`extract_thinker/markdown/markdown_converter.py:144-235`). List sources raise `NotImplementedError`.

Async variants (`to_markdown_async`, `to_markdown_structured_async`) wrap the sync methods (`extract_thinker/markdown/markdown_converter.py:771-782`).

## The certainty-scoring schema

Structured mode asks the LLM for Markdown plus a JSON breakdown (`extract_thinker/markdown/markdown_converter.py:19-84`):

```json
{"items": [{"certainty": 1-10, "content": "section of markdown content"}]}
```

`ContentItem` enforces `certainty` between 1 and 10 with `ge=1, le=10`, and `PageContent` holds the item list (`extract_thinker/markdown/markdown_converter.py:14-24`). The default page prompt (`DEFAULT_PAGE_PROMPT`) instructs the model to produce proper Markdown first (headings, lists, emphasis, links, code blocks, tables), include *all* content, replace image placeholders (e.g. `[img-1.jpeg]`) with descriptions of what they show, and then emit the JSON block. The unstructured prompt (`DEFAULT_MARKDOWN_PROMPT`) requests Markdown only (`extract_thinker/markdown/markdown_converter.py:86-108`).

## Page processing

`_process_page_with_llm` builds messages (always vision-style), calls `llm.raw_completion` — deliberately *not* instructor parsing — and parses the raw text with `extract_thinking_json(raw_response, PageContent)`; failures propagate after printing (`extract_thinker/markdown/markdown_converter.py:340-368`). The plain-mode path uses `_process_markdown_page` with the Markdown-only prompt.

## Message-building parity with Extractor

`MarkdownConverter` copies `_build_message_content`, `_convert_content_to_string`, `_add_images_to_message_content`, `_append_images`, and `_process_content_data` from `Extractor` (explicitly marked "(Copied from Extractor class)"), so content stringification, spreadsheet handling, and base64 `image_url` construction behave the same as extraction (`extract_thinker/markdown/markdown_converter.py:409-528`). It additionally handles Mistral-OCR-style image dicts carrying a `base64` key, stripping any `data:` prefix (`extract_thinker/markdown/markdown_converter.py:494-516`).

The duplication is a maintenance hazard: prompt or formatting changes in `Extractor` do not propagate automatically. Changes to message building should be applied to both places or the duplication consolidated.

## Verification flag

An `allow_verification` property exists (`extract_thinker/markdown/markdown_converter.py:113-126`) but the repository does not wire it to any verification behavior; treat it as reserved/inert.

## Representative tests

`tests/test_markdown_converter.py` runs conversions against fixture documents (`tests/files/invoice.pdf`, `bulk.pdf`, `family_budget.xlsx`) using `DocumentLoaderPyPdf`, `DocumentLoaderSpreadSheet`, and `DocumentLoaderMistralOCR` with `LLM(get_lite_model())`; Mistral tests skip without `MISTRAL_API_KEY`. All tests require live LLM access (`tests/test_markdown_converter.py:1-60`).

## Related pages

- [Document Loaders](document-loaders.md)
- [LLM Integration Layer](llm-integration.md)
- [Architecture and Component Map](architecture.md)
