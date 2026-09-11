# Files

- [Classification](classification.md) - How documents are classified against user-defined Classification types, including text and image paths, multi-layer extractor strategies, and hierarchical trees.
- [Completion Strategies](completion-strategies.md) - FORBIDDEN, PAGINATE, and CONCATENATE extraction strategies and the handlers that implement page-parallel merging and streamed JSON continuation.
- [Document Loaders](document-loaders.md) - The DocumentLoader abstraction — capability probing, per-page normalized output, vision mode, caching — and the catalog of concrete loaders for PDFs, images, OCR services, and web content.
- [Extraction Flow and Error Handling](extraction-flow.md) - The end-to-end extract() pipeline — dependency validation, loader selection, content normalization, message building, completion-strategy dispatch — plus its exception model.
- [Splitting and Process Workflow](splitting.md) - Splitter boundary detection, DocGroups, eager vs lazy strategies, and the Process load_file/split/extract orchestration of multi-document files.
