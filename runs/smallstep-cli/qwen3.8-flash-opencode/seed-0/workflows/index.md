# Files

- [CA Administration Commands](ca-administration.md) - The step ca administration command tree — ca init (pki.Setup-driven), provisioner CRUD with admin-API-vs-ca.json fallback, admins, ACME EAB, webhooks, policy levels, health and federation queries.
- [Certificate Issuance and Renewal Workflows](certificate-lifecycle.md) - End-to-end X.509 lifecycle in step — ca certificate/sign/renew/rekey/revoke, offline ca.json signing, local step certificate create/sign, and the ACME http-01 and device-attest-01 issuance paths with EAB management.
- [OAuth and JOSE Toolkit Workflows](oauth-and-jose.md) - step oauth's four grant flows with embedded Google clients and loopback/device/OOB/JWT-bearer handling, plus the crypto toolkit (jwt/jws/jwe/jwk/kdf/otp/nacl/hash) built on go.step.sm/crypto.
- [SSH Certificate Workflows](ssh-certificates.md) - step ssh user/host certificate lifecycle — login/logout with ssh-agent integration, config templates fetched from the CA, proxycommand with bastion exec, renewal tooling and systemd units, plus crl inspection utilities.
