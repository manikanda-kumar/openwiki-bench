---
type: "Reference"
title: "Architecture Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-92ee41b85171e4663a071a13
    resource: repo://extract_thinker/models/contract.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-6f15e1b96851940c1a469907
    resource: repo://extract_thinker/warning.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---


# Architecture Overview

ExtractThinker is a Python library for extracting structured data from
documents using LLMs, architected as a set of orthogonal modules. The public
surface is exported in `extract_thinker/__init__.py`.

## Modules and responsibilities

- **Document Loaders** (`extract_thinker/document_loader/`): read a source
  (path, stream, or URL) and return a list of page dicts with text and optional
  image bytes. Providers include Tesseract OCR, PyPDF, PDFPlumber, Docling,
  Mistral OCR, AWS Textract, Google Document AI, Azure Form, MarkItDown, and
<!-- openwiki: broken internal link [openwiki/architecture/document-loaders.md] file "openwiki/architecture/document-loaders.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  others). See [Document Loaders](openwiki/architecture/document-loaders.md).
- **LLM** (`extract_thinker/llm.py`): wraps completion providers (litellm +
  instructor, or pydantic-ai) and issues validated structured requests,
  supporting thinking mode, routers, and token budgeting. See
<!-- openwiki: broken internal link [openwiki/architecture/llm.md] file "openwiki/architecture/llm.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  [LLM Abstraction and Backends](openwiki/architecture/llm.md).
- **Extractor** (`extract_thinker/extractor.py`): the main entrypoint that
  loads content, builds LLM messages honoring a `response_model`, dispatches
  completion strategies, classifies documents, and manages OpenAI batch jobs.
<!-- openwiki: broken internal link [openwiki/architecture/extractor.md] file "openwiki/architecture/extractor.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  See [Extractor and Extraction Flows](openwiki/architecture/extractor.md).
- **Process** (`extract_thinker/process.py`): an orchestration layer that
  classifies documents (consensus, higher-order, or tree) and splits them into
<!-- openwiki: broken internal link [openwiki/architecture/process-and-splitters.md] file "openwiki/architecture/process-and-splitters.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  groups before extraction. See [Process and Splitters](openwiki/architecture/process-and-splitters.md).
- **Contracts** (`extract_thinker/models/contract.py`): Pydantic models
  (`Contract`, a `BaseModel` subclass) that define the expected extraction
  schema.
- **Splitters** (`extract_thinker/splitter.py`, `image_splitter.py`,
  `text_splitter.py`): divide a multi-page document into groups using eager or
  lazy strategies.
- **Completion handlers** (`completion_handler.py`, `pagination_handler.py`,
  `concatenation_handler.py`): implement the `FORBIDDEN`, `PAGINATE`, and
  `CONCATENATE` completion strategies for long documents. See
<!-- openwiki: broken internal link [openwiki/architecture/completions.md] file "openwiki/architecture/completions.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  [Completion Strategies](openwiki/architecture/completions.md).
- **Markdown conversion** (`extract_thinker/markdown/`): converts documents to
  Markdown, optionally with structured per-page certainty scoring. See
<!-- openwiki: broken internal link [openwiki/architecture/markdown-conversion.md] file "openwiki/architecture/markdown-conversion.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  [Markdown Conversion](openwiki/architecture/markdown-conversion.md).
- **Classification models** (`extract_thinker/models/`):
  `Classification`, `ClassificationResponse`, `ClassificationTree`/`Node`. See
<!-- openwiki: broken internal link [openwiki/architecture/classification-models.md] file "openwiki/architecture/classification-models.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  [Classification Contracts and Tree](openwiki/architecture/classification-models.md).
- **Evals** (`extract_thinker/eval/`): datasets, `Evaluator` and
  `TeacherStudentEvaluator`, field comparison, hallucination detection, cost
<!-- openwiki: broken internal link [openwiki/operations/evals.md] file "openwiki/operations/evals.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  tracking, and reports. See [Evaluation and Quality Metrics](openwiki/operations/evals.md).

## Control and data flow

A typical single-document extraction:

1. User builds an `Extractor`, loads a `DocumentLoader` and an `LLM`, and calls
   `extract(source, response_model)`.
2. `Extractor` selects a loader (extractor.py:92-126), calls `load(source)`,
   and normalizes the result into a universal
   `{"content": str, "images": List[bytes], "metadata": {...}}` format
   (extractor.py:337-432).
3. `Extractor` builds a system message plus a `##Content` user message, injects
   optional `##Extra Content`, and dispatches by `completion_strategy`
   (extractor.py:1115-1147).
4. `LLM.request` issues the structured completion and returns a Pydantic
   instance matching `response_model`.

For multi-page workflows, `Process` classifies and splits the document into
groups, then runs one extraction per group using the classification's
`extractor`/`extraction_contract` (process.py:240-308).

The library is imported via `extract_thinker/__init__.py`, which also calls
`filter_pydantic_v2_warnings()` to silence a known pydantic v2 warning.
