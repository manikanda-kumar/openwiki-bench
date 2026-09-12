---
okf_version: "0.2"
---

# Files

- [Architecture and ownership boundaries](architecture.md) - celld is a three-crate Rust workspace — a sans-IO decision core (celld-logic), an effect-executing node shell (celld), and an embedded SQLite replication engine (celld-ltx) — that runs Cloudflare Workers and Durable Objects on a bucket-coordinated fleet.
- [Quickstart](quickstart.md) - Build celld from source, run an example app with celld dev, deploy to a qualified bucket, start fleet nodes, and find the right wiki page per engineering task.

# Directories

- [architecture](architecture/)
- [concepts](concepts/)
- [deployments](deployments/)
- [development](development/)
- [networking](networking/)
- [operations](operations/)
- [persistence](persistence/)
- [platform](platform/)
- [runtime](runtime/)
