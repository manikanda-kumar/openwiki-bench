# Files

- [Child Sessions](child-sessions.md) - Agent-spawned child coding sessions with MAX_SPAWN_DEPTH 2, concurrent and total caps, D1 admission leases, parent/child correlation, and sandbox tools that call the control plane.
- [Image Prebuild](image-prebuild.md) - Repository and environment image builds using fingerprint identity, create-bind-launch, a 30-minute cron, queue finalization, and spawn-time selection that never blocks sessions.
- [Sandbox Lifecycle](sandbox-lifecycle.md) - Session Durable Object sandbox spawn, warm, snapshot versus persistent pause/resume, inactivity and heartbeat, circuit breaking, and reconnect denial for stopped or stale sandboxes.
- [Session Lifecycle and Prompt Flow](session-lifecycle.md) - Session create, Durable Object prompt queue, sandbox event processing and broadcast, archive/unarchive, and why dropping a client WebSocket does not stop the sandbox.
- [Source Control, Git Auth, and Pull Requests](source-control.md) - Deployment-wide SCM_PROVIDER, brokered GitHub App installation tokens for git clone/fetch/push, user OAuth for attributed pull requests, and the sandbox git credential helper.
