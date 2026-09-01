# Files

- [Integration tests and the wrangler harness](integration-harness.md) - The end-to-end suite — wrangler createTestHarness boots the real backend and gatekeepers, the network interceptor guarantees nothing reaches the internet, the Cap'n Web RPC client speaks the browser's transport, and the fixture gatekeeper makes observer denials testable.
- [Test layout across packages](test-layout.md) - Where the tests live and why — vitest node vs workerd pools with the assert-workerd guard, the shared cached test task with its scratch exclusions and watchdog, the root scripts suite, and how to run per-package suites.
