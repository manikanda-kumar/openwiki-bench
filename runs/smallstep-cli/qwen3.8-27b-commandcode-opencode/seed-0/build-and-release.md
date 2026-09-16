---
type: operations
title: "Build, Release, and Packaging"
description: "How step is built and shipped: Makefile build/version/ldflags logic, the GoReleaser release configuration (archives, nFPM packages, cosign signing, S3 blobs, winget/scoop), platform packaging assets (debian, docker, systemd, powershell, scripts), and the GitHub Actions workflows."
tags: [build, release, goreleaser, packaging, ci, cosign, systemd, docker]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-dc25ce111ca97420888172ad
    resource: repo://.github/workflows/code-scan-cron.yml
  - id: openwiki-source-4f25e0e3217430b208dbf203
    resource: repo://.github/workflows/publish-packages.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-b9c955598bb697de900ff315
    resource: repo://.goreleaser.yml
  - id: openwiki-source-1b3b612bc0aec13f4edefe60
    resource: repo://.VERSION
  - id: openwiki-source-d476ea26a75650171f9bfd5e
    resource: repo://cosign.pub
  - id: openwiki-source-7f1ca00753e95588bc8efa39
    resource: repo://docker/Dockerfile
  - id: openwiki-source-e7d0a4f9fa0532023b5aac61
    resource: repo://make/version.sh
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-d97ab22481025bef366de55e
    resource: repo://powershell/install-step.ps1
  - id: openwiki-source-c97b95916f57c23a25078386
    resource: repo://scripts/package-upload.sh
  - id: openwiki-source-fe5b002eb6bab88c8a9f5a2c
    resource: repo://systemd/cert-renewer%40.service
  - id: openwiki-source-5b8432eb4ee5e7ab8f9f9b3a
    resource: repo://systemd/cert-renewer%40.timer
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

## Local builds (Makefile)

- **Bootstrap**: `make bootstrap` installs golangci-lint, govulncheck, gotestsum, goimports, and GoReleaser **Pro** into `$GOPATH/bin` (`Makefile:104-117`). The toolchain assumes GoReleaser Pro can read the Pro config.
- **Build**: `make build` produces `bin/step` via `CGO_ENABLED=0 go build` of `github.com/smallstep/cli/cmd/step`, with `-trimpath`-style hygiene from ldflags: `-w -X "main.Version=$(VERSION)" -X "main.BuildTime=$(DATE)"`; `DEBUG=1` instead uses `-gcflags "all=-N -l"` (`Makefile:122-132`).
- **Version derivation** (`Makefile:40-56`, `make/version.sh`): if `GITHUB_REF` is set, `VERSION` comes from the tag ref and `PUSHTYPE` is `release` (or `release-candidate` for `-rc` tags); otherwise from `git describe --tags --always --dirty=-dev`, falling back to the `.VERSION` file (a `git archive` slug like `$Format:%d$`, parsed by `make/version.sh` with a `v0.0.0` fallback). The leading `v` is stripped for ldflags.
- **Other targets**: `test` (gotestsum, `-short`, coverage profile), `race`, `lint` (golangci-lint with the shared smallstep/workflows config + govulncheck), `fmt` (goimports with `-local` grouping), `install`/`uninstall` to `DESTDIR` (default `/usr/local/bin`), `goreleaser` (local `goreleaser build --snapshot --single-target` with Pro/OSS-specific skip lists, `Makefile:95-142`), `clean`, and a cross-build matrix `binary-linux-amd64|arm64|armv7|mips`, `binary-darwin-amd64|arm64`, `binary-windows-amd64` into `output/binary/` (`Makefile:214-235`).

## Release pipeline (`.github/workflows/release.yml`)

Triggered on `v*` tags:

1. **ci** — runs the shared CI workflow (see below) first.
2. **release_metadata** — detects prereleases by matching `-rc` in the ref, extracts `VERSION` (tag without `v`), and computes Docker tags `smallstep/step-cli:<version>` plus a Debian variant `<version>-trixie`; for full releases it also appends `:latest` (and the bare `trixie` tag) (`release.yml:21-60`).
3. **goreleaser** — reusable `smallstep/workflows/goreleaser.yml@main` with `enable-packages-upload: true` and the prerelease flag (`release.yml:62-72`).
4. **build_upload_docker / build_upload_docker_debian** — buildx multi-arch pushes (`linux/amd64,386,arm,arm64`) from `docker/Dockerfile` and `docker/Dockerfile.debian` (`release.yml:74-100`).
5. **update_reference_docs** (full releases only) — builds the CLI with `make build`, runs `bin/step help --markdown ./step-cli/reference` inside a checkout of `smallstep/docs`, regenerates the docs route manifest with `jq`, and pushes a signed commit to `smallstep/docs` (`release.yml:104-177`).

## GoReleaser configuration (`.goreleaser.yml`)

- **Builds**: a `default` build (id `default`, `CGO_ENABLED=0`, `-trimpath`, ldflags with `{{.Version}}`/`{{.Date}}`) for darwin (amd64/arm64), freebsd_amd64, linux (386, amd64, arm64, arm 5/6/7, mips, mips64, ppc64le), windows (amd64, arm64), binary `bin/step`; plus an `nfpm` build identical except the binary is named `step-cli` for package builds (`.goreleaser.yml:22-58`).
- **Archives**: versioned `step_<os>_<version>_<arch>...` archives (zip on Windows, tar.gz elsewhere) wrapping `README.md`, `LICENSE`, and `autocomplete/*`; plus `unversioned` archives without the version in the name (`.goreleaser.yml:60-81`).
- **nFPM packages**: `step-cli` `.deb` and `.rpm` (vendor Smallstep Labs, Apache 2.0, section utils, `bindir /usr/bin`) with GPG signature keys from `GPG_PRIVATE_KEY_FILE`, `postinstall`/`postremove` scripts from `scripts/`, ghost entries for `/usr/bin/step` and the bash completion, and versioned + unversioned package IDs (`.goreleaser.yml:94-140`). `debian/copyright` ships in the package; `debian/changelog` is a static stub pointing at the GitHub releases.
- **Signing**: every artifact is signed with `cosign sign-blob` producing `<artifact>.sigstore.json` bundles (`.goreleaser.yml:151-159`); the release header documents `cosign verify-blob` with the GitHub Actions OIDC identity (`release.header`, `.goreleaser.yml:228-242`). The repository root ships `cosign.pub` (an ECDSA P-256 public key) for keyless verification.
- **Distribution**: `checksums.txt` (`.goreleaser.yml:146-149`); a GitHub release on `smallstep/cli` with `prerelease: auto`, name `Step CLI <tag> (<date>)`, and a header of `dl.smallstep.com` download links (`.goreleaser.yml:170-264`); S3 blob uploads (public-read, `AWS_S3_BUCKET`/`AWS_S3_REGION`) of versioned binaries and — for full releases only — `step_latest_*` copies (`.goreleaser.yml:266-309`); a publisher step uploading `packages` artifacts to Google Cloud Artifact Registry via `scripts/package-upload.sh` (`.goreleaser.yml:161-165`).
- **Package manager manifests**: winget (commits to `smallstep/winget-pkgs`, opens a PR against `microsoft/winget-pkgs`, `skip_upload: auto` for prereleases, `.goreleaser.yml:311-441`) and Scoop (commits to `smallstep/scoop-bucket`, `.goreleaser.yml:447-485`). `snapshot` versions use `<tag>-next` (`.goreleaser.yml:167-168`). The commented-out `dockers:` section shows the historical in-goreleaser Docker build, now done by the reusable buildx workflow.

## Packaging assets

- **`docker/`**: `Dockerfile` builds with `golang:alpine` (multi-arch via `BUILDPLATFORM`/`TARGET*`, running `make bin/step`), then runs the binary as a non-root `step` user (uid/gid 1000, `STEPPATH=/home/step`) on alpine with bash/curl/tzdata/jq; `Dockerfile.debian` is the Debian-based variant used for the `-trixie` image tag.
- **`systemd/`**: `cert-renewer@.service` + `cert-renewer@.timer` implement automated renewal: the timer fires every 15 minutes (with up to 5m randomized delay and `Persistent=true`), the oneshot service runs `ExecCondition=/usr/bin/step certificate needs-renewal ${CERT_LOCATION}` and, on success, renews and then `try-reload-or-restart`s the relying `%i.service`; `ssh-cert-renewer.service`/`.timer` do the SSH equivalent. `systemd/README.md` notes these files are redirect targets in the `files.smallstep.com` S3 bucket.
- **`powershell/`**: `install-step.ps1` downloads `step_latest_windows.exe` (and the uninstall script) from `dl.smallstep.com/s3/cli/s3-windows-installer`, installs to `Program Files\Smallstep Labs`, adds the directory to the machine `Path`, and starts the Windows `ssh-agent` service; `uninstall-step.ps1` reverses it.
- **`scripts/`**: `postinstall.sh`/`postremove.sh` manage the `step` → `/usr/bin/step-cli` update-alternatives entry and regenerate the bash completion file; `package-upload.sh` copies `.deb`/`.rpm` artifacts to GCS `gs://artifacts-outgoing/...` (skipping an armhf6 deb due to a registry conflict); `package-repo-import.sh` imports the packages into GCP Artifact Registry (`debs`/`rpms` repositories, prerelease detection via `IS_PRERELEASE`).

## CI and auxiliary workflows

- **`ci.yml`** — on `master` pushes (ignoring `v*` tags) and PRs, and as `workflow_call` (requires `CODECOV_TOKEN`): delegates to the reusable `smallstep/workflows/goCI.yml@main` with `run-codeql: true` and golangci-lint v2.12.1 (`ci.yml:19-30`).
- **`actionci.yml`** — same triggers for the reusable `actionci.yml` workflow (validates the Action itself).
- **`code-scan-cron.yml`** — daily scheduled run of the reusable code-scan workflow.
- **`publish-packages.yml`** — `workflow_dispatch` (input: git tag): checks out the tag, downloads the matching `.deb`/`.rpm` artifacts from the GitHub release, uploads them with `scripts/package-upload.sh`, and imports to Artifact Registry with `scripts/package-repo-import.sh`, allowing package republishing without a full release.
- **`dependabot-auto-merge.yml`**, **`triage.yml`**, and **`openwiki-update.yml`** — dependency automation, issue triage, and the scheduled OpenWiki refresh (the OpenWiki workflow is a generated integration file, not part of the product build).

## Uncertainties

- The exact steps of the reusable workflows (`goCI.yml`, `goreleaser.yml`, `docker-buildx-push.yml`) live in the separate `smallstep/workflows` repository and are only described here by the inputs this repository passes to them.
- Artifact retention, bucket layout, and registry host details (e.g., `dl.smallstep.com` CDN behavior) are external to this repository.
