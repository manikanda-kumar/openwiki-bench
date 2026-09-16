---
okf_version: "0.2"
---

# Files

- [CA Administration: Provisioners, Admins, Policies, ACME EAB](administration.md) - How the step CLI manages step-ca administrative resources: the provisioner CRUD backends (Admin API vs ca.json fallback), JWK provisioner key encryption, x5c-based admin credentials, issuance policies, ACME EAB keys, and the hidden Smallstep API token command.
- [Build, Release, and Packaging](build-and-release.md) - How step is built and shipped: Makefile build/version/ldflags logic, the GoReleaser release configuration (archives, nFPM packages, cosign signing, S3 blobs, winget/scoop), platform packaging assets (debian, docker, systemd, powershell, scripts), and the GitHub Actions workflows.
- [Configuration, State Files, and Flags](configuration-and-state.md) - The step CLI's on-disk state under STEPPATH (defaults.json, contexts.json, current-context.json, ca.json, root CA, TPM and plugin directories), the global and shared flag system in flags/, and the environment variables the code reads.
- [Crypto Toolkit Commands](crypto-toolkit.md) - The step crypto command family (JWT/JWK/JWS/JWE/JOSE, key, hash, KDF, NaCl, OTP, rand, winpe, change-pass, keypair), KMS-aware key loading via step-kms-plugin in internal/cryptoutil, and the auxiliary step base64 and step fileserver commands.
- [Failure Handling and Security Conventions](failure-and-security.md) - Cross-cutting error model and exit codes (errs, STEPDEBUG, panic handler), input validation patterns, and the CLI's security gates: https-only CA URLs, fingerprint-validated roots, token parsing, subtle/insecure flags, and password/key handling.
- [OAuth 2.0 and OIDC Client](oauth.md) - The step oauth command: provider discovery, loopback (default), manual/OOB, device, jwt-bearer (two-legged) and service-account JWT flows, the local callback server with PKCE, console mode, --bare/--oidc output, and how it feeds OIDC provisioner tokens to CA commands.
- [Quickstart](quickstart.md) - Get developers building, testing, and running the step CLI: environment bootstrap, make targets, integration test entry points, and a first end-to-end certificate flow (offline init and online bootstrap paths).
- [SSH Certificates and Single Sign-On](ssh.md) - The step ssh command group: certificate signing (user/host, identity/mTLS, add-user), login/logout via ssh-agent, step ssh config (SSO team bootstrap, roots/federation, templates), hosts and check-host, list, and proxycommand (host-registry bastion lookup and exec of ssh), plus the internal/sshutil helpers.
- [Testing Strategy](testing-and-quality.md) - How the repository is tested: colocated unit tests, the testscript/txtar integration suite in integration/ where TestMain maps step to cmd.Run so tests exercise the real command tree, testdata and check-helper conventions, and the make test/race/lint targets plus CI.

# Directories

- [architecture](architecture/)
- [flows](flows/)
