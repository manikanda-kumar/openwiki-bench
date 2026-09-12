---
type: quickstart
title: Quickstart
description: How to install ExtractThinker\'s deprecated, configure a model and document loader, and run a first extraction, classification, split/extract, and batch workflow.
tags: [quickstart, installation, extraction, classification, split, batch]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
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
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---

# Quickstart

ExtractThinker is a Python document-intelligence library that turns documents into validated Pydantic objects using LLMs. This page gets you running end-to-end.

## Installation

```bash
pip install extract_thinker
```

The installed package exports its public API from `extract_thinker/__init__.py`. Python must be `>=3.9,<3.14` (per `pyproject.toml`). Provider-specific loaders require their SDKs installed separately (e.g. `pip install pypdf`, `pip install boto3`, `pip install azure-ai-formrecognizer`, `pip install pytesseract`).

Import the core pieces:

```python
from extract_thinker import Extractor, DocumentLoaderPyPdf, Contract
from extract_thinker import Classification, Process, ImageSplitter, SplittingStrategy
```

All of these names (and many more) are exported from `extract_thinker/__init__.py`.

## Minimal extraction

```python
import os
from extract_thinker import Extractor, DocumentLoaderPyPdf, Contract

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str
    total_amount: float

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())
extractor.load_llm("gpt-4")  # any LiteLLM-compatible model string

result = extractor.extract("invoice.pdf", InvoiceContract)

print(result.invoice_number, result.invoice_date, result.total_amount)
```

Key points (grounded in `extract_thinker/extractor.py`):

- `load_document_loader` sets the primary loader (`extract_thinker/extractor.py:128`).
- `load_llm("gpt-4")` wraps the model string in an `LLM` (`extract_thinker/extractor.py:131`).
- `extract(source, response_model)` resolves a loader, loads the content, and returns a validated `InvoiceContract` instance.

## Vision extraction

For image or scanned documents, pass `vision=True`:

```python
result = extractor.extract("invoice.png", InvoiceContract, vision=True)
```

The selected loader must support vision (else `InvalidVisionDocumentLoaderError` is raised). In vision mode, page images are sent as base64 to the model.

## Classification

Classify a document among candidate types (taken from the `docs/getting-started` and `README` patterns):

```python
from extract_thinker import Extractor, Classification, Contract
from extract_thinker.document_loader.document_loader_pypdf import DocumentLoaderPyPdf

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

class DriverLicenseContract(Contract):
    name: str
    license_number: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())
extractor.load_llm("gpt-4o-mini")

classifications = [
    Classification(name="Invoice", description="An invoice document", contract=InvoiceContract, extractor=extractor),
    Classification(name="Driver License", description="A driver's license document", contract=DriverLicenseContract, extractor=extractor),
]

resp = extractor.classify("document.pdf", classifications, image=False)
print(resp.name, resp.confidence)
```

`Classification` (`extract_thinker/models/classification.py:6`) ties each candidate to a name, description, contract, and extractor.

## Split and extract with Process

For multi-page documents containing different document types, use `Process` (`extract_thinker/process.py:18`) with a splitter:

```python
from extract_thinker import Process, ImageSplitter, SplittingStrategy, Classification, Extractor, DocumentLoaderPyPdf

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())
extractor.load_llm("gpt-4o-mini")

class DriverLicenseContract(Contract):
    name: str
    license_number: str

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

classifications = [
    Classification(name="Invoice", description="An invoice", contract=InvoiceContract, extractor=extractor),
    Classification(name="Driver License", description="A driver's license", contract=DriverLicenseContract, extractor=extractor),
]

process = Process()
process.load_document_loader(DocumentLoaderPyPdf())
process.load_splitter(ImageSplitter(model="gpt-4o-mini"))

items = (
    process.load_file("multi.pdf")
    .split(classifications, strategy=SplittingStrategy.EAGER)
    .extract()
)

for item in items:
    print(type(item).__name__, item)
```

- `load_splitter(ImageSplitter(...))` automatically enables vision on loaders (`extract_thinker/process.py:42`).
- `SplittingStrategy.EAGER` analyzes all pages together; `LAZY` requires PDF pagination.

## Batch extraction

For many documents via OpenAI's Batch API (models `gpt-4o-mini`/`gpt-4o`/`gpt-4`):

```python
import asyncio
from extract_thinker import Extractor, Contract

class ReceiptContract(Contract):
    store_name: str
    total_amount: float

async def main():
    extractor = Extractor()
    extractor.load_llm("gpt-4o-mini")
    batch = extractor.extract_batch(source="receipt1.jpg", response_model=ReceiptContract, vision=True)
    status = await batch.get_status()
    results = await batch.get_result()
    print(status, results)

asyncio.run(main())
```

Requires `OPENAI_API_KEY` and a `BATCH_SUPPORTED_MODELS` model (see `/openwiki/operations/batch-processing.md`).

## Documentation and next steps

- [Architecture Overview](/openwiki/architecture/overview.md)
- [Extractor and Extraction Pipeline](/openwiki/concepts/extractor.md)
- [Document Loaders](/openwiki/concepts/document_loaders.md)
- [Completion Strategies](/openwiki/concepts/completion-strategies.md)
- [Evaluation and Quality Metrics](/openwiki/concepts/evaluation.md)

Also see the `examples/` directory in this repository for Jupyter notebooks and standalone scripts, and `tests/` for runnable usage demonstrations.
