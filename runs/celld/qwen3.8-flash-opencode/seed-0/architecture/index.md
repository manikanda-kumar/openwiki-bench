# Files

- [Actor and execution boundary (celld shell)](actor-execution.md)
- [Sans-I/O decision core (celld-logic)](decision-core.md) - crates/logic holds every behavioral decision of celld as pure functions over a replayable State — on_event consumes Events and emits Effects, all I/O belongs to adapters, and each policy (gates, routing, restore, pressure, wake, alarm, cron, KV, Queue) is a small falsifiable module.
