---
type: operations-page
title: Build and Release Pipeline
description: From source to released binary - Makefile targets, GoReleaser Pro configuration, CI workflows, Docker images, package publishing, and version injection.
tags: [build, release, goreleaser, ci, docker, packaging, versioning]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-ca6cb4b1a14fd7969dfae3ec
    resource: repo://CHANGELOG.md
  - id: openwiki-source-7f1ca00753e95588bc8efa39
    resource: repo://docker/Dockerfile
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-ca1d561103107eaefbe35681
    resource: repo://powershell/README.md
  - id: openwiki-source-c97b95916f57c23a25078386
    resource: repo://scripts/package-upload.sh
  - id: openwiki-source-ff2cc4bdd17ca696ef16f5d3
    resource: repo://scripts/postinstall.sh
  - id: openwiki-source-5e2a31f040a46bbc0b2a3527
    resource: repo://scripts/postremove.sh
  - id: openwiki-source-c2a1cbcd354ea6d2d5d35e69
    resource: repo://systemd/README.md
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

This page traces how a commit becomes a released `step` binary, and where each
artifact is published. The repository builds with CGO disabled and injects the
version at link time; every other artifact is a derivative of that binary.

## Local build and version injection

`make build` compiles `github.com/smallstep/cli/cmd/step` into `bin/step` with
`CGO_ENABLED=0` by default and `-ldflags='-w -X "main.Version=$(VERSION)" -X
"main.BuildTime=$(DATE)"'` (Makefile:10-22, 64-71, 123-132). The version comes
from `git describe --tags --always --dirty="-dev"` (or the tag when `GITHUB_REF`
is set, with `-rc` tags classified as release candidates), falling back to the
`.VERSION` slug via `make/version.sh` for `git archive` tarballs
(Makefile:40-56, .gitattributes:1). `DEBUG=1` adds `-gcflags "all=-N -l"` and
keeps symbols (Makefile:65-71). Those ldflags write `main.Version`/`main.BuildTime`
in cmd/step/main.go:10-16, which `init()` registers via `step.Set` — the runtime
dispatch page covers the consumption side. `make goreleaser` builds a
CI-parity snapshot via GoReleaser (Makefile:134-142), with Pro/OSS-specific hook
skipping logic (Makefile:87-97).

Other developer targets: `make test` (gotestsum, `-short`, coverage),
`make race`, `make lint` (golangci-lint with the config fetched at runtime from
smallstep/workflows, plus govulncheck), `make bootstrap` to install the toolchain,
and cross-compile helpers `binary-linux-*`/`binary-darwin-*`/`binary-windows-*`
(Makefile:30-32, 105-115, 151-173, 204-235). `make install` places the binary
under `DESTDIR` (default `/usr/local/bin`, Makefile:181-188).

## CI

`ci.yml` triggers on pushes to master (ignoring `v*` tags) and PRs, and delegates
to the reusable `smallstep/workflows/.github/workflows/goCI.yml` with CodeQL
enabled and golangci-lint pinned to v2.12.1; it is also `workflow_call`-able so
the release pipeline re-runs it as a gate (.github/workflows/ci.yml:3-30). The
release workflow's first job is exactly that call (release.yml:13-19). Supporting
workflows: actionci (lints the Actions themselves), code-scan-cron (daily),
dependabot auto-merge, triage, and publish-packages (manual re-publish of .deb/
.rpm from an existing release, release.yml-adjacent .github/workflows/).

## GoReleaser: builds and archives

Tag pushes (`v*`) trigger release.yml (release.yml:3-7). The `release_metadata`
job classifies `-rc` tags as prereleases and computes the version and Docker tags
(release.yml:21-60). The `goreleaser` job then runs `.goreleaser.yml` (a **Pro**
config, .goreleaser.yml:3-7) via the shared workflow with package upload enabled
and `id-token: write` for cosign/GCP (release.yml:62-72).

- `go mod download` runs as a before-hook; an after-hook imports packages into
  GCP Artifact Registry via `scripts/package-repo-import.sh`, which skips when
  `IS_PRERELEASE=true` (.goreleaser.yml:13-21).
- Two builds share one YAML anchor: `default` produces `bin/step` for 14 targets
  (darwin amd64/arm64, freebsd amd64, linux 386/amd64/arm64/arm5/6/7/mips/mips64/
  ppc64le, windows amd64/arm64) with `CGO_ENABLED=0`, `-trimpath`, and the same
  ldflags as the Makefile; `nfpm` is identical but names the binary `step-cli`
  for .deb/.rpm packaging (.goreleaser.yml:23-58).
- Archives: versioned and unversioned tarballs (zip on Windows), wrapped in a
  directory, bundling README, LICENSE, and `autocomplete/*`
  (.goreleaser.yml:60-81).

## GoReleaser: packages, signing, publishing

- **nfpms**: `.deb`/`.rpm` named `step-cli`, installed to `/usr/bin`, including
  `debian/copyright`, ghost files for `/usr/bin/step` and the bash-completion
  path, and GPG-signed (rpm signature key, deb origin signature)
  (.goreleaser.yml:84-140). `scripts/postinstall.sh` wires
  `update-alternatives` (`/usr/bin/step` → `step-cli`) and generates bash
  completion via `step completion bash` (scripts/postinstall.sh:1-19);
  `postremove.sh` undoes the alternative.
- **cosign**: every artifact gets a sigstore bundle via
  `cosign sign-blob --bundle=${artifact}.sigstore.json` (.goreleaser.yml:151-159).
- **S3 blobs**: raw binaries are uploaded as
  `step_<version>_<os>_<arch>` to `AWS_S3_BUCKET`, plus unversioned
  `step_latest_*` copies only on full (non-RC) releases (.goreleaser.yml:266-309).
  The Windows installer and unit-file redirects served from this bucket are the
  powershell/ and systemd/ directories' published forms (powershell/README.md,
  systemd/README.md).
- **Publishers**: `scripts/package-upload.sh` copies .deb/.rpm to GCS
  (`gs://artifacts-outgoing/...`), skipping armhf6 debs due to a GCP Artifact
  Registry conflict (scripts/package-upload.sh:20-31); the after-hook then
  imports them into Artifact Registry for apt/yum consumption
  (.goreleaser.yml:17-21).
- **winget**: a manifest is pushed to `smallstep/winget-pkgs` on branch
  `step-<version>` and a PR is opened against microsoft/winget-pkgs, with the
  release-download URL template (.goreleaser.yml:311+).
- **scoops**: a manifest is pushed to the `smallstep/scoop-bucket`
  (.goreleaser.yml:447-486).
- **Release**: published on GitHub as `Step CLI <tag> (<date>)`, with
  `prerelease: auto`; checksums include staged `./.releases/*` extra files
  (.goreleaser.yml:146-149, 170+). The Docker section of .goreleaser.yml is
  commented out — images are built by CI instead.

## Docker images

Two buildx jobs publish `smallstep/step-cli` for linux/amd64, 386, arm, arm64:
`docker/Dockerfile` (alpine) tagged `:<version>` plus `:latest` on full releases,
and `docker/Dockerfile.debian` (trixie) tagged `:<version>-trixie` plus
`:trixie` (release.yml:74-100). The alpine image is a multi-stage build running
`make V=1 bin/step` with cache mounts, then ships a non-root `step` user with
`STEPPATH=/home/step` and `CMD /bin/bash` (docker/Dockerfile:1-37).

## Documentation regeneration

For full releases only, `update_reference_docs` builds the binary, checks out
`smallstep/docs`, regenerates the command reference with
`bin/step help --markdown ./step-cli/reference`, rebuilds the route manifest, and
pushes an SSH-signed commit to the docs repository's main branch
(release.yml:102-179). This is why help-text quality is release-blocking: the CLI
itself is the documentation generator (see the command anatomy page).

## Cadence and versioning reality

The changelog follows Keep a Changelog with a mandatory TEMPLATE section;
documented releases in CHANGELOG.md run through 0.30.3 (2026-06-09), and the
release notes live on the smallstep blog (CHANGELOG.md:1-31). The repository does
not encode a release schedule; tags drive everything.
