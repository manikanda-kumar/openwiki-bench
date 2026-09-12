# Files

- [Build, Test & Release Tooling](build-and-test.md) - How the desktop is built (tsup main/preload/host, Vite renderer), tested (test-runner), gated (verify.mjs), packaged (electron-builder), and released across Linux/macOS/Windows, including the signature and signing status.
- [Desktop Window, Updates & App Lifecycle](window-and-updates.md) - The desktop shell — main window creation and persisted state, menu and tray, deep links, single-instance lock and custom app protocol, plus the update manager's state machine and install-on-quit gates.
