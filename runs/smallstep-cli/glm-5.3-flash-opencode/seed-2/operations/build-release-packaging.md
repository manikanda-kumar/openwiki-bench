---
type: operations
title: Build, Release, and Packaging
description: How step is built and shipped — Makefile targets, the GoReleaser Pro release pipeline (archives, nfpm packages, S3 blobs, cosign signing, brew/scoop/winget manifests), Docker images, and the tag-driven release workflow.
tags: [build, release, goreleaser, packaging, docker]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-4f25e0e3217430b208dbf203
    resource: repo://.github/workflows/publish-packages.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-7f1ca00753e95588bc8efa39
    resource: repo://docker/Dockerfile
  - id: openwiki-source-ebfb7d0449b28d06d03ce419
    resource: repo://docker/Dockerfile.debian
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-ca1d561103107eaefbe35681
    resource: repo://powershell/README.md
  - id: openwiki-source-ff2cc4bdd17ca696ef16f5d3
    resource: repo://scripts/postinstall.sh
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# Build, Release, and Packaging

## Local builds (Makefile)

`make build` compiles `github.com/smallstep/cli/cmd/step` into `bin/step`
with `CGO_ENABLED=0` and `-ldflags '-w -X main.Version=... -X
main.BuildTime=...'` (version defaults to `git describe`, falling back to
`.VERSION` via `make/version.sh` outside a git dir). `DEBUG=1` adds
`-gcflags "all=-N -l"` for debugging. Cross-compilation targets
(`binary-linux-amd64`, `binary-darwin-arm64`, ...) wrap the same build with
`GOOS/GOARCH` overrides into `output/binary/`. `make install` copies to
`DESTDIR` (default `/usr/local/bin`), and `make goreleaser` produces a
local binary in parity with CI using GoReleaser (`GORELEASER_BUILD_ID`
selects the build id; skip logic differs between OSS and Pro binaries).

## GoReleaser configuration (`.goreleaser.yml`)

The config is `version: 2`, `pro: true` — some pipes are GoReleaser Pro
features (the config states this explicitly), so OSS users may not get full
parity. It produces:

- **Builds**: `main: ./cmd/step`, `CGO_ENABLED=0`, `-trimpath`, version
  ldflags, targeting darwin (amd64/arm64), freebsd, linux (386/amd64/arm64/
  armv5-7/mips/mips64/ppc64le), and windows (amd64/arm64), binary
  `bin/step`; a second `nfpm` build inherits the Linux targets with the
  binary named `step-cli` for packaging.
- **Archives**: `step_<os>_<version>_<arch>.tar.gz` (`.zip` on Windows),
  wrapping in a versioned directory and including `README.md`, `LICENSE`,
  and `autocomplete/*`; an `unversioned` variant skips the version.
- **nfpm packages**: `step-cli` `.deb` and `.rpm` (vendor Smallstep, Apache
  2.0), installing `debian/copyright` to
  `/usr/share/doc/step-cli/copyright`, with ghost entries for
  `/usr/bin/step` and the bash completion file, and postinstall/postremove
  scripts (`scripts/postinstall.sh` registers the `step` alternative and
  regenerates the bash completion via `step completion bash`).
- **Signing and checksums**: all artifacts signed with cosign
  (`sign-blob --bundle=<artifact>.sigstore.json`), `checksums.txt` plus
  `./.releases/*` extras.
- **Uploads**: GitHub release (`smallstep/cli`, prerelease auto-detected,
  templated header with download links and cosign verification
  instructions), S3 blobs (`blobs` pipe with versioned and `latest` binary
  copies — `latest` uploads disabled for prereleases), Google Cloud
  Artifact Registry via `scripts/package-upload.sh`, scoop manifests to the
  `smallstep/scoop-bucket` repo, winget, and Homebrew taps. The `dockers`
  pipe is commented out — Docker images are built by the workflow instead.
- **Hooks**: `before: go mod download`; `after` runs
  `scripts/package-repo-import.sh` (depends on `IS_PRERELEASE` set by CI).

## Release workflow (`.github/workflows/release.yml`)

Triggered by `v*` tags:

1. **ci** — reuses the repo's CI workflow first.
2. **release_metadata** — extracts `VVERSION`/`VERSION`, detects
   prereleases (`-rc` in the tag), and computes Docker tags
   `smallstep/step-cli:<version>` (+ `latest` and `trixie` variants for full
   releases).
3. **goreleaser** — delegates to the shared
   `smallstep/workflows/goreleaser.yml` with package upload enabled.
4. **Docker** — two buildx pushes: `docker/Dockerfile` (Alpine-based,
   non-root `step` user, `STEPPATH=/home/step`) and `docker/Dockerfile.debian`
   (Debian trixie-based), for `linux/amd64,386,arm,arm64`.
5. **Reference docs** (full releases only) — builds the binary and runs
   `step help --markdown` to regenerate the CLI reference in the
   `smallstep/docs` repository, updating the docs site manifest.

A separate manual workflow (`publish-packages.yml`) re-publishes `.deb`/`.rpm`
artifacts from an existing GitHub release to packages.smallstep.com without a
full release.

## Platform packaging assets

- `debian/`: changelog and copyright consumed by nfpm.
- `systemd/`: `cert-renewer@.service`/`.timer`, `ssh-cert-renewer.service`/
  `.timer`, and `cert-renewer.target` for production renewal deployments
  (see [Certificate Renewal](/openwiki/flows/certificate-renewal.md)).
- `autocomplete/`: standalone bash/zsh completion scripts shipped in
  archives (the runtime `step completion` command is the other source).
- `powershell/`: Windows install/uninstall scripts served via S3 redirects
  (`install-step.ps1` downloads `step.exe`, adds it to the machine `PATH`,
  and enables the Windows ssh-agent service).

## Notes and uncertainties

The Makefile comments and `GORELEASER_SKIP` logic document that Pro builds
run extra post-hooks/after steps (GCP upload); with OSS binaries the `after`
skip is not passed because of an upstream GoReleaser quirk. The `.deb`/`.rpm`
signing keys are provided via `GPG_PRIVATE_KEY_FILE` at release time and are
not present in the repository. Homebrew/winget manifest details live in the
shared Smallstep release workflow, not in this repository.
