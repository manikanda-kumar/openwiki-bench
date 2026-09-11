---
type: quickstart
title: "Quickstart"
description: "Install ExtractThinker, run your first extraction, classification, and split-and-extract pipeline, set the required provider keys, and route to the right wiki page for the task at hand."
tags: [quickstart, installation, setup, routing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-0f73334137b59c6f274e2951
    resource: repo://examples/extractor_basic.py
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-a2ad0cecc3781b040423f249
    resource: repo://extract_thinker/models/classification_response.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Quickstart

ExtractThinker extracts and classifies structured data from documents using LLMs, with Pydantic models ("contracts") as the schema. Python `>=3.9,<3.14` is required by the package metadata.

## Install

```bash
pip install extract_thinker            # end users
```

For development on this repository (Poetry-managed, dev extras incl. pytest/flake8/black):

```bash
pip install poetry && poetry install
```

The core install covers litellm/instructor/pydantic/pypdfium2/Pillow/playwright; loader extras (`pypdf`, `pdfplumber`, `docx2txt`, `openpyxl`, `bs4`, `azure-ai-*`, `boto3`, `easyocr`, `docling`, `markitdown`, `sentence-transformers`, `pydantic-ai`) are optional and surface `ImportError` pip-hints at use time (`pyproject.toml:8-28`; lazy-import guards in `extract_thinker/document_loader/`).

**Keys and binaries you need**: provider API keys consumed by litellm (e.g. `OPENAI_API_KEY`); `OPENAI_API_KEY` specifically for the OpenAI Batch API; `TESSERACT_PATH` (or `tesseract` on PATH) for OCR loaders; `GROQ_API_KEY` to run the CI critical tests; a local Ollama server with `API_BASE` for its tests.

## 1. Extract your first document

From the README basic example (`README.md:46-70`) and `examples/extractor_basic.py`:

```python
from extract_thinker import Extractor, DocumentLoaderPyPdf, Contract

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())   # or DocumentLoaderTesseract(tesseract_path) for images/OCR
extractor.load_llm("gpt-4o-mini")

result = extractor.extract("invoice.pdf", InvoiceContract)  # result is an InvoiceContract instance
```

`vision=True` on `extract` sends page images to a vision-capable model instead of extracted text; a `list` of sources is merged into one document (`tests/test_extractor.py:439-473`). How the call flows internally: core/extraction-flow.

## 2. Classify a document

Choose which contract applies before extracting (`README.md:116-124`):

```python
from extract_thinker import Classification

result = extractor.classify(
    "document.pdf",
    [Classification(name="Invoice", description="An invoice document",
                    contract=InvoiceContract, extractor=extractor)],
    vision=False,   # True compares page images against optional reference images
)
print(result.name, result.confidence)   # confidence is 1..10
```

## 3. Split a multi-document file and extract each part

From the README splitting example (`README.md:176-190`): a `Process` with a document loader and an `ImageSplitter` (or `TextSplitter`) finds page boundaries among your classifications:

```python
from extract_thinker import Process, ImageSplitter, SplittingStrategy

process = Process()
process.load_document_loader(DocumentLoaderPyPdf())
process.load_splitter(ImageSplitter(model="gpt-4o-mini"))

items = (process
         .load_file("multipage.pdf")
         .split(classifications, strategy=SplittingStrategy.LAZY)  # or EAGER
         .extract())
# items: one contract instance per detected document (PDF required for LAZY)
```

Multi-extractor ("Mixture of Models") and tree-based classification live on `Process` too — core/classification-and-splitting.

## 4. Verify quickly

```bash
poetry run pytest tests/critical/    # needs GROQ_API_KEY; this is exactly what CI runs
```

Most other tests need live provider keys and sometimes Tesseract — operations/testing-and-ci.

## Where to go next

| Task | Page |
|---|---|
| Understand the whole system / data flow | architecture/overview |
| Trace or change `extract()` behavior | core/extraction-flow |
| Models, backends, thinking, timeouts | core/llm-layer |
| Consensus/tree classification, page splitting | core/classification-and-splitting |
| Long documents / truncated JSON outputs | core/completion-strategies |
| OpenAI Batch API jobs | core/batch-processing |
| Document → Markdown | core/markdown-conversion |
| Choose a loader; vision mode; caching | loaders/loader-framework |
| OCR/cloud loaders (Tesseract, Azure, Textract, DocAI, Mistral) | loaders/ocr-and-cloud-loaders |
| PDF/HTML/office/spreadsheet loaders | loaders/text-and-structured-loaders |
| Env vars, exceptions, fallbacks | architecture/configuration-and-failure-handling |
| Benchmark extractors, hallucination checks, eval CLI | operations/eval-harness |
| Run tests, CI expectations | operations/testing-and-ci |
| Add a loader/backend/strategy; debug recipes | guides/change-guides |
