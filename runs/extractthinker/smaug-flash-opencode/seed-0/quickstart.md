---
type: "Reference"
title: "Quickstart"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-92ee41b85171e4663a071a13
    resource: repo://extract_thinker/models/contract.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---


# Quickstart

ExtractThinker is a library for extracting structured data from documents using
LLMs, organized as an ORM-style document-processing pipeline. This page gets a
new engineer running end to end.

## Install

```bash
pip install extract_thinker
```

The package (pyproject.toml) requires Python `>=3.9,<3.14` and depends on
pydantic, litellm, instructor, pillow, pypdfium2, cachetools, pyyaml,
python-dotenv, and others. Optional provider loaders need their own dependencies
(e.g. `pytesseract` for Tesseract, `boto3` for AWS Textract).

## Minimal extraction

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
extractor.load_llm("gpt-4o-mini")

result = extractor.extract("invoice.pdf", InvoiceContract)
print(result.invoice_number, result.invoice_date)
```

Steps:

1. `load_document_loader(...)` sets the default `DocumentLoader` used to read
   the source into page content.
2. `load_llm(...)` accepts a model string or an `LLM` instance
   (extract_thinker/extractor.py:131-137); provider credentials are read from
   the environment.
3. `extract(source, response_model)` loads the document, builds an LLM message,
   and validates the reply against the `Contract` (a pydantic `BaseModel`
   subclass; extract_thinker/models/contract.py:4-5).

## Key concepts to learn next

- **Document Loaders** — how sources are read and normalized.
<!-- openwiki: broken internal link [openwiki/architecture/document-loaders.md] file "openwiki/architecture/document-loaders.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  See [Document Loaders](openwiki/architecture/document-loaders.md).
- **Extractor & flows** — extraction, classification, vision, and batch
<!-- openwiki: broken internal link [openwiki/architecture/extractor.md] file "openwiki/architecture/extractor.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  processing. See [Extractor and Extraction Flows](openwiki/architecture/extractor.md).
- **LLM abstraction** — backends, thinking mode, token budgeting.
<!-- openwiki: broken internal link [openwiki/architecture/llm.md] file "openwiki/architecture/llm.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  See [LLM Abstraction and Backends](openwiki/architecture/llm.md).
- **Process & splitting** — classifying and splitting multi-page documents.
<!-- openwiki: broken internal link [openwiki/architecture/process-and-splitters.md] file "openwiki/architecture/process-and-splitters.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  See [Process and Splitters](openwiki/architecture/process-and-splitters.md).
- **Architecture overview** — the full module responsibilities map.
<!-- openwiki: broken internal link [openwiki/architecture/overview.md] file "openwiki/architecture/overview.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  See [Architecture Overview](openwiki/architecture/overview.md).

Note: running actual extraction requires the loaders and models you choose to be
configured with valid credentials/binaries (API keys via a `.env` file, Tesseract
path, cloud credentials, etc.).
