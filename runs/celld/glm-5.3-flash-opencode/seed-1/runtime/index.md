# Files

- [Resident capacity, pressure shedding, and overload](admission-pressure.md) - The three separate resource decisions — a hard resident-cell cap at admission, a memory-pressure classifier with hysteresis that sheds idle cells, and per-cell request admission — plus the V8 heap limit.
- [Cell lifecycle and activation](cell-lifecycle.md) - The cell state machine — inactive/hibernated/resident, activation with restore, the serial executor (actor) and its timers, isolate pool balancing, alarm wake and orphan revival, and deployment moves at safe points.
- [JS/V8 host surfaces](js-v8-host.md) - What the V8 embedding exposes to Worker code — isolate bootstrap and bytecode caching, storage/SQLite ops, WebSocket hibernation and the output-gate frame hold, crypto and zlib bridges, and the Cloudflare compat boundary.
