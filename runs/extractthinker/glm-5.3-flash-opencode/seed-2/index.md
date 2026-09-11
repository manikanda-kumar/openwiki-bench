---
okf_version: "0.2"
---

# Files

- [Architecture Overview](architecture-overview.md) - System-level map of ExtractThinker's core objects, ownership boundaries, and the end-to-end document-to-structured-data flow.
- [Batch Processing](batch-processing.md) - How Extractor.extract_batch creates OpenAI batch jobs — model gating, JSONL generation, upload, polling, and result parsing via BatchJob.
- [Change Guides](change-guides.md) - Step-by-step maintenance guides for adding a document loader, LLM backend behavior, or CompletionStrategy, with the tests each change must touch.
- [Classification](classification.md) - How ExtractThinker assigns documents to user-defined categories via Extractor.classify (text and vision paths), layered Process strategies, and hierarchical ClassificationTree navigation.
- [Completion Strategies](completion-strategies.md) - How FORBIDDEN, PAGINATE, and CONCATENATE govern what happens when document content exceeds what fits in one LLM completion — single-request failure, parallel per-page extraction with conflict resolution, or iterative JSON continuation.
- [Document Loaders](document-loaders.md) - The DocumentLoader contract, caching, vision and pagination capabilities, URL screenshot support, and the catalog of loader implementations with their external dependencies.
- [Evaluation Framework](eval-framework.md) - The extract_thinker.eval subsystem — Evaluator runs extraction against labeled datasets, with configurable field comparison, hallucination detection, cost tracking, teacher-student benchmarking, and a config-file CLI.
- [Extractor and Extraction Flow](extractor-and-extraction-flow.md) - The complete Extractor pipeline — dependency validation, loader resolution, universal content mapping, multi-source merging, message construction, interceptors, and error mapping to ExtractThinkerError.
- [LLM Layer](llm-layer.md) - The LLM class wraps litellm+instructor or pydantic-ai behind one interface, with router fallbacks, thinking budgets sized by page count, dynamic JSON parsing, and token/temperature/timeout knobs.
- [Quickstart](quickstart.md) - Get ExtractThinker running from source — install, environment variables, first extraction, vision mode, process pipelines, and tests.
- [Splitting and the Process Orchestrator](splitting-and-process.md) - Process bundles classification, a splitter, and extractors to segment multi-document files into page groups and extract each group under its matched classification's contract.
