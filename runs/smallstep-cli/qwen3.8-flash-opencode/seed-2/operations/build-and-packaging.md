---
type: operations
title: "Build, Packaging, and Release Pipeline"
description: "How step is compiled and shipped: Makefile version resolution and build flags, GoReleaser build/archive/nfpm configuration, cosign and GPG signing, package upload scripts, Docker images, and the GitHub Actions release/CI workflows."
tags: [build, packaging, release, docker, cosign, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-4f25e0e3217430b208dbf203
    resource: repo://.github/workflows/publish-packages.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-d476ea26a75650171f9bfd5e
    resource: repo://cosign.pub
  - id: openwiki-source-52d9d3d8b4e06f7e6148c2af
    resource: repo://debian/changelog
  - id: openwiki-source-7cf9a16349ca22f9507e7399
    resource: repo://debian/copyright
  - id: openwiki-source-7f1ca00753e95588bc8efa39
    resource: repo://docker/Dockerfile
  - id: openwiki-source-e7d0a4f9fa0532023b5aac61
    resource: repo://make/version.sh
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-c97b95916f57c23a25078386
    resource: repo://scripts/package-upload.sh
  - id: openwiki-source-ff2cc4bdd17ca696ef16f5d3
    resource: repo://scripts/postinstall.sh
  - id: openwiki-source-5e2a31f040a46bbc0b2a3527
    resource: repo://scripts/postremove.sh
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# Build, Packaging, and Release Pipeline

## Version resolution (Makefile)

`Makefile` computes `VERSION` at parse time with a fixed precedence (`Makefile:41-55`):

1. Under CI (`GITHUB_REF` set): strip `refs/tags/`; a tag containing `-rc` classifies `PUSHTYPE := release-candidate`, otherwise `release`.
2. In a git checkout: `git describe --tags --always --dirty=-dev`.
3. Otherwise (release tarball / archive without `.git`): `make/version.sh .VERSION`, which parses the `tag: v…` entry baked in by `git archive` and falls back to `v0.0.0` (`make/version.sh`).

The leading `v` is stripped. `LDFLAGS` then inject `-X "main.Version=$(VERSION)" -X "main.BuildTime=$(DATE)"` into the `cmd/step` variables (`Makefile:62-67`; see [System Architecture Overview](/openwiki/architecture/overview.md)), and a `DEBUG=1` build adds `-gcflags "all=-N -l"` and keeps symbols.

## Make targets and platform knobs

- `make` (aka `all`) runs `lint test build`; `make ci` runs `test build` (`Makefile:26-28`).
- Builds are **static by default**: `CGO_OVERRIDE?=CGO_ENABLED=0`, overridable; the target triple comes from `GOOS_OVERRIDE` (e.g. `GOOS_OVERRIDE="GOOS=linux GOARCH=arm GOARM=6"`) (`Makefile:16-22`, `Makefile:121-128`). The `SRC` set (all `*.go`, `go.mod`, `go.sum`) is the build dependency (`Makefile:24`).
- `binary-linux-amd64|linux-arm64|linux-armv7|linux-mips|darwin-amd64|darwin-arm64|windows-amd64` re-invoke the same rule per platform via the `BUNDLE_MAKE` macro into `output/binary/` — MIPS is a first-class static target (`Makefile:204-232`).
- `make goreleaser` produces a CI-parity single-target build (`--snapshot --single-target`), auto-skipping the GCP upload hooks depending on whether the installed goreleaser is the Pro binary (`Makefile:97-145`).
- `make test` runs `gotestsum -- -short -covermode=atomic`; `make race` adds `-race`; `make lint` runs `golangci-lint` **with the config fetched from the shared smallstep/workflows repo** and then `govulncheck`; `make fmt` uses `goimports` (`Makefile:147-176`). `make bootstrap` installs golangci-lint, govulncheck, gotestsum, goimports, and GoReleaser Pro (`Makefile:104-115`).
- `install` copies `bin/step` to `DESTDIR` (default `/usr/local/bin`) (`Makefile:178-187`).

## GoReleaser: the shipping artifact matrix

`.goreleaser.yml` is a GoReleaser **Pro** schema (`pro: true`) with a package version variable (`packageName: step-cli`) that must be kept in sync with the nfpm `release` by hand (`.goreleaser.yml:6-11`):

- **Two build definitions**: `default` (binary `bin/step`, `-trimpath`, CGO off, ldflags `-X main.Version={{.Version}} -X main.BuildTime={{.Date}}`) across 15 targets from darwin_arm64 to linux_mips64 and windows_arm64; and `nfpm`, identical but emitting the binary as `step-cli` so packages can own `/usr/bin/step` via alternatives (`.goreleaser.yml:23-58`).
- **Archives**: tarballs named with/without version (`default` and `unversioned` ids), zip on Windows, wrapping README/LICENSE/autocomplete (`.goreleaser.yml:60-83`).
- **nfpms**: `.deb` and `.rpm` for package `step-cli`, embedding `debian/copyright` (the `debian/` directory contains only this and a boilerplate changelog stub), ghost entries for `/usr/bin/step` and bash completion, GPG signing from `GPG_PRIVATE_KEY_FILE` for both formats, and lifecycle scripts (`postinstall`, `postremove`) (`.goreleaser.yml:84-144`).
- **Lifecycle scripts**: `scripts/postinstall.sh` runs `update-alternatives --install /usr/bin/step step /usr/bin/step-cli 50` and regenerates `/usr/share/bash-completion/completions/step` by executing `/usr/bin/step completion bash`; `postremove.sh` removes the alternative (`scripts/postinstall.sh:3-16`, `scripts/postremove.sh:3-8`).
- **Signing**: every artifact is cosign-signed — `signs` uses `cosign sign-blob --bundle=${artifact}.sigstore.json` (`cosign.pub` is the published verification key); `publishers` then runs `scripts/package-upload.sh` to copy debs/rpms to `gs://artifacts-outgoing/…`, skipping `armhf6` debs to dodge an Artifact Registry conflict, and an `after` hook (`scripts/package-repo-import.sh`) imports them into the package repos using the CI-provided `IS_PRERELEASE` (`.goreleaser.yml:146-170`, `scripts/package-upload.sh:16-24`).

## GitHub Actions

- **CI** (`ci.yml`) delegates entirely to the reusable `smallstep/workflows/goCI.yml` (lint, test, CodeQL, pinned golangci-lint version), triggered on master pushes (ignoring `v*` tags) and PRs, with concurrency cancel-in-progress (`.github/workflows/ci.yml:2-30`).
- **Release** (`release.yml`) runs on tags: CI → `release_metadata` (parses the tag into `VERSION`/`VVERSION`, sets `IS_PRERELEASE` from `-rc`, computes Docker tags and appends `latest` only for non-prereleases) → the shared `goreleaser.yml` workflow → two Docker publishes to `smallstep/step-cli` (`docker/Dockerfile` and `docker/Dockerfile.debian`) via `docker-buildx-push.yml` → a final job that rebuilds reference docs and pushes them to the docs repo with bot signing (`.github/workflows/release.yml:18-99`, `105-176`).
- **publish-packages.yml** manually re-publishes a chosen tag's packages to `packages.smallstep.com` after authenticating to Google Cloud (`.github/workflows/publish-packages.yml:1-19`).

## Container images

`docker/Dockerfile` is multi-stage: `golang:alpine` builder runs `make V=1 bin/step` with buildx `TARGETOS/TARGETARCH/TARGETVARIANT` mapped into `GOOS_OVERRIDE` (including `GOARM` variants), then copies the binary into a plain `alpine` with a dedicated `step` user (overridable `STEPUID/STEPGID`), `STEPPATH=/home/step`, `STOPSIGNAL SIGTERM`, and default `CMD /bin/bash` (`docker/Dockerfile:1-42`); `Dockerfile.debian` is the same idea on Debian.

## Where the seams are

To add a platform: extend `builds[].targets` in `.goreleaser.yml` (and optionally a `binary-*` Make shortcut). To change package contents: edit the nfpm `contents`/`scripts` — `debian/` is documentation/licensing filler, not `dpkg-buildpackage` machinery. Release notes derive from the GitHub release template embedded in `.goreleaser.yml`, which also references the published `checksums.txt`.

## See also

- [Quickstart](/openwiki/quickstart.md) — developer build loop
- [Testing Strategy](/openwiki/testing/test-strategy.md) — what CI actually executes
- [Renewal Automation and systemd Units](/openwiki/operations/renewal-and-systemd.md) — units shipped alongside packages
