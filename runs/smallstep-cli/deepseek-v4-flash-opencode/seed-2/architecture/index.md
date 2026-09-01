# Files

- [CA Client Abstraction](ca-clients.md) - How the step CLI talks to a certificate authority, through the CaClient interface backed by either the online HTTP client from smallstep/certificates or the in-process OfflineCA used by --offline.
- [STEPPATH Environment and Contexts](environment-and-contexts.md) - The on-disk state model for the step CLI — STEPPATH layout, defaults.json, ca.json, root_ca.crt, contexts.json, profiles, and how commands resolve flags and paths from this state.
- [Architecture Overview](overview.md) - How the step binary is assembled — the urfave/cli app, init()-based command registration, plugin dispatch, version injection, framework overrides, and error handling.
