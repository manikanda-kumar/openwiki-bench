# Files

- [Admin Settings and Configuration](admin-and-configuration.md) - The two configuration planes of a deployment — env-var-driven auth/hard config vs the AdminSettings-DO-owned soft AdminConfig mirrored to KV — how hot paths read it, and what the admin panel can govern (connectors, provisioning modes, branding, formats, flags).
- [Deployment and Release Pipeline](deployment-and-release.md) - How customer instances get built and shipped — byte-identical worker bundling, the placeholder manifest contract, content-addressed R2 releases with the candidate/promote gate, deploy-wizard inputs, and per-PR preview environments.
- [Logging and Error Reporting](logging-and-error-reporting.md) - Server-side structured logging conventions, the typed observability context, optional external issue reporting, the gadget console-log streaming path, and the opt-in frontend error-reporting pipeline with its trust boundaries.
