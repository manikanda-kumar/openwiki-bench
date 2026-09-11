---
okf_version: "0.2"
---

# Files

- [Architecture and Core Data Flow](architecture.md) - How ExtractThinker's modular components fit together, the universal content format, and the end-to-end control flow from raw document to validated structured data.
- [Batch Processing](batch-processing.md) - Asynchronous, lower-cost extraction through the OpenAI Batch API, including model allow-listing, JSONL job construction, status polling, result parsing, and cleanup.
- [Change Guides](change-guides.md)
- [Document Classification](classification.md) - How ExtractThinker decides what a document is — the Classification model, confidence semantics, the text-only and image-comparison classification paths, multi-extractor strategies, and hierarchical classification trees.
- [Completion Strategies](completion-strategies.md) - How ExtractThinker handles very long documents when a single LLM response is not enough — the FORBIDDEN, PAGINATE, and CONCATENATE strategies, page-parallel merging, conflict resolution, and partial-JSON continuation.
- [Document Loaders](document-loaders.md) - The DocumentLoader family — the base contract, caching, capability checks, vision mode, the universal page output format, and every concrete loader with its config and dependencies.
- [Evaluation Toolkit](evaluation.md) - The eval subsystem for measuring extraction quality — Evaluator and TeacherStudentEvaluator, datasets, field/document/schema/time metrics, cost tracking, hallucination detection, field comparison types, reports, and the CLI.
- [Extraction Pipeline (Extractor)](extraction.md) - The Extractor orchestrator — how it validates dependencies, resolves loaders, handles single vs multi-source and vision input, dispatches completion strategies, runs interceptors, and classifies failures.
- [LLM Integration and Backends](llm-integration.md) - How ExtractThinker wraps model access — the litellm+instructor DEFAULT backend and the pydantic-ai backend, structured request flow, dynamic parsing, thinking-mode token budgets, routers, and tuning knobs.
- [Markdown Conversion](markdown-conversion.md) - The MarkdownConverter — converting documents to plain or structured Markdown with an LLM, the PageContent/ContentItem models, vision-based page processing, and non-LLM fallback.
- [Process and Splitting](process-and-splitting.md) - The Process orchestration API and the Splitter family — eager vs lazy splitting, page-grouping via an LLM, doc-group aggregation, and per-group extraction dispatch.
- [ExtractThinker Quickstart](quickstart.md) - Install ExtractThinker, configure a document loader and LLM, and run your first extraction, classification, and split workflows with the public API.
