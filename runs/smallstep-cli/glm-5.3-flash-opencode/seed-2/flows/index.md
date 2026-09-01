# Files

- [CA Bootstrap Flow](ca-bootstrap.md) - How step ca bootstrap resolves authority data (direct or via team API), downloads and pins the root certificate, writes defaults.json, sets up contexts, and optionally installs trust.
- [Certificate Renewal and Lifecycle](certificate-renewal.md) - How step ca renew, rekey, and revoke keep certificates fresh — mTLS vs token authentication, the daemon timing model with jitter, reload hooks, and the systemd cert-renewer units.
- [OAuth and Single Sign-On](oauth-and-sso.md) - How step oauth performs the OAuth2/OIDC flows (loopback authorization code with PKCE, out-of-band, device grant, JWT bearer, and self-signed JWT), including provider discovery and output modes.
- [SSH Certificates](ssh-certificates.md) - The step ssh command group — user/host certificate issuance, SSH agent integration (login/logout/list), config generation, host checking, hosts discovery, and bastion proxying.
- [Token Generation](token-generation.md) - How step builds and signs the JWT one-time tokens used to authenticate to step-ca — claim defaults, per-type audiences, provisioner selection, offline token generation, and the per-provisioner generators.
- [X.509 Certificate Issuance](x509-certificate-issuance.md) - The step ca certificate and step ca sign flow from token generation through CSR creation to the signed certificate — online via the step-ca Sign API, or offline against a local authority.
