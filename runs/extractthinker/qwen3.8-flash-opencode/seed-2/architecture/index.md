# Files

- [Configuration and Failure Handling](configuration-and-failure-handling.md) - How ExtractThinker is configured (constructor parameters, per-loader config dataclasses, the two environment variables it reads) and how failures surface (exception hierarchy, error mapping in extract(), loader retry and fallback semantics, print-based diagnostics).
- [Architecture Overview](overview.md) - Component map and ownership boundaries of ExtractThinker: document loaders, the Extractor pipeline, LLM layer, Process/splitters, completion handlers, batch, eval, and markdown subsystems, connected by a page-dict/universal-content data contract.
