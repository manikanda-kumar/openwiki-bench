# Invalid benchmark attempts

This directory preserves attempts excluded from the official matrix because benchmark
infrastructure—not the contestant—made the result incomparable. Each attempt retains its manifest,
raw events, exported session, partial OpenWiki output, and normalized telemetry.

Contestant failures such as provider errors, forbidden delegation, timeouts, and incomplete output
remain in `runs/` and count against reliability. They are never moved here or retried.
