---
type: "Reference"
title: "Quickstart"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
sources:
  - id: openwiki-source-0f73334137b59c6f274e2951
    resource: repo://examples/extractor_basic.py
  - id: openwiki-source-b850ee3fbe198a269f365ae0
    resource: repo://examples/receipt_processor.py
  - id: openwiki-source-d905b81701c59372673c0f7a
    resource: repo://examples/resume_processor.py
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-a2ad0cecc3781b040423f249
    resource: repo://extract_thinker/models/classification_response.py
  - id: openwiki-source-92ee41b85171e4663a071a13
    resource: repo://extract_thinker/models/contract.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---


# Quickstart

ExtractThinker is a Python library for intelligent document processing (IDP): it loads documents via pluggable loaders,
classifies/splits them into logical documents, and extracts structured, typed data with
an LLM. This page gets you running and points to the source files behind each example.

## Install

The package is published to PyPI and depends on Python `>=3.9,<3.14` (`pyproject.toml`). Install with:

```bash
pip install extract_thinker
```

Core runtime dependencies (from `pyproject.toml`) include `pydantic>=2.11.5`, `litellm>=1.71.1`, `pillow`, `pypdfium2`, `instructor`, `cachetools`, `yaml safeload` (`pyyaml`), `python-magic`, and `playwright`. `tiktoken` is only included for Python `<3.13`. Many loaders pull in their own optional dependencies (e.g. `pytesseract`, `azure-ai-formrecognizer`, `pypdf`).

Set your model provider credentials in the environment (e.g. `OPENAI_API_KEY`, `GEMINI_API_KEY`) or a loaded `.env` file; several examples call `load_dotenv()`.

The authoritative entrypoints for the examples below are in `examples/` and the README's usage section.

## Basic extraction

`examples/extractor_basic.py` shows the minimal extract flow: build an `Extractor`, load a DocumentLoader (here `DocumentLoaderTesseract`), load an LLM, and call `extract`.

```python
from extract_thinker import DocumentLoaderTesseract, Extractor, Contract

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderTesseract(tesseract_path))
extractor.load_llm("gpt-4o")
result = extractor.extract(test_file_path, InvoiceContract)
```

Notes:

- `Contract` is just a Pydantic `BaseModel` subclass; the response model defines the expected schema (`extract_thinker/models/contract.py`).
<!-- openwiki: broken internal link [openwiki/architecture/overview.md] file "openwiki/architecture/overview.md" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [openwiki/extraction-and-classification.md] file "openwiki/extraction-and-classification.md" does not exist. Fix the href or restore the target, then delete this comment. -->
- `extractor.extract(source, Contract)` loads the source through the DocumentLoader, maps it to a universal content dict, and asks the LLM for a model-instance result. See [Architecture Overview](openwiki/architecture/overview.md) and [Extraction and Classification](openwiki/extraction-and-classification.md).
<!-- openwiki: broken internal link [openwiki/document-loaders.md] file "openwiki/document-loaders.md" does not exist. Fix the href or restore the target, then delete this comment. -->
- The example uses a hardcoded `tesseract_path="/opt/homebrew/bin/tesseract"` and expects a source image at `tests/test_images/invoice.png`; adjust these for your environment. `DocumentLoaderTesseract` requires the Tesseract binary (see [Document Loaders](openwiki/document-loaders.md)).

## Nested contract extraction

`examples/receipt_processor.py` defines a nested `ReceiptContract` with a list of `ReceiptItem` models and uses `Field(...)` descriptions to guide the model:

```python
class ReceiptItem(Contract):
    description: str = Field("Description of the item purchased")
    quantity: float = Field("Quantity of items purchased")
    ...
```

It configures `DocumentLoaderTesseract` and calls `extractor.extract(receipt_path, ReceiptContract)`, then serializes the result to YAML for readability. Field descriptions act as extra guidance to the LLM.

## Classification

To label a document (rather than extract it), build a list of `Classification` objects (each with a name, description, optional contract, and an `extractor`) and call `extractor.classify`:

```python
from extract_thinker import Extractor, Classification, DocumentLoaderPyPdf, Contract

class InvoiceContract(Contract):
    invoice_number: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())
extractor.load_llm("gpt-4o-mini")

classifications = [
    Classification(name="Invoice", description="An invoice document", contract=InvoiceContract, extractor=extractor),
]
result = extractor.classify(document_path, classifications, image=True)
print(result.name, result.confidence)
```

<!-- openwiki: broken internal link [openwiki/extraction-and-classification.md] file "openwiki/extraction-and-classification.md" does not exist. Fix the href or restore the target, then delete this comment. -->
`ClassificationResponse` carries `name`, a confidence 1–10, and the matched `Classification`. For consensus across multiple extractors or hierarchical classification, use `Process.classify` with a `ClassificationStrategy` or `ClassificationTree` (see [Extraction and Classification](openwiki/extraction-and-classification.md)).

## Splitting a multi-document PDF

For a PDF containing several logical documents, use `Process` with a `Splitter`:

```python
from extract_thinker import Process, Classification, ImageSplitter, SplittingStrategy, DocumentLoaderPyPdf

process = Process()
process.load_document_loader(DocumentLoaderPyPdf())
process.load_splitter(ImageSplitter(model="gpt-4o-mini"))

split_content = (
    process.load_file("multi_page.pdf")
    .split(classifications, strategy=SplittingStrategy.LAZY)
    .extract()
)
```

<!-- openwiki: broken internal link [openwiki/splitting-and-document-groups.md] file "openwiki/splitting-and-document-groups.md" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [openwiki/process-workflow.md] file "openwiki/process-workflow.md" does not exist. Fix the href or restore the target, then delete this comment. -->
EAGER inspects the whole document in one call; LAZY compares consecutive pages pairwise and requires a PDF source. The split result is a list of extracted objects, one per logical document/{`SplittingStrategy`}. See [Splitting and Document Groups](openwiki/splitting-and-document-groups.md) and [Process Workflow](openwiki/process-workflow.md).

## Batch processing

For OpenAI model-gated batch extraction, use `extractor.extract_batch`, which returns a `BatchJob`:

```python
batch_job = extractor.extract_batch(source, ReceiptContract, vision=True)
status = await batch_job.get_status()
results = await batch_job.get_result()
```

<!-- openwiki: broken internal link [openwiki/batch-processing.md] file "openwiki/batch-processing.md" does not exist. Fix the href or restore the target, then delete this comment. -->
Only `gpt-4o-mini`, `gpt-4o`, `gpt-4o-2024-08-06`, and `gpt-4` are supported, and the pydantic-ai backend is rejected. `get_result()` polls the OpenAI batch every 60s (see [Batch Processing](openwiki/batch-processing.md)). `extract_batch` writes a local `extract_thinker_batch/` directory under the current working directory.

## LLM selection and routers

<!-- openwiki: broken internal link [openwiki/llm-integration.md] file "openwiki/llm-integration.md" does not exist. Fix the href or restore the target, then delete this comment. -->
`extractor.load_llm(model)` accepts a provider-prefixed model string (e.g. `gpt-4o`, `gemini/gemini-2.5-flash-preview-05-20`) or an existing `LLM` instance. `examples/resume_processor.py` shows wiring a LiteLLM `Router` with fallback models and using `content=` to pass an extracted role as extra context into a resume extraction. See [LLM Integration](openwiki/llm-integration.md).

## Configuration and deployment caveats

- Runtime behavior (batch latency, LLM API availability, model output quality) depends on the external provider and is **not** established by the source code. Model names and credentials are environment/provider-specific.
<!-- openwiki: broken internal link [openwiki/document-loaders.md] file "openwiki/document-loaders.md" does not exist. Fix the href or restore the target, then delete this comment. -->
- Loaders that call external services (Azure, AWS Textract, Google Document AI, Mistral OCR, Tesseract binary) require their own configuration and optional packages; see [Document Loaders](openwiki/document-loaders.md).
- `DocumentLoaderTesseract` in the examples uses `"/opt/homebrew/bin/tesseract"` — you must point `tesseract_cmd` at your own Tesseract install (or set `TESSERACT_PATH` for containers).
