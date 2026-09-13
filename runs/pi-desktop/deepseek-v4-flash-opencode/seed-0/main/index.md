# Files

- [Advanced Browser Mode](browser-advanced-mode.md) - The opt-in Advanced Browser Mode — CDP command surface, network capture and replay, request/response header rules with a secret vault, saved JavaScript experiences, and the fail-closed cookie gate.
- [Built-in Browser Service](browser-service.md) - The Main-owned built-in browser — WebContentsView tabs, profiles and sessions, per-session authorization with persistent vs runtime grants and leases, network policy, downloads, and tab restoration.
- [Agent Host Supervision and Recovery](host-supervision.md) - How the Electron Main process supervises the Agent Host utilityProcess — spawn, heartbeat liveness, crash restart budget, toolchain/browser snapshot acknowledgement, managed-process owner identity, and packaged startup validation.
- [Updates and Distribution Packaging](update-and-packaging.md) - The electron-updater integration, the update manager state machine with download watchdog and install gating, and the electron-builder packaging/release pipeline for macOS, Windows, and Linux.
- [Window, Tray, and App Lifecycle](window-and-lifecycle.md) - Main-process window lifecycle, single-instance lock, deep links, tray/badge, menus, renderer crash recovery, window-state persistence, and background mode.
