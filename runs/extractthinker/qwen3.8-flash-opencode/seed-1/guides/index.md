# Files

- [How to Add a Document Loader](adding-a-document-loader.md) - Step-by-step change guide: implement a Config dataclass and CachedDocumentLoader subclass returning the page-dict format, register exports, route it in Extractor/Process, and test it.
- [Debugging Extraction Failures](debugging-extraction-failures.md) - Triage guide: map exception types and messages to root causes, understand the wrapping rules that hide causes, and account for the silent fallbacks that change results without raising.
- [Tuning Extraction Quality](tuning-extraction-quality.md) - Change guide for improving extraction accuracy: contract-to-prompt rendering, completion strategy trade-offs, thinking budgets and temperature, classification consensus, and measuring with the eval framework.
