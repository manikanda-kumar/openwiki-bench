---
type: build-and-release-pipeline
title: Build and Release
description: How the step binary is built, versioned, packaged (archives, deb/rpm, Docker, Windows installer), signed, and published.
tags: [build, release, goreleaser, docker, packaging, distribution]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-c24853a4005579209b2246f3
    resource: repo://autocomplete/README.md
  - id: openwiki-source-7f1ca00753e95588bc8efa39
    resource: repo://docker/Dockerfile
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-d97ab22481025bef366de55e
    resource: repo://powershell/install-step.ps1
  - id: openwiki-source-b7a271f7c4e20c72483e6c6e
    resource: repo://scripts/package-repo-import.sh
  - id: openwiki-source-c97b95916f57c23a25078386
    resource: repo://scripts/package-upload.sh
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# Build and Release

## Local build

`make build` compiles `github.com/smallstep/cli/cmd/step` into `bin/step` with
`CGO_ENABLED=0` by default (overridable via `CGO_OVERRIDE`), injecting
`main.Version` (from `git describe --tags`, or `.VERSION` for archive exports)
and `main.BuildTime` via LDFLAGS; `DEBUG=1` adds debug gcflags. Cross-builds
use `GOOS_OVERRIDE` through the `binary-*` targets (linux amd64/arm64/armv7/mips,
darwin amd64/arm64, windows amd64) (repo://Makefile#L40-L71,
repo://Makefile#L123-L143, repo://Makefile#L214-L234). `make install` copies the
binary to `/usr/local/bin` (repo://Makefile#L181-L188).

## GoReleaser pipeline

`.goreleaser.yml` (GoReleaser **Pro** config, `pro: true`) drives releases (repo://.goreleaser.yml):

- `before` hook runs `go mod download`; the main build sets `CGO_ENABLED=0`,
  `-trimpath`, and `-w -X main.Version={{.Version}} -X main.BuildTime={{.Date}}`.
- Build targets: darwin amd64/arm64, freebsd amd64, linux 386/amd64/arm64/arm5/6/7/mips/mips64/ppc64le,
  windows amd64/arm64, output as `bin/step`. A second build (`id: nfpm`,
  binary named `step-cli`) exists specifically for the .deb/.rpm packages.
- Archives include `README.md`, `LICENSE`, and `autocomplete/*`; Windows
  archives are zip.
- nFPM produces `.deb` and `.rpm` packages (`package_name: step-cli`,
  vendor Smallstep Labs, bindir `/usr/bin`) with `debian/copyright`, ghost
  entries for `/usr/bin/step` and bash completions, and postinstall/postremove
  scripts (`scripts/postinstall.sh`, `scripts/postremove.sh`). RPM and deb
  signatures use `GPG_PRIVATE_KEY_FILE`.
- Checksums (`checksums.txt`, plus `./.releases/*` extras) and **cosign
  keyless signing** (`sign-blob --bundle=${artifact}.sigstore.json`) cover all
  artifacts.
- A publisher uploads packages to Google Cloud Artifact Registry via
  `scripts/package-upload.sh`, which copies `.deb`/`.rpm` files into
  `gs://artifacts-outgoing/<package>/{deb,rpm}/<version>/` (skipping armhf6
  debs due to a GCP Artifact Registry conflict)
  (repo://scripts/package-upload.sh).
- `make goreleaser` runs a local snapshot build; the Makefile detects
  Pro vs OSS goreleaser to choose which hooks to skip
  (repo://Makefile#L87-L97, repo://Makefile#L134-L143).

## Docker images

`docker/Dockerfile` is a multi-stage build: the builder stage downloads
modules, then runs `make V=1 bin/step` with `CGO_ENABLED=0` and
`TARGETOS/TARGETARCH` overrides; the runtime stage is Alpine with a
non-root `step` user (`STEPPATH=/home/step`) and bash/curl/tzdata/jq installed
(repo://docker/Dockerfile). A Debian variant exists at
`docker/Dockerfile.debian`.

## Windows installer

`powershell/install-step.ps1` creates `C:\Program Files\Smallstep Labs`,
downloads `step.exe` and the uninstall script from `dl.smallstep.com`, adds the
directory to the Machine `Path`, and enables the Windows `ssh-agent` service
(repo://powershell/install-step.ps1).

## Shell autocomplete

The static completion scripts in `autocomplete/` (bash, zsh) are **deprecated**;
the supported path is the `step completion <shell>` command generated from the
binary (repo://autocomplete/README.md). Archives still ship the `autocomplete/*`
files (repo://.goreleaser.yml archives section).

## Debian package metadata

`debian/changelog` tracks the Debian packaging history used by the nFPM deb
build; `debian/copyright` ships into `/usr/share/doc/step-cli/copyright`
(repo://debian/changelog, repo://.goreleaser.yml nfpms contents).

## Release CI

Release publication is wired through GitHub Actions (see
`.github/workflows/release.yml` and `publish-packages.yml`); the goreleaser
`release` section publishes to the `smallstep/cli` GitHub repository
(repo://.goreleaser.yml release section). Package repository import scripts
(`scripts/package-repo-import.sh`) run as goreleaser `after` hooks and depend
on the `IS_PRERELEASE` environment set by CI (repo://.goreleaser.yml after hooks,
repo://scripts/package-repo-import.sh).

## Uncertainty

The repository shows the *upload* destination (`gs://artifacts-outgoing`) but
not the downstream package-repository serving infrastructure; that lives
outside this repo.
