---
type: architecture
title: "Failure Handling and Security Conventions"
description: "Cross-cutting error model and exit codes (errs, STEPDEBUG, panic handler), input validation patterns, and the CLI's security gates: https-only CA URLs, fingerprint-validated roots, token parsing, subtle/insecure flags, and password/key handling."
tags: [error-handling, exit-codes, security, validation, trust, passwords]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-2f943a548d2d958840bb3721
    resource: repo://command/ca/renew.go
  - id: openwiki-source-bd45ebb80f1a74f84552aea9
    resource: repo://command/ca/root.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-b869844a56f117af4344a1a7
    resource: repo://command/crypto/change-pass.go
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
  - id: openwiki-source-86501334732a4b301733c657
    resource: repo://utils/cautils/offline.go
  - id: openwiki-source-df2d16b29c2bbf9191277bfd
    resource: repo://utils/read.go
  - id: openwiki-source-90c79f73277cd4b004ddf996
    resource: repo://utils/utils.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

## Error model and exit codes

Commands raise errors from the cli-utils `errs` package (constructors like `errs.NumberOfArguments`, `errs.RequiredFlag`, `errs.InvalidFlagValue`, `errs.IncompatibleFlagWithFlag`, `errs.MutuallyExclusiveFlags`, `errs.RequiredWithFlag`). These errors implement a `Message() string` interface, which is the contract the top-level runner inspects (`internal/cmd/root.go:62-84`):

- **Normal error**: the message goes to stderr, followed by `Re-run with STEPDEBUG=1 for more info.`; the process returns **exit code 1**.
- **`STEPDEBUG=1`**: the full `%+v` error form (with cause chain) is printed before the message.
- **Non-`errs` error**: printed as-is (or `%+v` under `STEPDEBUG=1`), also exit code 1.
- **Panic** (`internal/cmd/root.go:156-170`): with `STEPDEBUG=1` the CLI prints version/release date and re-panics (full stack trace to the Go runtime); otherwise it prints `Something unexpected happened.`, the exact `STEPDEBUG=1` re-run command, and an instruction to email `info@smallstep.com`, then exits with **code 2**.
- **`utils.Fail`** (`utils/utils.go:12-24`): legacy helper that prints the error (full form under `STEPDEBUG=1`) and exits 1.
- **Process wrappers** (`exec/exec.go`): `errorAndExit` uses `os.Exit(-1)` (observed as 255 in a shell) when the child cannot start or fails to run; `Run`/`RunWithPid` otherwise exit with the **child's** exit status and forward all signals to the child while it runs (`exec/exec.go:56-69,190-217`).

## Validation patterns

Nearly every action begins with structural validation, all expressed through `errs` constructors:

- **Argument counts**: `errs.NumberOfArguments(ctx, n)` / `errs.MinMaxNumberOfArguments` (e.g., `command/ca/token.go:283`, `command/ca/certificate.go:221`).
- **Flag compatibility matrices** as `switch` statements: `command/ca/token.go:303-316` (`--ssh` vs `--san`, `--cnf-file` vs `--cnf`, ...), `command/ca/renew.go:273-282` (`--expires-in` vs `--renew-period`, `--pid` vs `--pid-file`), `command/ca/init.go:240-279` (root/key pairing, `--kms` vs `--ra`, `--pki` vs `--no-db`/`--helm`, `--admin-subject` requiring `--remote-management`), `command/ca/certificate.go:238-248` (`--offline` vs `--token`, `--attestation-uri` vs `--kms`).
- **Value validation**: `flags.ParseCaURL` (below), `utils.GetKeyDetailsFromCLI` (key type/curve/size), `parseInstanceAge` and friends for durations.
- **Environment sanity**: `step ca init` calls `assertCryptoRand`, which reads 64 bytes from `crypto/rand` and aborts with `crypto/rand is unavailable` if the CSPRNG fails — before any PKI material is generated (`command/ca/init.go:221,814-823`).
- **External command injection surface**: `step ca acme eab list` rejects `PAGER` values containing shell metacharacters (` \t\n;&|<>`) and requires the pager to be resolvable on `PATH` (`command/ca/acme/eab/list.go:102-110`).

## Trust and transport security

- **HTTPS-only CA URLs**: `parseCaURL` prepends `https://` when no scheme is present and rejects any URL whose scheme is not https; bare IPv6 hosts (with optional port) are normalized to bracketed form (`flags/flags.go:671-706`). `ParseCaURL` requires the flag unless `--offline`; `ParseCaURLIfExists` allows empty.
- **Fingerprint-validated root bootstrap**: both `step ca bootstrap` and `step ca root` create the initial client with `ca.WithInsecure()` but then call `client.Root(fingerprint)` — the CA root endpoint validates the downloaded certificate against the operator-supplied SHA-256 fingerprint before it is trusted or written (`utils/cautils/bootstrap.go:104-113`, `command/ca/root.go:83-92`; the code comment: *"Root already validates the certificate"*). `step ca root` makes `--fingerprint` mandatory.
- **Root pinning for normal operations**: online clients are built with `ca.WithRootFile(root)` where `root` defaults to `pki.GetRootCAPath()` and must exist (`utils/cautils/client.go:65-72`); bootstrap/provisioning tokens carry a `sha` claim, and when present `CertificateFlow.GetClient` pins the root by that SHA-256 with `ca.WithRootSHA256(jwt.Payload.SHA)` instead of a root file (`utils/cautils/certificate_flow.go:151-155`).
- **Token parsing is deliberately "insecure" client-side**: `token.ParseInsecure` uses `UnsafeClaimsWithoutVerification` because the *CA* validates the signature; the CLI only needs the payload to route the flow (`token/parse.go:153-166`). One exception enforces consistency locally: for JWK tokens, `step ca certificate` rejects a `--token` whose subject does not match the CSR common name (case-insensitive) (`command/ca/certificate.go:280-287`).
- **mTLS offline mode**: `OfflineCA.Renew`/`Revoke`/`Rekey` recover the presenting client certificate from the TLS transport — `tr.TLSClientConfig.Certificates[0]` — with the comment *"it should not panic as this is always internal code"* (`utils/cautils/offline.go:226-230,296-304,316-320`).

## Delicate-operation gates

- `--subtle` (visible/hidden variants) and `--insecure` (visible/hidden) gate operations the CLI considers delicate or dangerous (`flags/flags.go:72-93`); e.g., `step certificate create --profile self-signed --subtle`.
- `--no-password` writes unencrypted key material and is documented as requiring `--insecure`; `step crypto change-pass` enforces this with `errs.RequiredWithFlag` (`flags/flags.go:119-128`, `command/crypto/change-pass.go:104-106`).
- KDF input: `step crypto kdf hash` refuses a positional (likely-secret) input without `--insecure`, and reads STDIN silently when it is not a TTY (`command/crypto/kdf/kdf.go:100-140`).

## Password and key handling

- `ReadPasswordFromFile` reads the file and **trims right-side whitespace** (so trailing newlines in password files are tolerated); `ReadStringPasswordFromFile` wraps it as a string (`utils/read.go:53-69`).
- `ReadInput` reads from STDIN when it has data or is a pipe, and only falls back to an interactive prompt (`ui.PromptPassword`) when STDIN is empty and not a pipe — making commands scriptable without prompts (`utils/read.go:71-83`).
- All password prompts route through `ui.PromptPassword` because `internal/cmd/root.go` sets both `pemutil.PromptPassword` and `jose.PromptPassword` to it globally.
- `ReadFile` skips a UTF-8 BOM when present (`utils/read.go:85-103`, via `utils/internal/utfbom`).
- Written secrets use 0600 (root certs, keys, signed certificates); see the configuration page for the full permission table.
- The repository makes **no claim beyond the code** about at-rest key storage guarantees; where behavior depends on the OS trust store or KMS, it delegates (truststore, step-kms-plugin) and documents that in the command help.

## Change guide: adding a failure mode

1. Validate early in the action with the matching `errs` constructor; keep the flag/argument names in the message (they render into usage hints).
2. Wrap library errors with `errors.Wrap`/`errors.Wrapf` (pkg/errors) adding a lowercase cause prefix — the `Message()` output already formats the chain under `STEPDEBUG=1`.
3. For new delicate operations, add a `--subtle`/`--insecure` gate in `flags/flags.go` and enforce it with `errs.RequiredFlag`/`errs.RequiredWithFlag`.
4. Do not call `os.Exit` inside command actions — return the error and let `internal/cmd` choose the exit code.
