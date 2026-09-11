---
okf_version: "0.2"
---

# Files

- [ExtractThinker Architecture and Component Map](architecture.md) - How ExtractThinker's Extractor, Process, document loaders, LLM layer, splitters, completion handlers, and data models fit together, and how a document flows from source to structured output.
- [Batch Processing via OpenAI Batch API](batch-processing.md) - How Extractor.extract_batch and BatchJob submit extraction work to the OpenAI Batch API, including model gating, JSONL creation, status polling, result parsing, cancellation, and cleanup.
- [Completion Strategies — Paginate and Concatenate](completion-strategies.md) - How CompletionStrategy.FORBIDDEN, PAGINATE, and CONCATENATE route long-content extraction through PaginationHandler and ConcatenationHandler, including optional-field models, parallel per-page processing, merging, and conflict resolution.
- [Contracts, Classifications, and Data Models](contracts-and-classifications.md) - The Pydantic data model layer of ExtractThinker — Contract marker, Classification, classification responses and trees, strategy enums, and document-group models — and how contracts shape LLM prompts.
- [Document Loaders](document-loaders.md) - The DocumentLoader ABC contract, CachedDocumentLoader caching, the universal page output format, vision mode and PDF/URL conversion, and the catalog of concrete loaders with their configuration dataclasses.
- [Evaluation Framework](eval-framework.md) - The extract_thinker.eval subpackage — Evaluator metrics, field comparisons, hallucination detection, cost tracking, datasets, reports, and the extract_thinker-eval CLI.
- [Extractor — Extraction and Classification Engine](extractor.md) - The Extractor class — dependency validation, loader selection, vision mode, message building, the exception funnel, text/vision classification, async wrappers, interceptors, and thinking-mode controls.
- [LLM Integration Layer](llm-integration.md) - The LLM class — dual backends (litellm+instructor and pydantic-ai), router fallbacks, thinking-mode token budgets derived from page counts, dynamic JSON parsing, and the request parameters each knob controls.
- [Markdown Conversion](markdown-conversion.md) - MarkdownConverter turns documents into LLM-generated Markdown — plain or structured with per-item certainty scores — with parallel per-page processing and message building copied from Extractor.
- [Packaging, CI, and Operations](operations.md) - How ExtractThinker is packaged (Poetry), validated in CI (critical tests, multi-Python install checks), published to PyPI, linted/formatted (ruff, flake8, pre-commit), and documented (mkdocs-material site).
- [Process — Multi-Document Split-and-Extract Workflow](process-workflow.md) - The Process class orchestrates multi-document pipelines — load_file, split with EAGER/LAZY strategies, layered classification with consensus strategies or classification trees, and concurrent per-group extraction.
- [Quickstart](quickstart.md) - Install ExtractThinker, configure API keys, run your first extraction and classification, and navigate the test suite and this wiki.
- [Splitting Strategies and Splitters](splitting.md) - How Splitter, ImageSplitter, and TextSplitter detect document boundaries — pairwise page comparison with sliding-window aggregation, EAGER vs LAZY strategies, and conservative fallbacks when LLM analysis fails.
- [Testing Guide](testing.md) - How the ExtractThinker test suite is organized (critical, per-loader, component, evaluator tests), which tests need live API keys versus offline fixtures, and how to run them locally and in CI.

# Directories

- [guides](guides/)
