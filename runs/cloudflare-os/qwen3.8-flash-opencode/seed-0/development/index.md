# Files

- [Build System and Toolchain](build-tooling.md) - How this pnpm workspace builds — Vite+ (vp) recursive task cache semantics, the build-time env declaration rules that keep cached builds honest, tsgo/tsconfig decisions, lint via vp's oxlint, and the codegen tasks each build runs first.
- [Testing Strategy and Harnesses](testing.md) - The repo's test layers — node --test script suites, per-package vitest tasks (Node vs workerd pools), the assert-workerd fallback guard and with-timeout watchdog, golden-file manifests, and the out-of-process integration-tests harness with its fixture gatekeeper and fresh-identity rules.
