# Files

- [Gadget Sandbox and Client Integration](gadget-sandbox.md) - How gadget UIs run in a fully sandboxed iframe with a postMessage RPC bridge to the gadget's server-side DO facet, how console logs and escape keys cross the boundary, the capsule overlay for attaching resources, and the export pipeline (default HTML/PDF, custom server formats, Puppeteer browser rendering).
- [Frontend SPA and Connection Lifecycle](spa.md) - The workshop-frontend single-page app — global WebSocket connection management with jittered backoff, probes, and a promise-backed stub replacement; the React context tree; file-based routing; and the conventions that keep RPC stubs safe in React state.
