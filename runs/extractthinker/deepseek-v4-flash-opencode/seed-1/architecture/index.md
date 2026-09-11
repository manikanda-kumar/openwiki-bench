# Files

- [Document Classification](classification.md) - How ExtractThinker assigns a document (or document pages) to one of a set of user-defined classes, using text-only prompts, vision-based image comparison, extractor-group strategies, and hierarchical classification trees.
- [Document Loaders](document-loaders.md) - The document-loader subsystem that turns files, streams, URLs, and raw data into a standardized list-of-pages format for the extraction pipeline, including format detection, caching, vision mode, and the full catalog of concrete loaders.
- [Evaluation Subsystem](evaluation.md)
- [Extraction Pipeline](extraction.md)
- [LLM Integration](llm-integration.md) - The LLM class is the single adapter for talking to language models, supporting a litellm+instructor backend with structured outputs and a pydantic-ai backend, plus router fallbacks, thinking mode with token budgeting, dynamic prompt parsing, and raw completion.
- [Architecture Overview](overview.md) - How ExtractThinker is organized as a layered document-intelligence library, the ownership boundaries between its public API, models, document loaders, LLM adapter, orchestration classes, and evaluation package, and the shared page-based data flow.
- [Process Workflow and Splitting](process-and-splitting.md) - The Process class composes classification, splitting, and per-group extraction for multi-page documents, with eager and lazy strategies implemented by ImageSplitter and TextSplitter over the Splitter ABC.
