---
type: quickstart
title: ExtractThinker Quickstart
description: Install ExtractThinker, configure a document loader and LLM, and run your first extraction, classification, and split workflows with the public API.
tags: [quickstart, getting-started, installation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
sources:
  - id: openwiki-source-0f73334137b59c6f274e2951
    resource: repo://examples/extractor_basic.py
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# ExtractThinker Quickstart

ExtractThinker is a document-intelligence library that turns files (PDFs,
images, spreadsheets, web pages) into validated structured data using LLMs.
Everything you need is re-exported from the package root
(`extract_thinker/__init__.py:1-90`): `Extractor`, `LLM`, `Contract`,
`Process`, `Classification`, the document loaders, the splitter classes, and
the strategy enums.

## Requirements

- Python `>=3.9,<3.14` (`pyproject.toml:9`).
- API credentials for your chosen LLM provider in the environment (ExtractThinker
  uses litellm, so standard provider env vars like `OPENAI_API_KEY` work).
- Optional third-party tools for specific loaders — e.g. the Tesseract OCR
  binary plus `pytesseract` for `DocumentLoaderTesseract`, `openpyxl`/`xlrd`
  for spreadsheets, cloud SDKs for the Azure/AWS/Google loaders. Missing
  dependencies raise descriptive `ImportError`s at loader construction.

## Installation

```bash
pip install extract_thinker
```

The package is also Poetry-managed (`pyproject.toml`), so `poetry install`
works from a checkout.

## 1. Basic extraction

Define a `Contract` (a Pydantic model) describing the fields you want, configure
an `Extractor` with a document loader and an LLM, and call `extract`
(`examples/extractor_basic.py`, `README.md:44-70`):

```python
import os
from dotenv import load_dotenv
from extract_thinker import Extractor, DocumentLoaderPyPdf, Contract

load_dotenv()

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())
extractor.load_llm("gpt-4o-mini")  # or any litellm-supported model string

result = extractor.extract("invoice.pdf", InvoiceContract)
print(result.invoice_number, result.invoice_date)
```

Notes:

- `load_document_loader` picks how the document is read; `load_llm` accepts a
  model string or an `LLM` instance (`extractor.py:128-137`).
- For image-heavy documents, pass `vision=True` to `extract` so the loader
  attaches page images and the request becomes vision-capable
  (`extractor.py:226-230`).
- The default completion strategy is `FORBIDDEN`, meaning an incomplete LLM
  answer surfaces as `ExtractThinkerError`; pass `completion_strategy` to use
  `PAGINATE` or `CONCATENATE` for long documents.

## 2. Classification

Use `Extractor.classify` with a list of `Classification`s
(`README.md:74-125`):

```python
from extract_thinker import Extractor, Classification, DocumentLoaderPyPdf

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
    Classification(name="Invoice", description="An invoice document",
                   contract=InvoiceContract, extractor=extractor),
    Classification(name="Driver License", description="A driver's license document",
                   contract=DriverLicenseContract, extractor=extractor),
]

result = extractor.classify("path_to_document.pdf", classifications, image=True)
print(result.name, result.confidence)  # name + confidence (1-10)
```

For multi-model agreement, use `Process.add_classify_extractor` + `Process.classify`
with `ClassificationStrategy.CONSENSUS`/`HIGHER_ORDER`/`CONSENSUS_WITH_THRESHOLD`
(`process.py:74-125`).

## 3. Split and extract multi-document files

Use `Process` with a splitter to separate a multi-page file into documents and
extract each with the matching contract (`README.md:129-199`):

```python
from extract_thinker import (Extractor, Process, Classification, ImageSplitter,
                             DocumentLoaderPyPdf, SplittingStrategy)

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())
extractor.load_llm("gpt-4o-mini")

classifications = [
    Classification(name="Driver License", description="A driver's license document",
                   contract=DriverLicenseContract, extractor=extractor),
    Classification(name="Invoice", description="An invoice document",
                   contract=InvoiceContract, extractor=extractor),
]

process = Process()
process.load_document_loader(DocumentLoaderPyPdf())
process.load_splitter(ImageSplitter(model="gpt-4o-mini"))

results = (process.load_file("multi_page.pdf")
           .split(classifications, strategy=SplittingStrategy.LAZY)
           .extract())

for item in results:
    if isinstance(item, InvoiceContract):
        print("Invoice:", item.invoice_number)
    elif isinstance(item, DriverLicenseContract):
        print("License:", item.license_number)
```

`SplittingStrategy.EAGER` groups all pages in one LLM call;
`SplittingStrategy.LAZY` compares consecutive page pairs and currently requires
a PDF loader (`process.py:232-236`). `TextSplitter` is the text-only analogue of
`ImageSplitter`.

## 4. Batch processing

For asynchronous, lower-cost bulk extraction through the OpenAI Batch API
(`README.md:202-232`):

```python
batch_job = extractor.extract_batch(source="receipt1.jpg",
                                    response_model=ReceiptContract, vision=True)
print(await batch_job.get_status())
results = await batch_job.get_result()
```

Batch mode is restricted to `gpt-4o-mini`, `gpt-4o`, `gpt-4o-2024-08-06`, and
`gpt-4` (see [Batch Processing](batch-processing.md)).

## Where to go next

- [Architecture and Core Data Flow](architecture.md) — how the components fit
  together and the universal content format.
- [Document Loaders](document-loaders.md) — the full loader family and their
  configuration.
- [Extraction Pipeline](extraction.md) — `Extractor` in depth.
- Runnable examples live in `examples/` (including `examples/extractor_basic.py`)
  and the test suite in `tests/` demonstrates advanced usage such as vision
  extraction, charts, classification trees, and evaluation.
