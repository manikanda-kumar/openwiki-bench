# Files

- [Build, Test, and Lint Workflows](build-and-test.md)
- [Change Guide — Adding a New Gatekeeper](extending-gatekeepers.md) - The full, review-oriented workflow to author, wire up, and ship a new gatekeeper package for Cloudflare OS, including the two-phase implementation path, the configurator-ui build, registration, and the review bar.
- [Change Guide — MCP & Share-Sensitive Services](mcp-sharing.md) - A representative security-focused change guide for packages/mcp-shared and packages/gatekeeper-cloudflare, where trust boundaries and scopes fail closed, including the cloudflare observability layering and concretely-scoped example changes.
- [Release Pipeline](release-pipeline.md) - How Cloudflare OS customer instances are deployed — build-release's byte-identical, manifest-based flow; upload to R2 content-addressed and candidate-then-promote; the placeholder-manifest contract; and the deploy-wizard input defaults.
