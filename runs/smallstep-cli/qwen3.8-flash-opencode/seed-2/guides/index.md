# Files

- [Change Guide: Add a New Command](adding-a-command.md) - Step-by-step recipe for adding a new step subcommand: package placement, cli.Command registration, root.go enablement, usage-text and help-quality requirements, shared flag/error conventions, CHANGELOG entry, and the validation commands to run.
- [Change Guide: Support a New Provisioner Type](adding-a-provisioner-type.md) - Maintenance recipe for teaching step's token flows about a new step-ca provisioner type: where the type comes from, the token-flow dispatch and prompt filters to extend, flag and token-option conventions, the duplicated offline dispatch, and the tests to touch.
