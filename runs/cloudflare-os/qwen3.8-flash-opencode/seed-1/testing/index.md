# Files

- [Integration Test Harness](integration-harness.md) - packages/integration-tests boots real Workers under wrangler's createTestHarness with no stubs but the network — why fake timers cannot work, why a fixture gatekeeper covers overseer logic, the storage-isolation-by-identity convention, and the capnweb single-copy boundary.
- [Testing and Build Tooling](testing-and-tooling.md) - The Vite+ task cache and its silent-staleness pitfalls (env stripping, value-vs-path fingerprinting, read-and-write paths), the with-timeout watchdog, the assert-workerd pool guard, oxlint configuration, and how to run one package's tests.
