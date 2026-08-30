# Files

- [Automations: Triggers, Conditions, and Runs](automations.md)
- [Environments (Named Prebuildable Repository Sets)](environments.md) - Environments are named, curated, prebuildable repository sets with their own secrets, channel associations, and integration overrides; sessions launched from one snapshot its members and record the environment id as provenance.
- [Managed Skills](managed-skills.md)
- [Models and Provider Accounts](models-providers.md) - How Open-Inspect's shared model catalog, subscription-backed ChatGPT and SuperGrok provider accounts, session-pinned provider auth snapshots, credential brokers, and sandbox environment markers work together.
- [Pre-Built Images (Image Build Subsystem)](prebuilt-images.md) - How Open-Inspect pre-bakes sandbox image artifacts for repositories and environments — build scopes, fingerprints, the trigger/scheduler/rebuild policy, callback auth, the finalization queue, and spawn-time image selection.
- [Secrets — Scopes, Encryption, and Injection](secrets.md) - How Open-Inspect stores and delivers environment-variable secrets — global, repository, and environment scopes with their precedence rules, AES-256-GCM at-rest encryption, validation caps, the session-target fold that resolves a sandbox's final env set, and the fail-closed encryption-key contract.
- [Sessions (Targets, State, and Lifecycle Model)](sessions.md) - Sessions are the durable unit of background work in Open-Inspect — one per Durable Object with an embedded SQLite database, targeting a single repo, an ordered multi-repo set (up to 10, first is primary), a saved environment, or no repository — carrying messages, events, artifacts, participants, and sandbox state, with statuses tracked both in the D1 index and the DO.
