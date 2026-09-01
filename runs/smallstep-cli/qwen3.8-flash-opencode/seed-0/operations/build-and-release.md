---
type: operations
title: Build, Packaging, and Release Operations
description: How step is built (Makefile and version injection), packaged (goreleaser tarballs, deb/rpm, Docker images), signed (cosign), and published through GitHub Actions workflows.
tags: [operations, build, release, packaging, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-3c099d9af7cba6b30d6eaf07
    resource: repo://.gitattributes
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-4f25e0e3217430b208dbf203
    resource: repo://.github/workflows/publish-packages.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-1b3b612bc0aec13f4edefe60
    resource: repo://.VERSION
  - id: openwiki-source-c24853a4005579209b2246f3
    resource: repo://autocomplete/README.md
  - id: openwiki-source-7f1ca00753e95588bc8efa39
    resource: repo://docker/Dockerfile
  - id: openwiki-source-e7d0a4f9fa0532023b5aac61
    resource: repo://make/version.sh
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-ca1d561103107eaefbe35681
    resource: repo://powershell/README.md
  - id: openwiki-source-ff2cc4bdd17ca696ef16f5d3
    resource: repo://scripts/postinstall.sh
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---

# Build, Packaging, and Release Operations

## Build system (Makefile)

The `Makefile` provides the canonical local and CI build entrypoints:

- `make build` → `bin/step` (override with `BINNAME`/`PREFIX`), compiling
  `github.com/smallstep/cli/cmd/step` with `CGO_ENABLED=0` by default
  (`CGO_OVERRIDE` to change), `-trimpath`-style static builds, and
  `-ldflags '-w -X "main.Version=$(VERSION)" -X "main.BuildTime=$(DATE)"'`;
  `make build DEBUG=1` keeps symbols and disables inlining
  (`-gcflags "all=-N -l"`) (Makefile:64-71, Makefile:123-132).
- **Version detection:** if `GITHUB_REF` is set the version is the tag with
  the leading `v` stripped and `PUSHTYPE` is `release` or `release-candidate`
  (rc tags); otherwise `git describe --tags` is tried and, outside a git
  checkout, `make/version.sh .VERSION` parses the `git archive` refnames
  placeholder baked into `.VERSION` (`.gitattributes` marks it `export-subst`),
  falling back to `v0.0.0` (Makefile:40-56, make/version.sh:1-7).
- `make test` runs `gotestsum -- -coverprofile=coverage.out -short
  -covermode=atomic ./...`; `make race` adds `-race`
  (Makefile:151-155). See [Testing and Validation](/openwiki/testing-and-validation.md).
- `make lint` = `golint` + `govulncheck`, where golint pipes the **shared**
  golangci-lint config from `smallstep/workflows` (Makefile:166-175).
- `make bootstrap` installs golangci-lint, govulncheck, gotestsum, goimports,
  and downloads GoReleaser **Pro** into GOPATH/bin (Makefile:104-117).
- `make binary-linux-amd64` (and `-arm64/-armv7/-mips`, darwin, windows
  variants) cross-build static binaries into `output/binary/<platform>` via
  `GOOS_OVERRIDE`/`PREFIX` recursion (Makefile:204-233).
- `make goreleaser` builds a snapshot the same way CI does; the Makefile
  detects GoReleaser Pro vs OSS and sets `--skip=post-hooks` (OSS) or
  `--skip=post-hooks,after` (Pro) so package upload hooks don't fire locally
  (Makefile:89-97, Makefile:134-142).

## GoReleaser pipeline (`.goreleaser.yml`)

The config is **GoReleaser Pro schema** (`pro: true`,
`.goreleaser.yml:5-12`) with variable `packageName: step-cli` and
`packageRelease: 1` (nfpm `release:` must be manually kept in sync).

- **Builds:** id `default` compiles `./cmd/step` with `CGO_ENABLED=0`,
  `-trimpath`, ldflags injecting `main.Version`/`main.BuildTime`, for 14
  targets (darwin amd64/arm64, freebsd, linux 386/amd64/arm64/arm5/6/7/
  mips/mips64/ppc64le, windows amd64/arm64), binary path `bin/step`. A second
  id `nfpm` YAML-anchor-inherits the same config but names the binary
  `step-cli` for packaging (`.goreleaser.yml:23-58`).
- **Archives:** `default` (versioned names, wraps in a directory, bundles
  README/LICENSE/`autocomplete/*`, zip on Windows) plus an `unversioned`
  archive id whose stable names back the `dl.smallstep.com` redirect URLs
  (`.goreleaser.yml:60-82`).
- **Packages (nfpms):** `step-cli` `.deb` and `.rpm` installing to
  `/usr/bin`, GPG-signed when `GPG_PRIVATE_KEY_FILE` is set, with ghost
  entries for `/usr/bin/step` and the bash completion file, and
  `scripts/postinstall.sh` / `postremove.sh` hooks
  (`.goreleaser.yml:84-138`). The postinstall hook registers
  `update-alternatives` (`/usr/bin/step → /usr/bin/step-cli`, priority 50) and
  regenerates the system bash completion with `step completion bash`;
  postremove unregisters the alternative (scripts/postinstall.sh:1-14,
  scripts/postremove.sh).
- **Signing:** `signs` runs `cosign sign-blob --bundle
  ${artifact}.sigstore.json --yes` over **all artifacts**; the public key for
  verification ships as `cosign.pub`, and the release instructions verify with
  `cosign verify-blob` against the GitHub Actions OIDC identity
  (`.goreleaser.yml:151-159`, `.goreleaser.yml:228-240`).
- **Checkpoints:** `checksum: checksums.txt` including `./.releases/*` extras;
  `before.hook: go mod download`; `after.hook` runs
  `scripts/package-repo-import.sh` (depends on `IS_PRERELEASE` exported by
  CI) (`.goreleaser.yml:14-21,142-149`).
- **Publisher:** packages id `packages` are pushed to Google Artifact
  Registry through `scripts/package-upload.sh` (`.goreleaser.yml:161-166`).
- **GitHub release body:** generated header lists the stable
  `dl.smallstep.com` artifact URLs and deb/rpm links; `prerelease: auto`
  marks `-rc` tags pre-release (`.goreleaser.yml:170-241`). Docker publishing
  is commented out in goreleaser itself — images are built by CI instead.

## CI and release workflows (`.github/workflows/`)

All workflows delegate to the reusable `smallstep/workflows` repository:

- `ci.yml`: on master pushes (tags ignored) and PRs — calls
  `smallstep/workflows/.github/workflows/goCI.yml@main` with CodeQL enabled
  and a pinned golangci-lint version; also `workflow_call`-able with a
  CODECOV token (`.github/workflows/ci.yml:20-29`).
- `actionci.yml`: runs the shared `actionci.yml` job to validate workflow
  files (`.github/workflows/actionci.yml:11-18`).
- `code-scan-cron.yml`: nightly `code-scan.yml@main` (cron `0 0 * * *`).
- `release.yml`: triggered on `v*` tag pushes. Sequence: run `ci.yml` first;
  `release_metadata` computes `VERSION`/`VVERSION` from the tag, detects
  `-rc` tags as prerelease, and builds Docker tags for
  `smallstep/step-cli:<version>` (+`:latest` only for non-RCs) and a Debian
  variant `:<version>-trixie`; `goreleaser` job calls the shared
  `goreleaser.yml@main` with `enable-packages-upload: true`; two
  `docker-buildx-push.yml` jobs build `linux/amd64,386,arm,arm64` from
  `docker/Dockerfile` and `docker/Dockerfile.debian`; non-RC runs add
  reference-doc publishing jobs (`.github/workflows/release.yml:3-120`).
- `publish-packages.yml`: manual `workflow_dispatch` with a `tag` input that
  downloads deb/rpm assets from an existing GitHub release, uploads them to
  GCS via `scripts/package-upload.sh`, and imports them into Artifact
  Registry via `scripts/package-repo-import.sh` — republishing without a full
  release (`.github/workflows/publish-packages.yml:3-16,60-77`).

## Container images

`docker/Dockerfile` is a two-stage build: `golang:alpine` builder running
`make bin/step` with buildx `TARGETOS/TARGETARCH/TARGETVARIANT` (maps
`TARGETVARIANT` to `GOARM`), then a plain `alpine` runtime creating a
non-root `step` user (uid/gid build args, default 1000) with
`STEPPATH=/home/step`, `STOPSIGNAL SIGTERM`, and `CMD /bin/bash`
(docker/Dockerfile). `Dockerfile.debian` mirrors this on
`golang:trixie`/`debian:trixie` (docker/Dockerfile.debian:1-27).

## Windows installation

`powershell/install-step.ps1` and `uninstall-step.ps1` are referenced from
the `files.smallstep.com` S3 bucket as redirects to raw GitHub content;
moving the files requires updating those redirects
(powershell/README.md:1-2).

## Autocomplete artifacts

`autocomplete/README.md` marks the checked-in `bash_autocomplete` /
`zsh_autocomplete` scripts **deprecated** — `step completion <shell>` is the
supported path (autocomplete/README.md:1-2). The scripts still ship inside
release archives (`.goreleaser.yml:60-71`).

## Operational consequences when changing things

- Bumping `packageRelease` in `variables` requires editing the nfpms
  `release:` field too (`.goreleaser.yml:11`).
- Renaming or moving package/install-script paths breaks external redirect
  targets (powershell README, systemd README, `.goreleaser.yml` dl.smallstep
  URLs).
- The version baked into `step version` comes exclusively from build-time
  LDFLAGs; a plain `go build` leaves it as `N/A`.

## See also

- [Testing and Validation](/openwiki/testing-and-validation.md)
- [Quickstart](/openwiki/quickstart.md)
- [SSH Certificate Workflows](/openwiki/workflows/ssh-certificates.md)
