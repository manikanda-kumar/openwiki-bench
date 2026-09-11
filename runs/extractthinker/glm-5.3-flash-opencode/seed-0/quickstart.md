---
type: quickstart
title: Quickstart
description: Install ExtractThinker, configure API keys, run your first extraction and classification, and navigate the test suite and this wiki.
tags: [quickstart, setup, installation, getting-started]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
  - id: openwiki-source-64ad4ba13a1462b220f2db30
    resource: repo://tests/test_document_loader_mistral_ocr.py
  - id: openwiki-source-aa326a6e338619f95df6a4ce
    resource: repo://tests/test_llm_backends.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Quickstart

ExtractThinker is a document-intelligence library: it loads documents, and uses LLMs to extract structured data into Pydantic models. This page gets you from clone to first extraction.

## Install

The library is published to PyPI as `extract_thinker` (version 0.1.14):

```bash
pip install extract_thinker
```

For development on this repository, use Poetry (`pyproject.toml:1-32`):

```bash
poetry install
```

Requirements: Python `>=3.9,<3.14`. Heavy optional dependencies (pytesseract, pypdf, playwright browsers, provider SDKs) are imported lazily by the loaders that need them; `libmagic`/`python-magic` (used for stream MIME detection in `DocumentLoader.can_handle`) requires the native magic library on your system.

## Configure credentials

Keys are read from the environment, typically via a `.env` file loaded with `python-dotenv` (the pattern used throughout the README and tests):

- An LLM provider key for your chosen model — e.g. `OPENAI_API_KEY`, `GROQ_API_KEY`, or a local Ollama endpoint (`API_BASE=http://localhost:11434`).
- Loader-specific keys only if you use cloud loaders (Azure Document Intelligence, AWS Textract, Google Document AI, Mistral OCR).
- `TESSERACT_PATH` if you use `DocumentLoaderTesseract`.

The repository does not ship provider credentials; the host application owns them.

## First extraction

The minimal extraction loop (`README.md:46-70`):

```python
from dotenv import load_dotenv
from extract_thinker import Extractor, DocumentLoaderPyPdf, Contract

load_dotenv()

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())
extractor.load_llm("gpt-4o-mini")          # any LiteLLM model string

result = extractor.extract("invoice.pdf", InvoiceContract)
print(result.invoice_number, result.invoice_date)
```

What happens under the hood: the loader extracts per-page text, `Extractor` normalizes it into the universal `{content, images, metadata}` format, builds a system+user message pair, and sends a structured request through instructor so the response is validated into `InvoiceContract`. See [Extractor](extractor.md) for the full flow and error behavior.

## Classification

```python
from extract_thinker import Classification

classifications = [
    Classification(name="Invoice", description="An invoice document", contract=InvoiceContract),
    Classification(name="Driver License", description="A driver's license", contract=DriverLicenseContract),
]
result = extractor.classify("document.pdf", classifications, vision=False)
print(result.name, result.confidence)   # confidence is 1-10
```

For higher-stakes classification, register multiple extractor layers on a `Process` and pick a `ClassificationStrategy` (consensus / higher-order / consensus-with-threshold), or use a `ClassificationTree` for hierarchical decisions — see [Process](process-workflow.md).

## Splitting multi-document files

```python
from extract_thinker import Process, ImageSplitter, SplittingStrategy

process = Process()
process.load_document_loader(DocumentLoaderPyPdf())
process.load_splitter(ImageSplitter(model="gpt-4o-mini"))

groups = (
    process.load_file("multipage.pdf")
    .split(classifications, strategy=SplittingStrategy.LAZY)  # LAZY is PDF-only
    .extract()
)
```

Each returned object is an instance of the matched classification's contract. See [Splitting](splitting.md) and [Process](process-workflow.md).

## Running the tests

```bash
poetry install
poetry run pytest tests/critical/ -v    # the suite CI runs (needs GROQ_API_KEY)
poetry run pytest tests/test_llm_backends.py -v   # fully offline
```

Most other modules need provider keys and make real (billed) LLM calls; several skip themselves gracefully when keys or optional dependencies are missing. Details and per-module requirements: [Testing Guide](testing.md).

## Where to go next

- [Architecture and Component Map](architecture.md) — how the pieces fit together.
- [Document Loaders](document-loaders.md) — choosing/configuring ingestion; [Adding a Document Loader](guides/adding-a-document-loader.md) to extend.
- [LLM Integration Layer](llm-integration.md) and [Extending LLM Behavior](guides/extending-llm-behavior.md) — backends, thinking mode, routers.
- [Completion Strategies](completion-strategies.md) — handling long documents.
- [Batch Processing](batch-processing.md) — OpenAI batch API for bulk jobs.
- [Evaluation Framework](eval-framework.md) — measuring extraction quality.
- [Packaging, CI, and Operations](operations.md) — build, release, docs.

## Related pages

- [Testing Guide](testing.md)
- [Extractor: Extraction and Classification Engine](extractor.md)
