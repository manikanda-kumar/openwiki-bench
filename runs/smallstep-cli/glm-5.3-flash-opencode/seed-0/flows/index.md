# Files

- [Authority Setup - ca init and ca bootstrap](authority-setup.md) - End-to-end flows for standing up a new PKI with step ca init and connecting a client to an existing authority with step ca bootstrap.
- [OAuth and OIDC Sign-On](oauth.md) - How step oauth obtains OAuth 2.0 and OIDC tokens - loopback PKCE, device, out-of-band, and service-account flows - and how CA OIDC provisioning reuses it.
- [Renewal, Rekey, and Revocation](renewal-rekey-revocation.md) - How step ca renew, rekey, and revoke work - mTLS vs renewal-token auth, daemon scheduling, service reload hooks, needs-renewal exit codes, and the systemd units.
- [SSH Certificate Lifecycle](ssh-certificates.md) - The step ssh command family - certificate issuance, agent-integrated login, identity certificates with machine UUID SANs, config installation, and bastion proxying.
- [X.509 Issuance Flow](x509-issuance.md) - The end-to-end step ca certificate and step ca sign flows - token acquisition, key and CSR creation with per-provisioner SAN defaults, validation, the API sign call, and offline mode.
