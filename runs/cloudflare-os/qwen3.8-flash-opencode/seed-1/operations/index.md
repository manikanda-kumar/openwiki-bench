# Files

- [Configuration and Admin Settings](configuration-and-admin.md) - The two configuration surfaces — env-var-driven auth/config vs the AdminConfig soft customizations owned by the AdminSettings DO and mirrored to KV — plus connector enable/disable defaults, ambient provisioning modes, branding, feature flags, and the AI Gateway limits flow.
- [Observability and Error Reporting](observability.md) - Structured logging conventions (typed log fields, reserved secret-ish field names, ambient ALS context), the optional external issue Reporter with bounded reports, the frontend error-reporting contract, and product analytics events.
- [Release Pipeline](release-pipeline.md) - How customer instances get deployed — byte-stable release builds with content-addressed blobs, the placeholder manifest contract, manifest-last upload with candidate/promote gating, deploy-wizard inputs, and the fork-secret security model of preview deployments.
