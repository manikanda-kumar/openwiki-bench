# Files

- [Batch Processing](batch-processing.md) - Extractor.extract_batch and BatchJob: an OpenAI Batch-API pipeline with JSONL temp files, status polling, instructor parsing, and destructor-driven cleanup.
- [Classification & Splitting (Process)](classification-and-splitting.md) - How Process orchestrates multi-layer document classification, eager/lazy page-group splitting via LLM splitters, and per-group extraction.
- [Completion Strategies](completion-strategies.md) - How FORBIDDEN, PAGINATE, and CONCATENATE handle long structured outputs: per-page partial extraction with LLM conflict resolution, and raw-JSON continuation loops.
- [Contracts & Shared Models](contracts-and-models.md) - The Pydantic/enum data model shared across ExtractThinker: Contract, Classification and classification responses, doc-group containers, strategy enums, and the exception hierarchy.
- [Document Loaders](document-loaders.md) - The DocumentLoader hierarchy: capability detection (can_handle/vision/paginate), TTL caching, the universal page format, URL screenshots, and the concrete loaders grouped by backend.
- [Evaluation Framework](evaluation.md) - The extract_thinker.eval subsystem: Evaluator and TeacherStudentEvaluator runs, datasets, field comparison, metrics, hallucination detection, cost tracking, reports, and the eval CLI.
- [Extractor Core](extractor.md) - The Extractor class internals: two loader-resolution strategies, dependency validation, state-on-instance request parameters, error taxonomy, dead seams, and the batch/thinking entrypoints.
- [LLM Integration](llm-integration.md) - The LLM facade: litellm+instructor default backend, optional pydantic-ai agents, LiteLLM routers, thinking budgets derived from page counts, and dynamic-output parsing.
- [Markdown Conversion](markdown-conversion.md) - MarkdownConverter: LLM-driven document-to-Markdown (to_markdown) and certainty-scored structured PageContent extraction (to_markdown_structured), with parallel per-page processing and placeholder-aware prompts.
