# Files

- [Managed Process Crash Recovery (Reaper)](crash-recovery.md) - The Main-process ManagedProcessReaper that persists managed-process containment records in a versioned journal, verifies process identity by start fingerprint, reaps POSIX process groups or Windows Job Objects, and fails closed on containment.
- [Managed Background Processes (Agent Host)](service.md) - The managed background-process service in the Agent Host — lifecycle and states, readiness, output buffering and cursors, policy limits, LAN-bind confirmation, stop modes, and the POSIX/Windows backends.
