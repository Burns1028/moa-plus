# Native Worker record ownership

This separately reviewed compatibility contract closes the whitepaper's notes/archive ownership boundary. It extends the pinned rc.3 native permission chain; it does not introduce another filesystem, shell, scheduler or model tool. Exact files and before/after hashes are in `compat/rc3/manifest.json`.

## Ownership and scope

The Coordinator maintains the actual paths in `project.paths.notes` and `project.paths.archived`. Shared, isolated and nested Workers may read those records but cannot change them through the native filesystem or Bash providers. Other output files, a Worker's unrelated private `notes.md`, and shared Context retain the caller's normal permissions. Paths come from the project record, rather than filename or command matching.

This composes the existing trusted filesystem checks and OS process sandbox. It retains their canonicalization and filesystem-race assumptions. It is not a claim of isolation from hostile host processes, outside inherited file descriptors or filesystem/kernel attacks.

## Native policy

`SandboxExecutionPolicy` gains optional `readOnlyPaths: readonly string[]`. The existing policy service owns a Host-only scoped contribution:

```ts
restrictReadOnly(sessionId: SessionId, paths: readonly string[]): () => void;
```

`resolve` unions that Session's live contributions into each execution policy. Paths must be absolute execution-world paths. An idempotent disposer removes only its own contribution; it cannot remove a replacement binding. Session mode changes and approved one-shot full-access escalation preserve the readonly paths. There is no new persistent event: the plugin already stores the project paths and restores the contribution when the native Worker is hydrated.

Native filesystem, shell and sandbox providers advertise typed support for this policy. The plugin checks the services selected for the actual Agent preset. A bare local provider, or a custom provider that has not implemented the contract, cannot silently claim protection. Bash also checks the selected process sandbox before spawning restricted work.

## Filesystem operations

The sandboxed filesystem resolves the operation target and restricted paths immediately before its existing write/edit operation. It denies matching canonical paths, descendants of restricted paths, and ancestor replacement. Existing alias/case containment rules remain in use. An absent record path remains protected against creation. Reads and unrelated writes retain native behavior.

This check precedes the full-access bypass. Ownership denials use `FS_READ_ONLY_PATH`, distinct from a mode denial, so the tool does not recommend a permission escalation that could supposedly remove ownership. Native conditional-write and edit guards are unchanged.

## Bash operations

Full-access Bash bypasses confinement only when no readonly paths are present. Otherwise the same native shell invocation goes through the existing sandbox, with its original subprocess handle, output, background ownership, cancellation and resource-exit tracking. Commands are not parsed or rewritten.

The process provider canonicalizes record paths before launch. Existing records must be regular files with one hard link. Unsupported file states fail before spawning, using `READ_ONLY_PATH_UNSUPPORTED`; the error identifies the missing backend or record condition and cannot be bypassed by escalation.

| Backend | Restricted execution |
| --- | --- |
| macOS Seatbelt | Preserve normal mode grants, then deny file writes to the canonical records and unlink/rename of their ancestor directory entries. Sibling files remain writable. Missing record paths can be protected. |
| Linux bubblewrap | Preserve native workspace/temp mounts; protect ancestor entries with bind mountpoints and each existing record with a readonly bind. Full-access keeps its wider grant except for these records. Missing records must first be recreated by the Coordinator. |
| Linux Landlock | Reject the restriction dialect: the current additive writable hierarchy grants cannot subtract these records. Do not fall back from an unavailable bwrap to a weaker policy. |
| Windows ACL / custom runner | Reject restricted Bash until a reviewed implementation exists. Unrestricted calls keep their existing backend behavior. |

Symlink aliases used to reach an ordinary protected regular file remain subject to the restriction. A record entry that is itself a symlink, or a record with an existing hardlink, is refused for restricted Bash rather than treated as protected. No filesystem-wide alias scan is added.

The bubblewrap policy must not turn the native ephemeral temp mount into an unintended host-temp write grant. Ancestor mounts retain the mode's existing rights; files are mounted last, without a missing-source `--ro-bind-try` fallback. See the [bubblewrap options](https://github.com/containers/bubblewrap/blob/main/bwrap.xml) and [Landlock rule-layer semantics](https://docs.kernel.org/userspace-api/landlock.html#layers-of-file-path-access-rights).

## Binding and teardown

`bindWorkerMemoryPolicy` installs the two real paths before the Worker's first execution. Unchanged service/path bindings are reused. On replacement, the new contribution is present before the old one is disposed. Cold hydration and nested Workers use the same owning project records. Coordinator and ordinary Sessions receive no contribution.

The Host keeps memory-policy bindings separate from tool registrations. Removing tools does not release the policy of still-running work. Actual Agent disposal and plugin teardown release contributions only after existing native background/child cleanup has joined. Already-resolved execution policies retain their immutable path snapshot.

The hidden Outcome Verifier has execution tools and receives the same record restriction for its native handle lifetime. Its disposal joins before releasing that contribution. The Rubric Builder cannot execute filesystem or shell tools.

## Evidence and compatibility

`tests/native-contract/moa-memory-readonly.spec.ts` uses stock rc.3 file and Bash tools with the native providers. It checks scoped policy/disposal and escalation, actual writes/edits and aliases, Bash replacement/deletion/ancestor moves, healthy sibling operations, and unsupported backend/state refusal before side effects. macOS/Linux run the actual OS backend cases in the existing CI matrix; argv snapshots alone are insufficient.

`tests/host/moa-memory-readonly.spec.ts` covers the project binding, shared/isolated records, Context writes, native restoration and joined cleanup. Compatibility tests retain preflight, exact hashes, backups, rollback and idempotence. Package-consumer and real-model/UI evidence are recorded separately in [verification](verification.md).
