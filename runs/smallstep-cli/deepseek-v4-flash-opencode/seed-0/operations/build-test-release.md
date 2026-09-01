---
type: "Reference"
title: "Build, Test, and Release"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-c24853a4005579209b2246f3
    resource: repo://autocomplete/README.md
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-57260b234ea7f7b2e5fd2415
    resource: repo://command/completion/completion.go
  - id: openwiki-source-7f1ca00753e95588bc8efa39
    resource: repo://docker/Dockerfile
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-d97ab22481025bef366de55e
    resource: repo://powershell/install-step.ps1
  - id: openwiki-source-fe5b002eb6bab88c8a9f5a2c
    resource: repo://systemd/cert-renewer%40.service
  - id: openwiki-source-c2a1cbcd354ea6d2d5d35e69
    resource: repo://systemd/README.md
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---


# Build, Test, and Release

This page covers building, testing, and releasing the `step` binary.

## Building

The `Makefile` drives local development:

- `make build` builds `bin/step` with `CGO_ENABLED=0` by default
  (`CGO_OVERRIDE`), passing `-ldflags` that set `main.Version` and
  `main.BuildTime` (from the git tag / `git describe` or the `.VERSION` file
  via `make/version.sh`).
- `make goreleaser` builds with GoReleaser (snapshot, single target, skipping
  post-hooks/after per the GoReleaser Pro vs OSS detection).
- `make bootstrap` installs `golangci-lint`, `govulncheck`, `gotestsum`,
  `goimports`, and GoReleaser Pro.
- Cross-compilation helpers (`binary-linux-*`, `binary-darwin-*`,
  `binary-windows-*`) build static binaries for each platform into `output/`.

The `docker/Dockerfile` builds a multi-stage image with a static `step` binary
running as a non-root `step` user (`STEPPATH=/home/step`).

## Testing and linting

- `make test` runs the full unit test suite via `gotestsum` with a coverage
  profile; `make race` runs tests with `-race`.
- `make lint` runs `golangci-lint` with the shared smallstep config
  (`smallstep/workflows` `.golangci.yml`) plus `govulncheck`.
- `integration/` contains integration tests (e.g. `certificate_test.go`,
  `crypto_test.go`, `help_test.go`) and shell-based helpers (`openssl-jwt.sh`).
- CI reuses the reusable workflow `smallstep/workflows/.github/workflows/goCI.yml`
  (`.github/workflows/ci.yml`), with CodeQL and a pinned golangci-lint version.

## Versioning

- `cmd/step/main.go` declares `Version = "N/A"` and `BuildTime = "N/A"`; both
  are replaced at build time via `-ldflags` (`main.Version`, `main.BuildTime`).
- The Makefile computes `VERSION` from `git describe --tags` (or the `.VERSION`
  slug via `make/version.sh`) and `DATE` from the current UTC time.

## Releasing with GoReleaser

`.goreleaser.yml` (GoReleaser Pro config) orchestrates releases:

- **Builds**: the `default` build targets darwin/linux/freebsd/windows across
  many architectures (amd64, arm64, armv5-7, mips, ppc64le, etc.), with
  `CGO_ENABLED=0`, `-trimpath`, and version/build-time ldflags. A second
  `nfpm` build produces the `step-cli` binary for `.deb`/`.rpm` packaging.
- **Archives**: tarballs (zip on Windows) containing the binary, `README.md`,
  `LICENSE`, and `autocomplete/*`. An `unversioned` archive variant is also
  produced.
- **nfpm packages**: `.deb` and `.rpm` packages (`step-cli`) with postinstall/
  postremove scripts, `/usr/share/doc` copyright, and `ghost` files for
  `/usr/bin/step` and the bash completion.
- **Signing**: all artifacts are signed with `cosign` (sigstore) producing
  `.sigstore.json` bundles; a `checksums.txt` is emitted.
- **Distribution**: binaries are uploaded to an S3 bucket (versioned and
  `latest` copies), packages are published to Google Cloud Artifact Registry,
  and winget and Scoop manifests are updated automatically.
- **Release notes**: the GitHub release is drafted with a template listing
  official artifacts and cosign verification instructions.

## Completions and packaging assets

- `step completion <shell>` generates shell completions (bash/zsh/fish); the
  `autocomplete/` folder is deprecated in favor of it.
- `powershell/install-step.ps1` (and `uninstall-step.ps1`) install the Windows
  binary from the `latest` S3 object and enable the `ssh-agent` service.
- `systemd/` ships unit/timer files for certificate renewal
  (`cert-renewer@.service`/`.timer` using `step certificate needs-renewal` +
  `step ca renew --force`, and `ssh-cert-renewer.*`), plus a `cert-renewer.target`.
- `debian/` provides packaging metadata (`changelog`, `copyright`); `scripts/`
  holds package hooks and release helpers; `make/version.sh` reads the
  `.VERSION` slug produced by `git archive`.

## Relationship to other pages

- The entrypoint and ldflags wiring are described in
  [Command Framework, Plugins, and Error Handling](../architecture/command-and-error-handling.md).
- Building from source is covered in the
  [Quickstart](../quickstart.md).
