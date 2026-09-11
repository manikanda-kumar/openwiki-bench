# Files

- [Completion Strategies](completion-strategies.md) - How FORBIDDEN, PAGINATE, and CONCATENATE completion strategies route extraction through the LLM, including per-page parallel merge with conflict resolution and the JSON continuation loop.
- [Document Loaders](document-loaders.md) - The DocumentLoader abstraction — capability detection, vision rasterization, URL screenshots, TTL caching, config dataclasses — and the concrete loader family (OCR, PDF, cloud, web, spreadsheet, data).
- [Extractor Core](extractor.md) - The Extractor facade — dependency validation, the two loader-resolution orders, universal content mapping, extraction, classification, batch entry points, vision fallback, interceptors, and error normalization.
- [LLM Integration](llm-integration.md) - The LLM wrapper over litellm+instructor and pydantic-ai — request construction, router support, thinking budgets, token math, dynamic parsing, raw completions, and provider model helpers.
- [Process Orchestration — Classification, Splitting, Batch](process-orchestration.md) - The Process multi-document pipeline (consensus/tree classification, eager vs lazy splitting with Text/Image splitters, per-group extraction) plus the OpenAI BatchJob lifecycle.
