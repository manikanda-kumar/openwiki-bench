# Files

- [Deployment and CI/CD](deployment.md) - The Terraform delivery model — Cloudflare workers, D1 with hash-triggered migrations, queues/DLQs, KV/R2, cron triggers, the two-phase Durable Object binding procedure, provider and web-platform toggles, the Modal runbook — plus the GitHub Actions pipelines that deploy pushes to main.
- [Testing Strategy](testing.md) - How Open-Inspect verifies itself — per-package Vitest suites, control-plane integration tests in real workerd/Miniflare with migrated D1, pytest suites for the Python plane, cross-language contract tests that read the other plane's source, and the lint/boundary guardrails CI runs on every push.
