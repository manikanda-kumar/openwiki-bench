---
type: guide
title: Quickstart and Task Routing
description: Install ExtractThinker and run each core document-intelligence task, with pointers to the wiki pages that explain each subsystem in depth.
tags: [quickstart, getting-started, installation, examples]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:16:41.841Z
sources:
  - id: openwiki-source-0f73334137b59c6f274e2951
    resource: repo://examples/extractor_basic.py
  - id: openwiki-source-b850ee3fbe198a269f365ae0
    resource: repo://examples/receipt_processor.py
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-20348fa03582863679d141a9
    resource: repo://extract_thinker/eval/cli.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T09:16:41.841Z" }
---

# Quickstart and Task Routing

ExtractThinker is a Python 3.9+ library (declared `>=3.9,<3.14` in `pyproject.toml`) that extracts structured data from documents using LLMs. Install it with:

```bash
pip install extract_thinker
```

Runtime dependencies (from `pyproject.toml`) include `pydantic`, `litellm`, `instructor`, `pillow`, `pypdfium2`, `cachetools`, `python-magic`, and `playwright`; OCR and cloud loaders pull in their own optional packages (e.g. `pytesseract`, `boto3`, `azure-ai-formrecognizer`).

## Task routing map

| Task | API | Wiki page |
|---|---|---|
| Load a document into a page list | `DocumentLoader*.load(source)` | [Document Loaders](/openwiki/architecture/document-loaders.md) |
| Extract structured data | `Extractor.extract(...)` | [Extraction Pipeline](/openwiki/architecture/extraction.md) |
| Classify a document | `Extractor.classify(...)` / `Process.classify(...)` | [Document Classification](/openwiki/architecture/classification.md) |
| Split and extract multi-page docs | `Process.load_file().split().extract()` | [Process Workflow and Splitting](/openwiki/architecture/process-and-splitting.md) |
| Batch processing (OpenAI) | `Extractor.extract_batch(...)` | [Extraction Pipeline](/openwiki/architecture/extraction.md) |
| Markdown conversion | `MarkdownConverter.to_markdown(...)` | Public API in `extract_thinker/__init__.py` |
| Evaluate extraction quality | `Evaluator` + CLI | [Evaluation Subsystem](/openwiki/architecture/evaluation.md) |
| Change guide: new loader | — | [Adding a Document Loader](/openwiki/guides/adding-a-document-loader.md) |
| Change guide: debugging | — | [Debugging Extraction](/openwiki/guides/debugging-extraction.md) |

All classes below come from the public surface re-exported in `extract_thinker/__init__.py`.

## 1. Basic extraction

Define a `Contract` (a Pydantic model), load a document loader and an LLM, then extract:

```python
from extract_thinker import Extractor, Contract, DocumentLoaderPyPdf

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())  # PDF text
extractor.load_llm("gpt-4o-mini")                     # or any litellm model

result = extractor.extract("invoice.pdf", InvoiceContract)
print(result.invoice_number, result.invoice_date)
```

`examples/extractor_basic.py` shows the same flow with `DocumentLoaderTesseract` for images. For images/PDFs in vision mode pass `vision=True`; a vision-capable loader (or the automatic `DocumentLoaderLLMImage` fallback) will attach page images. Long documents may need a `completion_strategy` — see [Debugging Extraction](/openwiki/guides/debugging-extraction.md).

## 2. Classification

Classify a document into one of several classes using `Extractor.classify`:

```python
from extract_thinker import Extractor, Classification, DocumentLoaderPyPdf, Contract

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

class DriverLicenseContract(Contract):
    name: str
    license_number: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())
extractor.load_llm("gpt-4o-mini")

result = extractor.classify(
    "document.pdf",
    [
        Classification(name="Invoice", description="An invoice document", contract=InvoiceContract),
        Classification(name="Driver License", description="A driver's license document", contract=DriverLicenseContract),
    ],
)
print(result.name, result.confidence)  # ClassificationResponse
```

For multi-model consensus, thresholding, or hierarchical trees, use `Process.classify` — see [Document Classification](/openwiki/architecture/classification.md).

## 3. Split-and-extract multi-page documents

Use `Process` with a splitter when one file contains several logical documents:

```python
from extract_thinker import Process, ImageSplitter, DocumentLoaderPyPdf, SplittingStrategy

process = Process()
process.load_document_loader(DocumentLoaderPyPdf())
process.load_splitter(ImageSplitter(model="gpt-4o-mini"))

split_content = (
    process.load_file("multipage.pdf")
    .split(classifications, strategy=SplittingStrategy.LAZY)  # or EAGER
    .extract()
)
```

Eager strategies analyze the whole document at once; lazy strategies compare page pairs and require a pagination-capable loader (PDF). See [Process Workflow and Splitting](/openwiki/architecture/process-and-splitting.md).

## 4. Batch processing

`extract_batch` submits many extraction requests to the OpenAI Batch API and returns a `BatchJob` you can poll:

```python
from extract_thinker import Extractor, Contract

class ReceiptContract(Contract):
    store_name: str
    total_amount: float

extractor = Extractor()
extractor.load_llm("gpt-4o-mini")  # batch requires gpt-4o-mini/gpt-4o/gpt-4

batch_job = extractor.extract_batch(source="receipt1.jpg", response_model=ReceiptContract, vision=True)
status = await batch_job.get_status()
results = await batch_job.get_result()
```

Batch requires the DEFAULT backend and one of the `BATCH_SUPPORTED_MODELS`. See [Extraction Pipeline](/openwiki/architecture/extraction.md).

## 5. Evaluation

Measure extraction quality against a labeled dataset with the eval package, either in code or via its CLI:

```bash
python -m extract_thinker.eval.cli --config eval_config.json --output results.json --detect-hallucinations --track-costs
```

The JSON config names a `document_loader`, an `llm`, a `contract_path` (Python file), `documents_dir`, and `labels_path`. See [Evaluation Subsystem](/openwiki/architecture/evaluation.md).

## Working examples

- `examples/extractor_basic.py` — minimal OCR extraction.
- `examples/receipt_processor.py` — nested `Contract` extraction with Pydantic `Field` descriptions (a good pattern for complex schemas).
- `examples/resume_processor.py` and the notebooks under `examples/notebooks/` — more end-to-end flows.
