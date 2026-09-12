---
type: concept
title: Security boundary and fleet authentication
description: The celld trust boundary, the public and internal listeners, the fleet HMAC peer authentication with clock limit and replay protection, the peer tunnel, forwarded-header policy, and bucket credential authority.
tags: [security, authentication, hmac, listeners, trust-boundary]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-7091fbd5baa39fe548c0e34d
    resource: repo://crates/celld/control_plane.rs
  - id: openwiki-source-202feef6a807aadb656fd2df
    resource: repo://crates/celld/main/peer_tunnel.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-0d6e1a1251e54f3519e4e37d
    resource: repo://crates/celld/peer_probe.rs
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# Security boundary and fleet authentication

celld is an alpha. It is not safe for hostile multi-tenant use, and security
fixes apply to the latest release only (docs/security.md#L3-L5).

## The trust boundary

One fleet runs one application, and celld trusts the application code, the
fleet nodes, and the operators. Application code can use its configured
bindings and can consume shared node resources, so do not run code from
mutually distrusting tenants in one fleet (docs/security.md#L8-L11).

celld depends on two external security boundaries (docs/security.md#L13-L18):

- A trusted private network protects the internal listener. Use an encrypted
  overlay when the private network does not provide confidentiality.
- Object storage credentials control the fleet. Give each credential access
  to one fleet bucket only.

Cell ownership fencing protects storage consistency, but it does not isolate
hostile applications (docs/security.md#L147-L155).

## The two listeners

celld opens two HTTP listeners (docs/security.md#L21-L45):

- The **public listener** (`--listen`) serves the deployed Worker. It
  reserves only `/.well-known/celld/health`; a healthy node returns 200 with
  `{"ok":true}` and an unhealthy node returns 503. The deployed Worker owns
  every other public path.
- The **internal listener** (`--internal-listen`) serves the peer protocol
  and the operator API. Its default address is `127.0.0.1:0`, so celld
  selects an available loopback port at each start, and `--advertise` gives
  peers an address that reaches it. It does not pass an unknown path to the
  Worker; it returns 404, so an operator request cannot become an application
  request.

An explicit advertised address requires an explicit internal-listener
address, and celld rejects an explicit non-loopback public listener without
an explicit internal listener; these checks prevent an obsolete one-listener
configuration (docs/security.md#L32-L34). celld cannot verify a hostname or a
translated port, so the operator must route the advertised address to the
internal listener and must not route it to the public listener
(docs/security.md#L36-L38).

## The fleet HMAC

The internal listener has three request groups
(docs/security.md#L55-L68):

- Most operator routes let an operator inspect or control a node without
  request authentication.
- The `/peer/tunnel` route establishes a tunnel for cell fetch, RPC, and
  WebSocket calls; the establishment request carries the fleet HMAC, a clock
  limit, and replay protection, so only a holder of the fleet secret can open
  a tunnel. Each call then crosses inside the tunnel as plain HTTP with the
  cell scope in a reserved header, and these inner calls are not signed.
- The peer-control routes and the reserved-cell routes use the fleet HMAC for
  request authentication, a clock limit, and replay protection.

All three groups require the trusted private network
(docs/security.md#L68).

The HMAC implementation is in `crates/celld/peer_auth.rs`. The protocol
version is 5, the domain string is `cells-peer-request-v1`, and the signature
is HMAC-SHA256 over a canonical request:
`DOMAIN \n PROTOCOL_VERSION \n method \n path_and_query \n body_hash \n
source \n target \n timestamp \n nonce`
(crates/celld/peer_auth.rs#L16-L22, crates/celld/peer_auth.rs#L251-L269).
The signed headers are `x-cells-peer-version`, `x-cells-peer-source`,
`x-cells-peer-target`, `x-cells-peer-timestamp`, `x-cells-peer-nonce`,
`x-cells-peer-body-sha256`, and `x-cells-peer-signature`
(crates/celld/peer_auth.rs#L31-L36, crates/celld/peer_auth.rs#L159-L175).

Verification checks the protocol version, validates the source and target
identities, enforces a clock window of 30 seconds, compares the body hash,
and verifies the signature before checking that the target matches the
expected node session (crates/celld/peer_auth.rs#L178-L228). Replay
protection keeps a nonce cache with a 16-byte nonce and a 60-second
retention, bounded at one million entries; a repeated nonce is rejected and
a full cache returns `ReplayCapacity`
(crates/celld/peer_auth.rs#L23-L29, crates/celld/peer_auth.rs#L230-L244). The
shared secret is stored at `fleet/peer-auth.json` with schema version 1; the
first current node creates it (crates/celld/peer_auth.rs#L20-L22,
README.md#L196-L200).

## The peer tunnel

Establishment is an h1 upgrade on `/peer/tunnel` — CONNECT semantics with
Upgrade mechanics. After the 101 the connection is an opaque duplex stream,
and application requests cross as literal HTTP driven by hyper on both ends,
so the hop never interprets the inner bytes and the headers the cell must
receive byte-faithfully (`Host`, `Content-Length`, `Upgrade`) are data rather
than metadata. Per-call control (scope, cell name, request id, capacity
handoff) rides `x-cells-*` headers on the inner request; node A overwrites
them and node B strips them, so the reserved names cannot be smuggled by an
application in either direction (crates/celld/main/peer_tunnel.rs#L3-L14).
Idle tunnels are pooled per peer and reused for sequential calls — plain h1
keep-alive inside the tunnel, never multiplexing — because without reuse
every call is a fresh TCP connection and a loopback-speed caller saturates
the ephemeral-port range into `TIME_WAIT` within seconds
(crates/celld/main/peer_tunnel.rs#L16-L20). The tunnel version is 5
(crates/celld/main/peer_tunnel.rs#L40-L42).

The tunnel permits a request body to stream to the owner, so the fleet HMAC
cannot sign an individual call. The establishment signature decides who can
open a tunnel, and a tunneled call can address an application class or a
runtime class, so every path to a runtime class demands the fleet secret. The
signature does not authenticate the bytes after establishment and does not
encrypt any traffic, so the private network must stay trusted and the fleet
HMAC does not replace that network boundary
(docs/security.md#L70-L76).

celld does not terminate TLS on either listener. Terminate public TLS at an
ingress proxy, and put the internal listener on a private network or an
encrypted overlay such as WireGuard or Tailscale when the network does not
provide confidentiality (docs/security.md#L78-L80). Peer traffic crosses the
internal network as plaintext HTTP (docs/limitations.md#L22-L27).

## Signed peer probes

The node lease refuses to publish without a signed-probe key
(crates/celld/ownership_store.rs#L428-L432). `celld diagnose` sends a signed
direct probe to each live peer: the probe uses a separate domain
(`cells-peer-probe-v1`), carries a challenge, and the response is verified
for identity and challenge match before it is accepted
(crates/celld/peer_probe.rs#L14-L17, crates/celld/peer_probe.rs#L110-L179).
`/peer/probe` returns the signed diagnostic response
(crates/celld/main.rs#L2632).

## Forwarded-header policy

celld ignores `X-Forwarded-Host` and `X-Forwarded-Proto` by default. Set
`--trust-forwarded-headers` or `CELLD_TRUST_FORWARDED_HEADERS=1` only when a
trusted proxy replaces both headers; celld uses the last value in each header,
so an earlier client value does not override the proxy value
(docs/security.md#L105-L110). celld always takes the path and query from the
request target and ignores the scheme and authority in an absolute-form
target, so a client cannot bypass the host policy through the request line
(docs/security.md#L112-L114).

Without a trusted proxy the `Host` header controls the hostname in
`request.url`. celld accepts a hostname, an IPv4 address, or a bracketed IPv6
address with an optional port, rejects malformed and noncanonical values, and
uses `celld.local` when no source gives a valid host. These checks keep the
path and query valid but do not make the hostname trustworthy; an application
must not use an unchecked hostname for an authorization decision
(docs/security.md#L116-L124).

## Request body limits

The public Worker listener and `/do/<ID>` have a 1 GiB request body limit by
default (`CELLD_MAX_REQUEST_BODY_BYTES`). celld returns status 413 for a
declared oversized body and when a Worker reads past the limit. For a method
other than `GET` or `HEAD`, `/do/<ID>` streams a body when its declared
length is at least 1 MiB or its length is unknown; celld collects each
smaller body before dispatch (docs/security.md#L126-L135).

## Bucket credential authority

The fleet bucket is the root of authority: it stores the deployments, the
cell state, the ownership leases, the node leases, and the shared
peer-authentication secret. A person who holds the bucket credentials
controls the fleet, so give each credential access to one fleet bucket only
and replace a credential after a suspected disclosure
(docs/security.md#L137-L145). See the [object storage](object-storage.md)
page for credential methods.

## Managed control plane

The managed control-plane path (`CELLD_CLOUD`) defaults to the control URL
`https://celld.dev` in the `prod` environment
(crates/celld/control_plane.rs#L25-L26). A managed deployment can nudge a
node to adopt the deployment pointer; an escape hatch
(`CELLD_CLOUD_RESTART_ON_DEPLOY`, off by default) re-executes the process
image instead of adopting in place (crates/celld/control_plane.rs#L38-L54).
