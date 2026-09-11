---
type: quickstart
title: Quickstart
description: Get running with ExtractThinker — install, API keys, first extraction, first classification, a split-and-extract pipeline, and how to run the test suite.
tags: [quickstart, install, setup, examples]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
sources:
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-0f73334137b59c6f274e2951
    resource: repo://examples/extractor_basic.py
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
  - id: openwiki-source-11ca4d71d0bcafa6689655ef
    resource: repo://tests/test_classify.py
  - id: openwiki-source-ab84285606e1ddec667b96cc
    resource: repo://tests/test_document_loader_aws_textract.py
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# Quickstart

ExtractThinker (`extract_thinker`, Apache-2.0, Python ≥3.9 <3.14) extracts structured data from documents by pairing a document loader with an LLM and a Pydantic "Contract". The package root (`extract_thinker/__init__.py`) exports `Extractor`, `Process`, `LLM`, `DocumentLoader` and the concrete loaders, splitters, models, `BatchJob`, and `MarkdownConverter`.

## Install

```bash
pip install extract_thinker        # published package (pyproject name/version)
# development clone:
pip install poetry && poetry install
```

Core deps bring pydantic, litellm, instructor, pillow, pypdfium2, playwright, python-magic and friends (pyproject.toml:7-19), but **loaders need extra packages on demand**: e.g. `pip install pypdf` for `DocumentLoaderPyPdf`, `pip install pytesseract` plus the Tesseract binary for `DocumentLoaderTesseract`. CI itself does `poetry install && poetry add pypdf` before running tests (.github/workflows/workflow.yml:29).

## API keys

LLM access goes through litellm provider names, so set the environment key your model needs (`OPENAI_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, …). Examples and tests call `load_dotenv()`, so a `.env` file works (examples/extractor_basic.py:3-5). Batch jobs additionally require `OPENAI_API_KEY` (extract_thinker/batch_job.py:19) and cloud loaders need their vendor credentials (see the env table in `operations/ci-packaging-testing.md`).

## First extraction

```python
from dotenv import load_dotenv
from extract_thinker import Extractor, DocumentLoaderPyPdf, Contract

load_dotenv()

class InvoiceContract(Contract):          # any Pydantic model works
    invoice_number: str
    invoice_date: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())
extractor.load_llm("gpt-4o-mini")          # or an LLM(...) instance

result = extractor.extract("invoice.pdf", InvoiceContract)
print(result.invoice_number)
```

This is the README's basic example (README.md:57-80). Pass `vision=True` to send page images instead of text, a list of sources to merge them, or `completion_strategy=CompletionStrategy.PAGINATE` for per-page parallel extraction with conflict-resolved merging — details in `core/completion-strategies.md`. Errors surface as `ExtractThinkerError` subclasses (incomplete output under the default FORBIDDEN strategy, or `VisionError` for vision-unsupported models).

## First classification

```python
from extract_thinker import Extractor, Classification, DocumentLoaderPyPdf

classifications = [
    Classification(name="Invoice", description="An invoice document",
                   contract=InvoiceContract, extractor=extractor),
    Classification(name="Driver License", description="A driver's license",
                   contract=DriverLicenseContract, extractor=extractor),
]

response = extractor.classify("doc.pdf", classifications, image=False)
print(response.name, response.confidence)      # confidence 1-10
```

`image=True` switches to per-classification visual comparison (reference images via `Classification.set_image`). Multi-extractor consensus and hierarchical `ClassificationTree` routing live on `Process.classify` — see `core/process-orchestration.md`.

## Split & extract a mixed document

```python
from extract_thinker import (Process, ImageSplitter, DocumentLoaderPyPdf,
                             SplittingStrategy)

process = Process()
process.load_document_loader(DocumentLoaderPyPdf())
process.load_splitter(ImageSplitter(model="gpt-4o-mini"))

results = (process.load_file("multipage.pdf")
                  .split(classifications, strategy=SplittingStrategy.LAZY)
                  .extract())
```

The pipeline (README.md:129-196) classifies page groups and extracts each group with the classification's own extractor/contract; EAGER vs LAZY strategies differ in how boundaries are decided.

## Run the tests

```bash
export GROQ_API_KEY=...          # critical tests call a real model
poetry run pytest tests/critical/ -v
```

`tests/critical/` is the CI gate (extraction + classification against `tests/files/invoice.pdf` using `groq/llama-3.3-70b-versatile`). The rest of `tests/` covers loaders, markdown, and evals and **fails without vendor credentials** (TESSERACT_PATH, AWS_*, AZURE_*, DOCUMENTAI_*, MISTRAL_API_KEY); set them or run only the suites you're changing — see `operations/ci-packaging-testing.md`.

## Where next

- `architecture/overview.md` — component map and end-to-end flow
- `core/extractor.md`, `core/document-loaders.md`, `core/llm-integration.md` — the pipeline internals
- `core/completion-strategies.md`, `core/process-orchestration.md` — pagination and multi-document workflows
- `eval/evaluation-framework.md` — benchmarking extraction quality
- `guides/change-playbooks.md` — adding loaders/strategies/backends safely
