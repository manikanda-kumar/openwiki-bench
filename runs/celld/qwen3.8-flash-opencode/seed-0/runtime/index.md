# Files

- [V8 runtime and the Workers JS layer](v8-workers.md) - celld executes Wrangler bundles on rusty_v8 directly, one isolate per cell behind a core-authorized runtime manager; a cached prelude plus a 23k-line JS harness build the Workers/DO environment over synchronous Rust ops for SQLite storage, SQL, sockets, crypto, and wasm modules compiled once per process.
