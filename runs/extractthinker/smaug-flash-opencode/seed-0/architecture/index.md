# Files

- [Classification Contracts and Tree](classification-models.md)
- [Completion Strategies and Handlers](completions.md) - How ExtractThinker handles multi-page or long-output extraction when a single LLM completion cannot cover the whole document, through FORBIDDEN, PAGINATE, and CONCATENATE strategies.
- [Document Loaders](document-loaders.md) - The DocumentLoader abstraction in ExtractThinker, including the base contract, caching, vision mode, format support, loader selection, and representative provider loaders.
- [Extractor and Extraction Flows](extractor.md) - The Extractor class in ExtractThinker, covering extraction and classification entrypoints, dependency validation, vision mode, message construction, completion strategy dispatch, batch processing, and error handling.
- [LLM Abstraction and Backends](llm.md) - The LLM class in ExtractThinker, covering backends, thinking mode, router support, dynamic prompting, token and temperature configuration, and request handling.
- [Markdown Conversion](markdown-conversion.md) - The MarkdownConverter in ExtractThinker, which turns documents into Markdown, extracting structured per-page content with certainty scores and handling vision and basic fallbacks.
- [Architecture Overview](overview.md)
- [Process and Splitters](process-and-splitters.md) - The Process orchestration layer in ExtractThinker, covering classification strategies and tree classification, eager/lazy splitting, and per-group extraction.
