---
type: "Reference"
title: "Build, packaging, and release"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-c24853a4005579209b2246f3
    resource: repo://autocomplete/README.md
  - id: openwiki-source-7f1ca00753e95588bc8efa39
    resource: repo://docker/Dockerfile
  - id: openwiki-source-e7d0a4f9fa0532023b5aac61
    resource: repo://make/version.sh
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-fe5b002eb6bab88c8a9f5a2c
    resource: repo://systemd/cert-renewer%40.service
  - id: openwiki-source-c2a1cbcd354ea6d2d5d35e69
    resource: repo://systemd/README.md
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# Build, packaging, and release

## Building locally

The Makefile drives local builds (`Makefile:1-235`):

- `make build` produces `bin/step` from `github.com/smallstep/cli/cmd/step`
  with `CGO_ENABLED=0` by default and `-ldflags` injecting `main.Version` and
  `main.BuildTime` (`Makefile:64-71`, `126-132`).
- `make goreleaser` builds via GoReleaser (Pro config) into `bin/step`
  (`Makefile:134-142`).
- Cross-compile helpers exist per platform: `binary-linux-amd64`,
  `binary-linux-arm64`, `binary-linux-armv7`, `binary-linux-mips`,
  `binary-darwin-*`, `binary-windows-amd64` (`Makefile:204-235`).
- `make test` / `make race` / `make lint` run the test and lint suite
  (`Makefile:151-175`); `make bootstrap` installs golangci-lint, govulncheck,
  gotestsum, goimports, and GoReleaser Pro (`Makefile:104-117`).

### Version selection

The version comes from `GITHUB_REF` when set (tag → `release`,
`*-rc*` → `release-candidate`); otherwise from `git describe --tags --always
--dirty`, falling back to `make/version.sh` reading `.VERSION` (used by `git
archive` exports) (`Makefile:40-56`, `make/version.sh`).

## GoReleaser release pipeline

`.goreleaser.yml` defines the release build (GoReleaser v2, Pro mode):

- **Builds**: `CGO_ENABLED=0`, `-trimpath`, `main ./cmd/step`, ldflags
  `-w -X main.Version={{.Version}} -X main.BuildTime={{.Date}}`, targeting
  darwin/linux/freebsd/windows across amd64/arm64/386/arm/mips/ppc64le. A
  second build (id `nfpm`) produces a `step-cli` binary for package formats
  (`.goreleaser.yml:23-58`).
- **Archives**: versioned tarballs (zip on Windows) wrapping in a versioned
  directory, including README, LICENSE, and `autocomplete/*`
  (`.goreleaser.yml:60-81`).
- **nFPM packages**: `.deb` and `.rpm` for the `nfpm` build with
  postinstall/postremove scripts and a `step` symlink (`ghost` file), signed
  with a GPG key when configured (`.goreleaser.yml:84-140`).
- **Signing**: every artifact is signed with cosign into a sigstore bundle
  (`.goreleaser.yml:151-159`); the release body documents how to verify with
  `cosign verify-blob` (`.goreleaser.yml:228-242`).
- **Publishing**: archives are uploaded to an S3 bucket (versioned names always,
  `step_latest_*` copies only for full releases), nFPM packages go to Google
  Cloud Artifact Registry via `scripts/package-upload.sh`, and winget/Scoop
  manifests are generated (`.goreleaser.yml:266-522`).
- The `after` hook runs `scripts/package-repo-import.sh` to import the package
  into the release repository (`.goreleaser.yml:17-21`).

## Release workflow

`.github/workflows/release.yml` triggers on `v*` tags: it runs CI, computes
release metadata (version, prerelease detection via `-rc`, Docker tags), then
runs the shared `smallstep/workflows` GoReleaser workflow, builds and uploads
Docker images from both `docker/Dockerfile` (Alpine) and
`docker/Dockerfile.debian` (Debian `trixie`), and — for full releases —
regenerates the step-cli reference docs in the `smallstep/docs` repository
(`.github/workflows/release.yml:3-179`).

## Docker image

`docker/Dockerfile` is a multi-stage build: it builds `bin/step` with the
Makefile inside a `golang:alpine` builder, then copies the binary into an
Alpine runtime image that runs as an unprivileged `step` user with
`STEPPATH=/home/step` (`docker/Dockerfile:1-43`).

## systemd renewal units

The `systemd/` directory ships renewal automation:

- `cert-renewer@.service` — a `Type=oneshot` unit that uses
  `step certificate needs-renewal` as `ExecCondition`, `step ca renew --force`
  as `ExecStart`, and `systemctl try-reload-or-restart` on the relying service
  as `ExecStartPost` (`systemd/cert-renewer@.service:8-27`).
- `cert-renewer@.timer` schedules it, `cert-renewer.target` groups units,
  and `ssh-cert-renewer.{service,timer}` handles SSH certificates.

Per the directory README, these files are redirect targets in the
files.smallstep.com S3 bucket, so their locations should not be moved without
updating those redirects (`systemd/README.md:1-6`).

## Shell completion

The `autocomplete/` directory contains bash/zsh completion scripts but is
deprecated; the supported path is `step completion <shell>`
(`autocomplete/README.md:1-3`, `command/completion/completion.go`). The CLI
also enables bash completion via the urfave/cli app
(`internal/cmd/root.go:124`).

## OS packaging scripts

- `scripts/postinstall.sh` / `scripts/postremove.sh` are wired into the nFPM
  packages.
- `powershell/install-step.ps1` and `powershell/uninstall-step.ps1` support
  Windows installation.
