---
type: operations-guide
title: Packaging and Release
description: How installers are produced (electron-builder targets per platform), the packaged artifact gates (bundled tools, Windows helper reproducibility, SBOM), and the release workflow contract.
tags: [packaging, electron-builder, release, windows-helper, sbom, signing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T22:28:03.854Z
---

## Packaging modes

`npm run pack` (`package-desktop.mjs --dir`) builds an unpacked app directory; `npm run dist` (`--release`) builds installers. The release path always: prepares bundled tools, runs the full `npm run verify` gate (blocking), then invokes electron-builder with `--publish never`, and on Windows additionally verifies the reproducible authoritative Windows managed-process helper, generates and verifies a release SBOM (repo://scripts/package-desktop.mjs#L13-L77).

## electron-builder configuration

`electron-builder.yml` defines the production layout:

- `files` includes `out/**` and package.json, and strips authoring artifacts (md/ts/scripts/configs) — with explicit FileSets re-adding exactly the Pi authoring assets the agent needs at runtime: pi-coding-agent `README.md`, `docs/**`, `examples/**`, and `dist/**/*.d.ts`, plus pi-ai/pi-telemetry/pi-tui/pi-client/pi-protocol declarations and metadata (repo://electron-builder.yml#L9-L86).
- `extraResources` ships `THIRD_PARTY_NOTICES.md`, signed runtime catalogs (`toolchains/runtime-catalog.json`, `core-catalog.json`), and the target's core search tools under `toolchains/core/${platform}-${arch}` — managed Node/Python/Git archives are never shipped, they remain download-on-consent (repo://electron-builder.yml#L89-L99).
- Platform targets: macOS DMG + ZIP for arm64 and x64 (hardened runtime, entitlements); Windows NSIS x64, with helper + manifest under `managed-process/win32-x64` in extraResources. The Windows artifact name is deliberately `Pi-Agent-Desktop-Unsigned-Beta-Setup-${version}` because Authenticode is not provisioned yet — the filename keeps the trust limitation visible (repo://electron-builder.yml#L100-L142).
- Linux AppImage x64 uses `--appimage-desktop-launch` in place of electron-builder's unsafe default AppImage argument, keeping Chromium sandboxing enabled (repo://electron-builder.yml#L143-L153).
- Deep-link protocol `pi-agent-desktop://` and GitHub draft-release publish config are declared (repo://electron-builder.yml#L155-L163).

## Bundled search tools pipeline

`scripts/prepare-bundled-tools.mjs` downloads ripgrep 15.2.0 and fd 10.3.0 from fixed URLs, verifying bytes and SHA-256 against pinned definitions (including pinned license files), caching under `build/toolchains/.core-cache`, and extracting through the secure extractor with darwin code-digest integrity checks (repo://scripts/prepare-bundled-tools.mjs#L6-L60). This is what makes offline search work out of the box, and CI's quality job runs it (`--target linux-x64`) before packaging (repo://.github/workflows/build-desktop.yml#L188-L190).

## Windows helper gates

The Rust helper is built reproducibly; `verify-windows-helper-reproducibility.mjs` rebuilds and compares against the authoritative configuration (CI enforces it on Windows and release paths). Release Windows packaging runs an NSIS upgrade test against a pinned previous installer in addition to helper reproducibility and the SBOM pair (repo://scripts/package-desktop.mjs#L33-L51, repo://.github/workflows/build-desktop.yml#L373-L410).

## Packaged artifact verification

`scripts/verify-packaged-toolchains.mjs` (exposed as `check:packaged-toolchains`) validates an installer's output directory for a specific target (`darwin-arm64|darwin-x64|win32-x64|linux-x64`) by: verifying packaged resources, the Windows managed-process helper (including release-helper mode and PE checks), Pi runtime assets against the expected package.json version, bundled search tools, Linux sandbox bits — then, unless `--static`, actually launching the packaged app with `--validate-packaged-startup` and on Windows also running packaged cleanup fault validation (repo://scripts/verify-packaged-toolchains.mjs#L8-L57). CI runs it with `--release-helper` per matrix target (repo://.github/workflows/build-desktop.yml#L408-L412).

## Release contract (tag builds)

The `release-contract` job validates a `v*` tag: the tag must be an ancestor of main, the version must be stable `x.y.z` without prerelease suffix, the tag must match package.json, and no draft/public release may already exist under that name (repo://.github/workflows/build-desktop.yml#L418-L455). Then per-platform release jobs produce signed/notarized macOS assets (`dist:mac:signed` / `dist:mac:notarized` via `build-mac-release.mjs`, which requires Apple credential strategies and passes `mac.notarize` controls) and Windows assets; managed runtime checksums are verified against upstream metadata on tags (repo://scripts/build-mac-release.mjs#L24-L74, repo://scripts/check-desktop-security.mjs#L353-L357).

## Uncertainty

The exact per-arch release job definitions (signing identities used in CI, draft publication order) are only partially visible in the workflow excerpt cited; consult `.github/workflows/build-desktop.yml` in full when operating a release.

## Related pages

- [Build and Testing](/openwiki/development/build-and-testing.md) — the verify gate run before packaging.
- [Toolchain Management](/openwiki/workflows/toolchain-management.md) — runtime catalog and download-on-consent model.
