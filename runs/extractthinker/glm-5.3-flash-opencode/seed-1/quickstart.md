---
type: quickstart
title: Quickstart
description: Set up ExtractThinker from source and run your first extraction, classification, and document-splitting workflow.
tags: [quickstart, setup, extraction, classification, splitting]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-0f73334137b59c6f274e2951
    resource: repo://examples/extractor_basic.py
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Quickstart

This page walks through wiring ExtractThinker up from this repository and running the three core workflows. Examples assume you are in the repo root with Python ≥ 3.9 (< 4.0) available (pyproject.toml).

## 1. Environment setup

```bash
pip install poetry
poetry install        # installs the pinned dependency set (pyproject.toml / poetry.lock)
```

- Core runtime dependencies: `pydantic >= 2.11.5`, `litellm >= 1.71.1`, `instructor`, `pypdfium2`, `pillow`, `cachetools`, `python-dotenv`, `tiktoken`, `python-magic` + libmagic, `playwright` (pyproject.toml). Optional engines (pypdf, pytesseract, cloud SDKs) are checked lazily at loader construction with an `ImportError` naming the pip package to install (for example document_loader_pypdf.py:82-102).
- **LLM credentials** are resolved by litellm from environment variables (e.g. `OPENAI_API_KEY` for OpenAI models, `ANTHROPIC_API_KEY`, etc.). ExtractThinker itself reads `OPENAI_API_KEY` only for `extract_batch` (batch_job.py:19) and `TESSERACT_PATH` when loaders run in a container (document_loader_tesseract.py:138-139).
- Use `load_dotenv()` with a `.env` file, as the examples do (examples/extractor_basic.py:3-7).

## 2. First extraction

Define a Pydantic contract, load a document, extract:

```python
from extract_thinker import Extractor, DocumentLoaderTesseract, Contract

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderTesseract("/path/to/tesseract"))  # binary must exist on disk
extractor.load_llm("gpt-4o-mini")   # any litellm-readable model string, or an LLM(...) instance

result = extractor.extract("invoice.pdf", InvoiceContract)
print(result.invoice_number, result.invoice_date)
```

Operational notes grounded in the code:

- The Tesseract loader validates the binary path exists at construction (`os.path.isfile` check raising ValueError, document_loader_tesseract.py:141-147); prefer `TesseractConfig(tesseract_cmd=...)` with explicit `lang`/`psm`/`oem`.
- Extraction fails fast with `ValueError` if the loader or LLM is missing (extractor.py:139-157) and wraps incomplete LLM output as `ExtractThinkerError` under the default FORBIDDEN strategy (extractor.py:320-335).
- For a full local runbook, `examples/extractor_basic.py` targets `tests/test_images/invoice.png` with `gpt-4o` and a homebrew Tesseract path — adjust paths before running.
- Async call sites use `await extractor.extract_async(...)` (a `asyncio.to_thread` wrapper, extractor.py:434-462).

## 3. Classification

`Extractor.classify(input, classifications, vision=False)` returns a `ClassificationResponse(name, confidence)` where the LLM's JSON answer `{name, confidence 1..10}` is matched back case-insensitively to your `Classification.name` values (extractor.py:722-807). Each `Classification` may carry its `contract`/`extractor` so a downstream process knows what to do with documents of that type (models/classification.py:6-33).

For resilience across models, `Process`-level classification runs layers of extractors with `CONSENSUS` / `HIGHER_ORDER` / `CONSENSUS_WITH_THRESHOLD` strategies and a 1–10 threshold (process.py:74-125). Hierarchical `ClassificationTree` classification narrows candidates level-by-level using the first extractor registered (process.py:127-188).

## 4. Splitting multi-document files

```python
from extract_thinker import Process, ImageSplitter, DocumentLoaderPyPdf, SplittingStrategy

process = Process()
process.load_document_loader(DocumentLoaderPyPdf())
process.load_splitter(ImageSplitter(model="gpt-4o-mini"))
process.load_file("multi_doc.pdf")

split_content = (
    process
    .split(classifications, strategy=SplittingStrategy.LAZY)
    .extract(vision=False)
)
```

- `split` needs ≥ 2 pages; LAZY requires a PDF (`can_handle_paginate`), otherwise use EAGER (process.py:205-238).
- Page grouping for LAZY comes from pairwise LLM image comparisons; failures default to *keeping pages together* (image_splitter.py:107-113) — do not rely on split rejection as an error signal for bad pages.
- `extract()` pulls each group's `Classification` to select its extractor and `extraction_contract` (or `contract`), page-slices 1-indexed, and reuses already-loaded pages via `set_skip_loading(True)` (process.py:240-309).

## 5. Verify your setup with tests

The repository's executable truth is its test corpus:

- The critical subset runs against a live GROQ endpoint: `GROQ_API_KEY=... poetry run pytest tests/critical/ -v` (mirroring .github/workflows/workflow.yml; CI also `poetry add pypdf` first).
- Most loader/core tests require the engine dependency (pypdf, pytesseract, etc.) and fixture files under `tests/files/` and `tests/test_images/`; batch tests need a paid GPT-4o-mini account (tests/test_batch_extractor.py:10-32).

## Next reading

- Architecture Overview for the component map and data flow.
- Extraction Flow and Error Handling before changing `extract` behavior.
- Document Loaders before adding a fresh loader type; Testing and CI for running verification correctly.
