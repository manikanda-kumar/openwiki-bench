# Files

- [Build, Packaging, and Release Pipeline](build-and-packaging.md) - How step is compiled and shipped: Makefile version resolution and build flags, GoReleaser build/archive/nfpm configuration, cosign and GPG signing, package upload scripts, Docker images, and the GitHub Actions release/CI workflows.
- [Renewal Automation and systemd Units](renewal-and-systemd.md) - How step ca renew works as a one-shot and daemon with jittered scheduling, mTLS vs token auth, post-renewal signals and exec hooks, the needs-renewal 66% gate, and the shipped systemd timer/service units for certificate and SSH host renewal.
