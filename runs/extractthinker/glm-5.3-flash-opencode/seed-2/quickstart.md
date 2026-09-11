---
type: quickstart
title: Quickstart
description: Get ExtractThinker running from source — install, environment variables, first extraction, vision mode, process pipelines, and tests.
tags: [quickstart, installation, setup, examples, testing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
sources:
  - id: openwiki-source-9e86520c41fc7ec8982f7d75
    resource: repo://docs/getting-started/index.md
  - id: openwiki-source-0f73334137b59c6f274e2951
    resource: repo://examples/extractor_basic.py
  - id: openwiki-source-283abb98034c158da541239f
    resource: repo://examples/notebooks/basic_example.ipynb
  - id: openwiki-source-b850ee3fbe198a269f365ae0
    resource: repo://examples/receipt_processor.py
  - id: openwiki-source-d905b81701c59372673c0f7a
    resource: repo://examples/resume_processor.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-11ca4d71d0bcafa6689655ef
    resource: repo://tests/test_classify.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# Quickstart

ExtractThinker is a Python 3.9–3.13 library for document intelligence: document loaders convert files to pages, LLMs extract data into Pydantic contracts. Source of truth for this page: `README.md`, `pyproject.toml`, and `examples/`.

## Install

From PyPI (matching `docs/getting-started/index.md#L27-L30`):

```bash
pip install extract_thinker
```

From source (this repository, `pyproject.toml#L1-L20`):

```bash
poetry install        # or: pip install -r requirements.txt
```

Core dependencies: pydantic v2, litellm, instructor, pillow, pypdfium2, python-dotenv, cachetools, pyyaml, tiktoken, python-magic, playwright.

## API keys

LLM calls go through litellm, so standard provider environment variables apply (`OPENAI_API_KEY`, GEMINI keys, etc.); examples load them via `python-dotenv` (`load_dotenv()`, e.g. `README.md#L67`). Tests additionally rely on `TESSERACT_PATH` pointing at a Tesseract binary (`tests/test_classify.py#L24-L26`). Vision-based extractors validate that the configured model actually supports images at call time via `is_vision_error`/`classify_vision_error` classification.

## First extraction

The canonical minimal flow (`README.md#L53-L80`, `docs/getting-started/index.md#L36-L57`):

```python
from extract_thinker import Extractor, DocumentLoaderPyPdf, Contract

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())
extractor.load_llm("gpt-4o-mini")

result = extractor.extract("invoice.pdf", InvoiceContract)
print(result.invoice_number)
```

Notes established by source:

- `load_llm` accepts either a model string or an `LLM` instance (`extract_thinker/extractor.py#L131-L137`).
- Default completion strategy is `FORBIDDEN`: one LLM call over the whole document; incomplete output raises `ExtractThinkerError` instead of returning partial data (`extract_thinker/extractor.py#L320-L335`).
- Vision mode: `extractor.extract(path, Contract, vision=True)` — pass `vision=True` to send page images; the loader doesn't need to support text.
- Async: `extract_async(...)` mirrors `extract` (`extract_thinker/extractor.py#L434-L462`).

## Multi-document pipelines

For files mixing document types (e.g., `tests/files/bulk.pdf`), use `Process` + a `Splitter` (`tests/test_process.py`):

```python
from extract_thinker import Process, Classification, SplittingStrategy
from extract_thinker.text_splitter import TextSplitter

process = Process()
process.load_document_loader(DocumentLoaderPyPdf())
process.load_splitter(TextSplitter("gpt-4o-mini"))
process.add_classify_extractor([[extractor]])

process.load_file("bulk.pdf")
(
    process.split(classifications, SplittingStrategy.EAGER)
    .extract(vision=False, completion_strategy=...)
)
```

Instance methods chain (`load_document_loader(...).load_splitter(...)` returns `self`, `extract_thinker/process.py#L36-L63`) — mirrors the doc's chained style. Classification strategies and thresholds are covered in [Classification](/openwiki/classification.md).

## Runnable examples in-repo

- `examples/extractor_basic.py` — basic extraction.
- `examples/resume_processor.py`, `examples/receipt_processor.py` — contract processing.
- `examples/notebooks/basic_example.ipynb` — notebook walkthrough.
- Fixture files: `examples/files/` (invoice.pdf, receipts, CVs), `tests/files/`, `tests/test_images/`.

## Running the test suite

`pytest` (dev dependency, `pyproject.toml#L22-L29`). Most tests are live integration tests requiring provider credentials loaded via dotenv:

- `tests/test_extractor.py` — extraction paths, strategies, backends.
- `tests/test_classify.py`, `tests/test_process.py` — classification and splitting pipelines.
- `tests/test_document_loader_*.py` — individual loaders; base invariants asserted in `tests/test_document_loader_base.py`.
- `tests/test_evaluator.py` — evaluation framework.

Without valid API keys most extraction/classification tests will fail; loader tests generally run against local fixtures but some need OCR binaries or cloud credentials.

## Next reading

- [Architecture Overview](/openwiki/architecture-overview.md) — how the pieces fit.
- [Document Loaders](/openwiki/document-loaders.md) — picking a loader for your file types.
- [Extractor and Extraction Flow](/openwiki/extractor-and-extraction-flow.md) — what `extract()` does in detail.
