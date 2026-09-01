# Files

- [CA Client Integration](ca-client.md) - The CaClient abstraction — how commands obtain online step-ca clients, the offline in-process authority (and why it is a singleton), and the admin API client with on-the-fly admin credentials.
- [KMS and Plugin Integrations](kms-and-plugins.md) - How step integrates external key stores — the exec-based step-<name>-plugin dispatch, the built-in step-kms-plugin signer bridge in internal/cryptoutil, KMS URI detection, and the in-process TPM attestation flow.
