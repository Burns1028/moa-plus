# Compatibility

MoA+ **v0.2.5** supplies audited profiles for **DSH 0.2.1-rc.3** and
**DSH 0.2.2-rc.1 / DSH Next 2.0.22-next**, with **Node 24.9+**.
Every installation needs the matching explicit native extensions from the same
release. These are local compatibility extensions, not claims of upstream
acceptance or support for every DSH version.

The rc.3 profile covers **22 packages / 50 file paths**, including Worker
ordinary-file uploads and attachment-aware query views. The separate rc.2
profile preserves the newer native pipeline and UI; its exact runtime files,
hashes, and upgrade variants are listed in `compat/rc2/manifest.json`.
Read [native compatibility profiles](native-compatibility.md) and the rc.2
[execution](native-rc2-execution-contract.md),
[client](native-rc2-client-contract.md), and
[record ownership](native-rc2-memory-contract.md) contracts for that baseline.

The historical **v0.2.0** tag uses its earlier **19-package / 43-path** rc.3
manifest and does not include Worker ordinary-file uploads or attachment-aware
query views. Do not combine v0.2.5 with that older prepared runtime.

The historical **v0.1.23** tag used three earlier extensions: Agent-local tool suppression, per-session steer submission, and native sidebar branches. It does not include the current Agent/background/residency runtime. Keep a plugin checkout, runtime template/lockfile, and compatibility manifest from the same revision.

## rc.3 native boundary

`compat/rc3/manifest.json` is the authoritative rc.3 file and SHA-256 list. It covers these **21 packages**, with separate npm/Desktop Client variants and explicit upgrades from previously published compatibility bytes:

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

## Desktop Next and Windows scope

The rc.2 profile includes native PowerShell producer ownership, structured
preparation failures, receiving-Session file receipts, and the matching Client
seams. A job-backed foreground PowerShell failure retains its original native
error identity instead of becoming an unclassified error reconstructed from job
text. Package versions alone do not establish that these capabilities exist.

The updated rc.2 profile supports protected Worker commands through native
nonpersistent PowerShell and Bash where available. The existing Windows ACL
owner protects regular, single-link records and their verified owned ancestors;
the native filesystem preserves protection through Coordinator atomic updates.
Every protected execution requires the actual Windows Job range, including
background exit and cleanup. Initial missing records, reparse/multiply-linked
records, unsupported ownership or MIC boundaries, additional writable roots and
full-access policies refuse the restricted call. The backend retains its
`partial` enforcement classification.

Persistent PowerShell/PTY, PTC's persistent Node process and the experimental
worktree/forge command owners do not implement the new protection lifetime and
still refuse protected Windows use. Ordinary Coordinator execution retains its
native behavior. This is a profile-specific native extension; the rc.3 profile
does not implement it and retains the platform requirements above.

When shell execution is optional, an independent Verifier can remove a tool that
reports the native unsupported-protection error for the current review and
continue through available filesystem tools or `read_candidate`. Passing still
requires the rubric, actual inspection, and a valid independent verdict. Genuine
deliverable gaps remain ordinary review findings. A required command, failed
helper, or explicitly reported runtime block does not become a pass: it reports
the failure and joins native cleanup. Stop and incoming human direction keep
priority. This is not a claim that every Windows build or test workflow works.

## Prepare explicitly

For a first trial, use the [isolated Web setup](quickstart.md). It installs locked rc.3 dependencies and applies the matching manifest inside a new owned directory, with backups. It does not change an installed Desktop application.

For this source checkout:

```sh
npm ci
node scripts/apply-native-compat.mjs --dry-run
node scripts/apply-native-compat.mjs --backup /absolute/path/to/native-backup
```

For a separate unpacked matching runtime, add `--modules /absolute/path/to/runtime/node_modules`. Use `--runtime-only` only for a distribution containing runtime JS without matching declaration files.

The helper prefers a matching version profile and can recognize a different version label only when its complete audited runtime bytes and package-export fingerprint match one profile. It refuses unrecognized implementations and mixed patch states, preflights the entire plan before changes, requires an explicit backup, and rolls back failed application. Reapplication of recognized final bytes is idempotent; explicitly audited upgrade variants can advance prior patched bytes. Keep the original backup; a later checkout is not a replacement for the original preimage.

There are no install/prepare lifecycle hooks. The helper does not locate, unpack, sign, restart, or modify an installed app/profile automatically. Preparing Desktop manually requires a full runtime/application backup and its matching audited variant. A DSH upgrade requires fresh compatibility review; never apply rc.3 patches blindly to another version.

## Revert

Stop the affected runtime, restore exactly the files in its original backup, and remove the plugin through the native plugin manager. Keep project/session data if it is still needed. For an isolated Web trial, stopping and retaining its separate directory leaves the ordinary Desktop installation untouched.

Package-consumer, native-contract, launcher, and real-model/UI checks are distinct. See [verification](verification.md) for the evidence associated with a version or branch.
