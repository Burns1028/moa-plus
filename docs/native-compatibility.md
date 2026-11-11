# Native compatibility profiles

MoA+ uses the native DSH Agent Loop, tool executor, Sessions, projection, jobs,
permissions and Client slots. Installing a package and providing its required
native capabilities are separate operations. A permissive package version range
alone cannot provide missing native behavior.

The tested dependency baselines are DSH 0.2.1-rc.3 and 0.2.2-rc.1. The latter
is used by DSH Next 2.0.22-next. Compatibility profiles live under `compat/`.
`scripts/apply-native-compat.mjs` prefers a matching version profile, then checks
every affected file before making changes. A different version label can reuse
one complete audited profile when all its runtime bytes and package export
contracts match. Packages from different profiles cannot be combined to pass.

Each such entry has a `runtimeFingerprint`: a digest of `type`, `main`, `exports`,
`imports` and `dsh` metadata, preserving conditional-export ordering, plus any
additional runtime anchors. A package with declaration-only changes must have
an actual JavaScript anchor. Anchors are checked without changing or backing up
those files. The older rc.3 Desktop variant has not been fingerprinted here and
retains its existing version-bound support. npm and Desktop artifacts can differ.

Plugin peers accept the candidate ranges `^0.2.1-rc.3 || ^0.2.2-rc.1`; development
dependencies and the isolated Web runtime remain locked to their tested baseline.
The peer ranges permit installation candidates, not a claim that every candidate
already supplies the required native APIs. Runtime activation checks capabilities
and reports missing interfaces. A native runtime supplying the contracts directly
does not need a patch merely because its version label is new.

The legacy rc.3 profile is retained. The rc.2 profile preserves the newer native
pipeline, ToolSet admission, file-upload receipts and UI controls, extending the
owners of the missing capabilities. Its reviewed boundaries are described in:

- [Execution and cancellation](native-rc2-execution-contract.md)
- [Client, Worker residency and attachments](native-rc2-client-contract.md)
- [Record ownership](native-rc2-memory-contract.md)

PTC uses the existing native pipeline. `nativeOnly` tools appear as direct model
schemas, have no SDK or runtime program binding, and are rejected as nested
calls. Ordinary tools remain SDK-only under PTC. Rejection receives the resolved
definition from the same native scope/ToolSet as execution, preserving per-Agent
visibility. This preserves SendMessage Request/Reply lifetime without a separate
executor or message loop.

## Preparation and verification

Use Node 24.9+ and Git. Stop the affected runtime and retain a full application
backup before modifying an installed Desktop distribution. On an extracted
runtime, run:

```sh
node scripts/apply-native-compat.mjs --modules /runtime/node_modules --runtime-only --dry-run
node scripts/apply-native-compat.mjs --modules /runtime/node_modules --runtime-only --backup /backup/native
```

Omit `--runtime-only` when matching declarations are installed. The helper checks
the entire plan before writing, saves the original files, verifies resulting
SHA-256 hashes, restores saved files after a failure, and accepts reapplication
of recognized final bytes. Windows CRLF patch checkouts are normalized to LF;
Git's user-level newline conversion cannot change the audited runtime bytes.

For prepared rc.2 runtime regressions, set `MOA_COMPAT_MODULES` to that runtime's
`node_modules`, then run `node --test tests/compat/*.test.mjs`. These tests do not
use personal profiles or credentials. A Desktop startup and real-model task are
separate acceptance checks; passing imports or scripted tests does not establish
that every model workflow has been exercised.

## Platform and version limits

Shared capabilities should be detected through native APIs. Missing required
capabilities must be reported by name; unrelated optional capabilities should not
be inferred from a package version. A future native release that incorporates
these contracts can remove its corresponding patch rather than carry an older
implementation forward. An unrecognized implementation is never changed with
an older diff. Broad compatibility requires shared API and lifecycle contracts;
matching a version string or a method name alone does not establish those facts.

Worker shell record protection currently requires macOS Seatbelt or Linux
bubblewrap. Windows ACL cannot express the same path restriction while the
Coordinator atomically replaces its records; restricted Bash and PowerShell are
therefore refused before spawning. Filesystem tools retain scoped protection,
and Coordinator/ordinary execution keeps its native behavior. Installing on
Windows does not imply that restricted Worker shell execution is available.

The current two families are tested targets, not a claim about every historical
or future DSH release. Broader support requires compatible public APIs or a new
reviewed profile and corresponding runtime tests.
