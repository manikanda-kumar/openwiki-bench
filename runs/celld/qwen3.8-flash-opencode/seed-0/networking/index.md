# Files

- [HTTP listeners and the peer network](listeners-and-peers.md) - celld exposes a public Worker ingress and an internal peer/operator listener; cell calls ride a pooled per-peer tunnel of plain HTTP established under an HMAC signature with replay and clock-window fences, and WebSocket ingress, proxying, and outbound connects share one framing implementation.
