# Files

- [Change Guide: Adding a Gatekeeper](adding-a-gatekeeper.md) - Step-by-step walkthrough for shipping a new gatekeeper Worker — package skeleton, the Vendor/User/Instance trio, OAuth and resource configurators, optional auto-provisioning, router and backend wiring as pure binding changes, deploy inputs, and tests — grounded in the existing gatekeeper-github package.
- [Change Guide: Modifying the RPC API](changing-the-rpc-api.md) - Walkthrough for changing workshop-shared's RPC surface — declaring the method, implementing it in the kernel with the compile-time role checks that new Overseer methods must pass, wiring a frontend caller with stub-wrapping and disposal, and the validation/review rules that apply.
