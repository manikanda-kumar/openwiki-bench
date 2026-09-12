---
type: release
title: Build and release pipeline
description: The two-phase GitHub Actions release pipeline (candidate builds to a draft, human-approved publish triggering containers), the Dockerfile's build/test stages, and the release profiles they exercise.
tags: [release, ci, docker, pipeline, attestation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Build and release pipeline

## Two-phase release philosophy

The workflow header states the design: "One release pipeline, two
phases. A push to the candidate ref builds every native target, attests
provenance, uploads everything to a DRAFT GitHub release, and
smoke-builds the container image. Publishing the draft is a separate,
human-approved step after the candidate binaries pass verification; a
failed candidate is deleted and main never moves"
[.github/workflows/release.yml](repo://.github/workflows/release.yml#L1-L12).

Triggers: push to `candidate`, `release: published` (starts the
container phase), and `workflow_dispatch`. The workflow pins
`RUST_VERSION: 1.97.1` and `IMAGE: ghcr.io/denoland/celld`.

## Candidate phase (push to candidate)

- `build-celld` builds `cargo build --release --locked` on three native
  targets — `x86_64-unknown-linux-gnu` (ubuntu-22.04),
  `aarch64-unknown-linux-gnu` (ubuntu-22.04-arm), and
  `aarch64-apple-darwin` (macos-14) — then checks that
  `target/release/celld --version` matches the crate version read from
  `crates/celld/Cargo.toml` (a self-check that the version macro and the
  manifest agree).
- **Packaging is gzip only**: `gzip -9 -n -c` where `-n` "omits name and
  timestamp so the envelope is reproducible whenever the binary is".
  Assets are minimal — "the binaries, nothing else. Integrity is the
  attestation plus GitHub's own immutable per-asset digests; gzip's CRC
  catches corruption in transit"
  [.github/workflows/release.yml](repo://.github/workflows/release.yml#L59-L69).
- `container-check` builds the Dockerfile (`linux/amd64`) so "the
  Dockerfile must build and its test stage pass before anything can be
  published" — nothing is pushed at candidate time.
- `draft-release` downloads artifacts, runs
  `actions/attest-build-provenance@v2` on public repos only (an
  installability assertion: a private repo merely skips the step and
  keeps release asset digests), and creates/refreshes the **draft**
  release. The release body is derived from the release commit's
  message — subject dropped, `*-by:` trailers stripped, hard wraps
  unfolded — so the notes are the commit message
  [.github/workflows/release.yml](repo://.github/workflows/release.yml#L69-L151).

## Publishing phase (release: published)

- `build-container` builds and pushes per-architecture images
  (`linux/amd64` on ubuntu-22.04, `linux/arm64` on ubuntu-22.04-arm),
  each tagged `IMAGE:$TAG_SHA-amd64` / `-arm64`, with registry build
  cache (`IMAGE:buildcache-<suffix>`), `--provenance=mode=max`, and
  `--sbom=true`.
- Tag validation is enforced: the release tag must equal `v$version`
  read from the crate manifest
  [.github/workflows/release.yml](repo://.github/workflows/release.yml#L209-L213).
- `publish-container` stitches a multi-architecture manifest with
  several immutable/release tags (`$IMAGE:sha-$TAG_SHA`,
  `IMAGE:<tag>`, `IMAGE:$version`, `IMAGE:latest`), resolves its digest,
  and runs the same provenance attestation on the manifest. A publish
  flow also verifies anonymous access ("while the repository is internal
  an anonymous pull can only 401, and a red-by-design run teaches people
  to ignore red")
  [.github/workflows/release.yml](repo://.github/workflows/release.yml#L255-L272).

## The Dockerfile's roles

[Dockerfile](repo://Dockerfile):

- Builds `celld` with `cargo build --profile "${CELLD_PROFILE}"
  --locked -p celld` under a cargo cache mount; the build profile is a
  build-arg (`CELLD_PROFILE=release` by default) so a fast-loop caller
  can pass `lab` "to skip the fat-LTO relink and keep incremental state
  in the target cache" — this ties the Dockerfile directly to the
  workspace profile tuning described on
  [Workspace layout](/openwiki/architecture/workspace-layout.md).
- The `test` stage is part of the final image's dependency chain — "so a
  break in the engine's tests or lints stops the build". It installs
  clippy and the `sqlite3` CLI ("the ltx fault-injection oracle diffs
  databases with the sqlite3 CLI"), then runs `cargo test` and
  `cargo clippy ... -- -D warnings` under the same profile.
- The final stage is `debian:bookworm-slim` with `ca-certificates` only;
  OCI labels record revision and version from `CELLD_COMMIT` /
  `CELLD_VERSION` build args; the entrypoint is the `celld` binary.

## Install and upgrade flow (consumer side)

The installer downloads the `celld` binary (provenance verifiable with
`gh attestation verify`), keeps each release under
`~/.local/lib/celld/releases` and points one symlink at the current one;
removal is deleting the symlink and the releases directory
[README.md](repo://README.md#L36-L55). esbuild must be on PATH for
Worker-project deploys, not asset-only ones
[README.md](repo://README.md#L47-L48).

The runtime environment (profile choices, tuning switches) is covered on
[Configuration](/openwiki/operations/configuration.md). Version upgrade
mechanics — including rolling-vs-stopped upgrade constraints — are
documented in
[Node command surface](/openwiki/operations/node-cli.md).
