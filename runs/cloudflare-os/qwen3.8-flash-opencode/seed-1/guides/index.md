# Files

- [How to Add a Format Blueprint](adding-a-format-blueprint.md) - Change guide for the deployment-shipped output-format blueprints — import script, sidecar curation fields, the generated module and build cache caveat, install-on-first-request mechanics, and the immutable blueprintId rule.
- [How to Add a Gatekeeper](adding-a-gatekeeper.md) - Change guide for implementing a new gatekeeper worker — required RPC interfaces, OAuth connect flow with nonce, approval queue and simulation contract, typed API surface for agents, configurator UI constraints, bindings, deploy inputs, and tests.
- [How to Change the Shared RPC API](changing-the-shared-api.md) - Change guide for packages/workshop-shared/src/api.ts and the Cap'n Web contract — kernel review bar, doc-comment requirement, derived types over mirrored casts, pipelining, stub disposal, useState wrapping, and validation via @validateRpc.
