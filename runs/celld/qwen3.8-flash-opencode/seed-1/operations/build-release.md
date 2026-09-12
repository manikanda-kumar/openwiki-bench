---
type: "Reference"
title: "Build and Release Pipeline"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-e28533de6827635caf8da428
    resource: repo://clippy.toml
  - id: openwiki-source-3fa7b94a6ed05a0c35f6ec1f
    resource: repo://crates/celld/Cargo.toml
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---


# Build and Release Pipeline

## Workspace layout

One workspace with `members = ["crates/*"]` holds the three crates (Cargo.toml#L3-L5), and "every direct dependency lives here so the crates can never drift onto two versions of the same crate; members add their own features" (Cargo.toml#L33-L35). The resolver is version 2, and the edition is 2021 with `rust-version = "1.94.1"` per crate (crates/celld/Cargo.toml#L4-L6, crates/logic/Cargo.toml#L4-L6).

Version pins are decisions, not drift: `fastwebsockets = "=0.8.1"` is exact because its `unstable-split` feature "can rename or drop [it] without upstream calling that a break," and "celld carries that risk knowingly" (Cargo.toml#L50-L59); `sqlite-vec = "=0.1.9"` pins the audited C amalgamation because the binding sits outside its pre-v1 compatibility policy (Cargo.toml#L116-L118); `urlpattern = "=0.4.2"`; and `v8 = "152.1"` was an ordinary dependency only once rusty_v8 shipped the `v8::Locker`/Send-Globals support shared isolates need (Cargo.toml#L137-L140). The jemalloc allocator crates carry the `stats` feature specifically so the pressure classifier can subtract `stats.allocated` from `stats.resident` — "the pages jemalloc keeps but no cell uses" (Cargo.toml#L122-L127).

The release version is read from `crates/celld/Cargo.toml` (currently 0.4.0, crates/celld/Cargo.toml#L3); CI extracts it with `sed` and refuses to move a published tag: "release `$tag` is already published; bump the version" (.github/workflows/release.yml#L59, #L156-L163).

## Profiles: what each one trades

The workspace comment explains the shipped artifact: "Size-tuned: fat LTO prunes unused dependency code, panic=abort drops unwind tables. opt-level `\"s\"` (not `\"z\"`) — measure RPS before trading further" (Cargo.toml#L7-L9): `release` = `lto = "fat"`, `codegen-units = 1`, `opt-level = "s"`, `panic = "abort"`, `strip = true` (Cargo.toml#L9-L14).

The `lab` profile is "the lab fast loop: release optimization minus the fat-LTO relink that dominates rebuild time, plus incremental compilation," with thin LTO, 16 codegen units, and — unlike `release` — `strip = false` plus `debug = "line-tables-only"` because "the lab image keeps symbols so `perf` on a node attributes CPU by function; the shipped release profile stays stripped" (Cargo.toml#L16-L27). Shipped artifacts always build `--profile release` (Dockerfile#L8-L10).

`dev` gets two targeted overrides, `opt-level = 3` for `sha2` and `rsa`, so debug runs of the crypto surface are usable without slowing the whole tree (Cargo.toml#L28-L31).

## Lint gates encode the architecture

`crates/celld/Cargo.toml` sets `[lints.rust.unexpected_cfgs] check-cfg` for the internal cfg flags and `[lints.clippy] disallowed_macros = "forbid"` (crates/celld/Cargo.toml#L14-L21), and the library opts into `#![warn(clippy::disallowed_methods, clippy::disallowed_types)]` (crates/celld/lib.rs#L3). The rule list in `clippy.toml` is the architecture boundary from [Node Runtime and Actor Loop](/openwiki/architecture/node-runtime.md): ambient Tokio spawn/time, `Instant`/`SystemTime`, `rand::random`, direct `std::fs`, and `println!` are all forbidden with reasons naming their `asyncrt`/`cli_output` replacements (clippy.toml#L4-L26, #L84-L86). Even the `ltx` crate enables the same warning at its root (crates/ltx/src/lib.rs#L1). CI enforces them: the container test stage runs `cargo test --locked` and `cargo clippy --all-targets --locked -- -D warnings`, and "the final image depends on this stage, so a break in the engine's tests or lints stops the build" (Dockerfile#L21-L34).

## Container build

The Dockerfile is a three-stage chain: `build` compiles `celld` for the target architecture with registry/git/target BuildKit caches (Dockerfile#L6-L19); `test` derives from it, adds clippy and the `sqlite3` CLI ("the ltx fault-injection oracle diffs databases with the sqlite3 CLI", Dockerfile#L23-L34); the runtime image is `debian:bookworm-slim` plus `ca-certificates`, copies `/out/celld` **from the test stage**, and labels OCI revision/version (Dockerfile#L36-L46). The Rust toolchain default is 1.97.1 in both Dockerfile and workflow (Dockerfile#L3, release.yml#L31). Note: the oracle's test code itself is not part of this repository snapshot (no `#[test]`/`tests/` exist under `crates/`), so `cargo test` currently has nothing in-crate to run (docs/testing.md describes the external test program; see [Sans-IO Decision Core](/openwiki/architecture/decision-core.md) on where tests compile behind `cfg(celld_internal_tests)`).

## The two-phase release

The pipeline comment is the contract: "One release pipeline, two phases. A push to the candidate ref builds every native target, attests provenance, uploads everything to a DRAFT GitHub release, and smoke-builds the container image. Publishing the draft is a separate, human-approved step… a failed candidate is deleted and main never moves" (release.yml#L3-L14).

**Phase 1 (push to `candidate`)**:
- `build-celld` compiles `--release --locked` on three targets (x86_64/aarch64 Linux, aarch64 macOS), checks `celld --version` against the manifest version, packages with `gzip -9 -n` ("-n omits name and timestamp so the envelope is reproducible whenever the binary is"), and uploads artifacts (release.yml#L35-L75).
- `container-check` runs the full Dockerfile build — including the test stage — but pushes nothing (release.yml#L77-L108).
- `draft-release` verifies all three assets exist, attests build provenance (only for public repositories), then deletes any existing draft for the tag, rebuilds it, and writes the release notes from the release commit's own message body (trailers stripped, wraps unfolded) (release.yml#L110-L185).

**Phase 2 (release: published)**: `build-container` validates the tag equals `v$version`, builds per-architecture images from the tagged commit with registry cache export, `--provenance=mode=max --sbom=true`, and pushes `IMAGE:sha-$TAG_SHA-{amd64,arm64}` (release.yml#L187-L247); `publish-container` stitches them into a manifest list tagged `sha-<sha>`, `vX.Y.Z`, `X.Y`, and `latest`, attests the manifest digest to the registry, and — on public repos — verifies anonymous manifest access after logging out (the "red-by-design" note explains why that check is skipped while the package is internal) (release.yml#L249-L316).

Installation provenance is then verifiable with `gh attestation verify` against the release assets, and the container ships on `ghcr.io/denoland/celld` (README.md#L36-L65).

Related: [Quickstart](/openwiki/quickstart.md), [Node Runtime and Actor Loop](/openwiki/architecture/node-runtime.md), [Deploy and Local Development](/openwiki/operations/deploy-develop.md), [Fleet Operations](/openwiki/operations/fleet-operations.md).
