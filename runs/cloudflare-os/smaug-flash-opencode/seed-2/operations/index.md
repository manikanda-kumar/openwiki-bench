# Files

- [Deployment Admin Configuration](admin-config.md) - The deployment-level AdminConfig — what it covers, the AdminSettings DO and its KV mirror, the one-time-check AdminApi capability, ambient gatekeeper modes, resource toggles, formats promotion, and branding.
- [Authentication and Sign-in](auth.md) - The three auth modes (password, Cloudflare Access, gatekeeper OAuth) and their configuration — AUTH_GATEKEEPERS, DISABLE_PASSWORD_AUTH, email-keyed identity, transient login grants, and the PendingLogin DO.
- [Build, Test, and Lint](build-test.md) - How to build, type-check, test, and lint the workspace — the Vite+ task/cache model, the exact command matrix, workerd suites, the single-threaded tsc rationale, and how caching strips the environment.
- [Release Pipeline](release.md) - The scripts/release pipeline — byte-identical worker bundling, the release manifest contract with placeholders, the R2 content-addressed upload and promote flow, and the deploy wizard config.
