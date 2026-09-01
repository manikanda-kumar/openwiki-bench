# Files

- [ACME Protocol Flows](acme-protocol.md) - How the step CLI obtains certificates through the ACME protocol — routing from token flows, standalone/webroot HTTP challenge modes, device attestation, and external ACME CAs.
- [CA Initialization and Bootstrap](ca-initialization-and-bootstrap.md) - How step ca init generates a PKI and CA configuration (deployment types, RA modes, KMS), and how step ca bootstrap downloads and trusts a CA's root and writes the environment defaults.
- [Certificate Issuance](certificate-issuance.md) - End-to-end issuance with step ca certificate and step ca sign — token generation, CSR/SAN construction, key generation, online vs offline backends, and writing the signed chain.
- [Certificate Renewal, Rekey and Revocation](certificate-lifecycle.md) - Lifecycle operations for issued certificates — step ca renew (mTLS vs X5C token, daemon loop, pid/signal/exec hooks), step ca rekey, and step ca revoke (token vs mTLS, passive revocation, reason codes).
- [Offline X.509 Operations](offline-x509-operations.md) - The step certificate command group for creating, signing, verifying, inspecting, and fingerprinting X.509 certificates and CSRs without a CA, including profiles and templates.
- [SSH Certificate Workflows](ssh-certificates.md) - The step ssh command group — obtaining and using short-lived SSH certificates, agent interaction, login/logout, client configuration, and the ProxyCommand host-registry flow.
