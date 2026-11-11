# Compatibility

For the current development branch's rc.3 and DSH 0.2.2-rc.1 / Desktop Next
profiles, read [native compatibility profiles](native-compatibility.md).
The historical rc.3 contract and published release instructions follow below.

Target: **DSH 0.2.1-rc.3, Node 24.9+**. Every checkout requires its matching explicit native extensions. Stock rc.3 is incompatible. These are local compatibility extensions, not claims of upstream acceptance.

This checkout adds Worker file attachments with **21 packages / 49 file paths**. The published **v0.2.0** tag uses its earlier **19-package / 43-path** manifest and does not include Worker ordinary-file uploads or attachment-aware query views. Do not combine the new plugin with that older prepared runtime.

The published **v0.1.23** tag used three earlier extensions: Agent-local tool suppression, per-session steer submission, and native sidebar branches. It does not include the new Agent/background/residency runtime. Keep a plugin checkout, runtime template/lockfile, and compatibility manifest from the same revision. Use the v0.2.0 tag and its matching manifest for this release.

## Current native boundary

`compat/rc3/manifest.json` is the authoritative file and SHA-256 list. The current manifest covers these **21 packages**, with separate npm/Desktop Client variants and explicit upgrades from the previously published compatibility bytes:

| Native package | Required extension |
| --- | --- |
| `dsh-client-ui-conversation` | Per-session native submission choice, plus native file picker/intake for continuable Workers. |
| `dsh-api-session-controller` | Forward staged-file receipts through native child Session.prompt. |
| `dsh-client-file-upload` | Retain exact receiving-Session receipt ownership for live continuable Workers. |
| `dsh-client-ui-workspace` | Native `sidebar.workspaces.session.branch` rendering through original parent/child row callbacks. |
| `dsh-tools` | Reversible Agent-local suppression, transferable tool execution, background metadata/results, and direct protocol tools alongside PTC. |
| `dsh-agent` | Typed activity/background events, joined cancellation, and derived native ownership/cleanup facts. |
| `dsh-agent-loop` | Native tool transfer, same-turn timer continuation versus message handoff, canonical result finalization, and cancellation exit barrier. |
| `dsh-session` | Typed background handoff/receipt event contracts. |
| `dsh-jobs` | Native producer/controller types and completion-notice ownership. |
| `dsh-jobs-local` | Adopt/query/cancel the actual owned native producer with its final result and exit state. |
| `dsh-tool-jobs` | Preserve the owning controller's result-reporting responsibility rather than emit a duplicate generic notice. |
| `dsh-tool-bash` | Expose actual foreground/promoted Bash execution for native adoption. |
| `dsh-shell` | Managed shell resource termination/exit contract. |
| `dsh-bash-local` | Actual subprocess-backed managed termination and exit observation. |
| `dsh-subagent` | Promptless borrowing of the true cold parent chain; authorized, deduplicated child file admission with native receipt binding and retirement. |
| `dsh-sandbox` | Typed per-execution readonly paths, preserved independently of the permission mode. |
| `dsh-sandbox-policy` | Scoped session readonly contributions, including approved mode escalation. |
| `dsh-fs` | Typed ownership capability and non-escalatable readonly-path error. |
| `dsh-fs-sandbox` | Canonical record-path checks before full-access delegation. |
| `dsh-bash-sandbox` | Retain native confinement when full-access execution has readonly paths. |
| `dsh-sandbox-local` | Seatbelt and bwrap record restrictions; explicit refusal of unsupported restriction dialects. |

All names in this table have the `@deepseek-ai/` prefix. Some changes are declarations only; runtime-only distributions therefore apply fewer file edits than development installations.

Read the [background/cancellation contract](native-moa-contract.md), [promptless residency contract](native-moa-residency-contract.md), [Worker attachment contract](native-worker-attachments-contract.md), [protocol presentation contract](native-moa-protocol-presentation-contract.md), and [record ownership contract](native-memory-ownership-contract.md) before altering these seams. Existing batch-local ordering remains native-owned. There is no universal cross-turn tool lease, alternate scheduler, or bypass for model control calls.

Workers need the matching native sandboxed filesystem and Bash providers to protect the Coordinator's notes/archive. Restricted Bash uses macOS Seatbelt or Linux bubblewrap; Linux installations must have a working `bwrap` backend. Landlock-only, Windows ACL and custom-runner restriction dialects currently refuse restricted Bash rather than discard the record policy. Hardlinked or symlinked record entries also refuse that call; on bwrap, the Coordinator must recreate a missing record before restricted Bash runs. Other files and Coordinator/ordinary sessions keep their native permissions. These requirements apply to Worker record ownership even in full-access mode.

## Prepare explicitly

For a first trial, use the [isolated Web setup](quickstart.md). It installs locked dependencies and applies this manifest inside a new owned directory, with backups. It does not change an installed Desktop application.

For this source checkout:

```sh
npm ci
node scripts/apply-native-compat.mjs --dry-run
node scripts/apply-native-compat.mjs --backup /absolute/path/to/native-backup
```

For a separate unpacked matching runtime, add `--modules /absolute/path/to/runtime/node_modules`. Use `--runtime-only` only for a distribution containing runtime JS without matching declaration files.

The helper refuses unknown versions, unknown bytes, and mixed patch states. It preflights the entire plan before changes, requires an explicit backup, and rolls back failed application. Reapplication of recognized final bytes is idempotent. Keep the original backup; a later checkout is not a replacement for the original preimage.

There are no install/prepare lifecycle hooks. The helper does not locate, unpack, sign, restart, or modify an installed app/profile automatically. Preparing Desktop manually requires a full runtime/application backup and its matching audited variant. A DSH upgrade requires fresh compatibility review; never apply rc.3 patches blindly to another version.

## Revert

Stop the affected runtime, restore exactly the files in its original backup, and remove the plugin through the native plugin manager. Keep project/session data if it is still needed. For an isolated Web trial, stopping and retaining its separate directory leaves the ordinary Desktop installation untouched.

Package-consumer, native-contract, launcher, and real-model/UI checks are distinct. See [verification](verification.md) for the evidence associated with a version or branch.
