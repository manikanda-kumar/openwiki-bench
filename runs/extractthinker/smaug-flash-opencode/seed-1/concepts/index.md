# Files

- [Completion Strategies for Large Documents](completion-strategies.md) - How ExtractThinker handles incomplete or truncated LLM output for large documents through CompletionStrategy (FORBIDDEN, PAGINATE, CONCATENATE) and the PaginationHandler and ConcatenationHandler implementations.
- [Contracts and Classification](contracts-classifications.md) - The Contract BaseModel schema-typing pattern, Classification objects, ClassificationResponse, classification strategies, and hierarchical classification trees used to route documents to extraction contracts.
- [Document Loaders](document_loaders.md) - The DocumentLoader abstraction, the standard page-based load output format, TTLCache caching with vision-mode keys, vision handling, and an inventory of every concrete loader with its supported formats.
- [Evaluation and Quality Metrics](evaluation.md)
- [Extractor and Extraction Pipeline](extractor.md)
- [LLM Integration](llm-integration.md) - The LLM wrapper that unifies model backends (LiteLLM+instructor and pydantic-ai), the request and raw_completion paths, response_model handling, thinking mode, token/thinking budgets, dynamic parsing prompts, routers, and timeouts.
- [Markdown Conversion](markdown.md) - The MarkdownConverter component that converts documents to Markdown, including structured and plain conversion modes, LLM-based vision processing, page selection, placeholder handling, and fallback behavior.
- [Domain Model Objects](model-objects.md)
- [Process and Document Splitting](process-splitting.md) - The Process component that chains file loading, document splitting under classifications, and per-group extraction, plus the Splitter abstractions (ImageSplitter, TextSplitter) with eager and lazy strategies.
