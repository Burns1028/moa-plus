# DSH 0.2.2 Worker record ownership

This compatibility profile carries the existing Worker record-ownership
contract onto the Desktop `0.2.2-rc.1` runtime. It uses the native policy,
filesystem, shell and process-sandbox services. It does not introduce another
executor. The baseline retains the Coordinator's standing permission mode; the
Windows implementation below adds an explicit temporary guard against destructive
record removal while native process protection is active, while retaining
ordinary existing-record atomic updates.

## Native boundary

- `dsh-sandbox-policy` retains Host-owned, scoped `restrictReadOnly` contributions
  per Session. Resolving or escalating a mode never removes these paths.
- `dsh-fs-sandbox` checks the canonical source and destination of every native
  mutation, including the new patch, delete and move operations, before its
  full-access bypass. Restricted records and their ancestor replacements fail
  with `FS_READ_ONLY_PATH`; ordinary files and Coordinator calls retain their
  original behavior.
- `dsh-sandbox` exposes `ReadOnlyPathUnsupportedError` as the existing contract's
  structured refusal. `dsh-fs` adds `FS_READ_ONLY_PATH` to the rc.2 runtime
  error-code vocabulary used by native wire validators.
- `dsh-bash-sandbox` and the new `dsh-pwsh-sandbox` retain confinement for a
  full-access call carrying read-only paths and check the selected process
  provider's capability before spawning.
- `dsh-sandbox-local` applies the existing Seatbelt/bubblewrap record policy.
  The rc.2 additional-writable-root grants must survive this policy. A custom
  runner or Landlock without an exact path restriction dialect refuses the
  restricted call before spawning. Windows uses the narrower existing-record
  contract below.

All modified distribution files and their before/after SHA-256 values are
listed in the rc.2 compatibility manifest. Existing rc.3 artifacts are retained.

## Windows boundary

The unextended rc.2 backend refuses restricted Windows shell calls with
`READ_ONLY_PATH_UNSUPPORTED`. The additional native owners below support existing
records without changing the backend's `partial` enforcement classification.
The versioned patches, exact hashes and platform evidence remain the supported
distribution boundary; this contract alone does not certify an arbitrary build.

The earlier assumption that native atomic replacement necessarily loses the
record DACL was incorrect. The inspected `dsh-fs-local` already copies the target
DACL to its staging file with protected inheritance, then publishes an existing
target with `ReplaceFileW` and flags `0`, preserving the target DACL. It does not
ignore ACL merge errors; see the [Windows API contract](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).
This makes existing-record native replacement a usable owner boundary. The
unextended staging implementation creates the object before copying its DACL;
Windows `0700`/`0600` arguments are not an initial DACL. The additional filesystem
owner closes that creation window and refuses missing-record/recreation gaps.

### Existing-record protection contract

- Reuse the native per-Session/workspace **temp write SID** already carried in
  that restricted process token. Do not deny the shared workspace SID, change
  the ambient user's token, introduce another SID naming protocol, or start an
  alternate executor. Three Workers sharing a workspace therefore have three
  independent protection contributions to the same notes/archive.
- Before spawning, canonicalize both records and their relevant ancestors.
  Require existing regular, single-link records and reject reparse/alias states
  whose identity cannot be protected. Initial missing records refuse the call,
  as the existing bubblewrap contract does. Install no broader filesystem grants
  to make the call pass.
- Deny the process's existing temp SID record data/append/attribute writes,
  deletion, `WRITE_DAC`, and `WRITE_OWNER`. Deny ancestor replacement and the
  parent `FILE_DELETE_CHILD` shortcut for that SID, and deny descriptor/owner
  changes on those ancestors. Apply only the required
  non-inheriting protections; ordinary writable sibling artifacts must still
  support creation, editing, renaming and deletion. Ancestors outside an owned
  writable root must be proven inaccessible for these mutations or the call
  must refuse; preparing a Worker must not edit system-directory ACLs.
- A source record can be outside an isolated Worker's writable worktree. It
  still receives the same filesystem-owned record lease. Protect its normal,
  Host-owned Low-integrity ancestors up to the first reliable
  Medium-or-higher `NO_WRITE_UP` boundary; do not edit the boundary's ACL.
  Every outer ancestor through the volume root must also be a normal,
  non-reparse Medium-or-higher `NO_WRITE_UP` directory, otherwise refuse.
  An absent mandatory label has Windows' documented Medium/default-no-write-up
  meaning. This prevents a writable outer parent from bypassing the boundary
  with `FILE_DELETE_CHILD`. See [Microsoft's MIC contract](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control).
  The native ACL owner counts active boundaries and refuses a `grantWrite`
  operation that would lower that boundary or any containing ancestor until
  the last lease releases. Ordinary child/sibling workspace grants remain
  available. Missing ownership, label or alias evidence refuses admission.
- Same-user ownership is part of the threat model. A record and every protected
  ancestor must not let owner-implicit `WRITE_DAC` bypass the SID deny. Use a
  non-inheriting [`OWNER_RIGHTS` (`S-1-3-4`)](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-special-identities-groups#owner-rights)
  **Allow `READ_CONTROL`** entry where
  needed to suppress implicit owner grants, retaining the Host's explicit user
  management rights. Do not add an `OWNER_RIGHTS` deny. Actual restricted-token
  opens and ACL/ownership attacks, with a Host positive control, must establish
  the result; an ACE dump alone is insufficient.
- Acquire/release ACL contributions through the actual native filesystem
  provider's mutation critical section. `dsh-fs-sandbox` inherits the local
  provider, so it must retain that capability. Native `writeText`, `editText`,
  `patchText`, delete and move operations participate; tool `fs/*-intent` or
  `fs/observed` listeners do not cover Host writes and are not the lease owner.
  Different provider instances must not silently claim coordinated protection.
  Admission and cleanup take the existing sorted native locks for both records
  and their ancestor keys, so an already-started ancestor mutation cannot cross
  the ACL installation/removal boundary. Ordinary file writes retain their
  existing target locks.
- Windows staging for a protected record receives its restrictive security
  descriptor **at creation**, before any other process can obtain a write
  handle. Preserve all active contributions before writing content and through
  `ReplaceFileW(flags=0)`. A protected target disappearing during publication
  must not fall back to an unprotected rename. Partial replacement failures
  need a checked fail-closed/rollback result, not an assumed successful record.
- While a native process protection lease is active, native delete, move-out
  or ancestor replacement that would leave a protected pathname absent refuses
  rather than opening a recreation gap. Existing-record atomic updates remain
  available to the Coordinator. This is an explicit temporary mutation guard,
  not a tool-duration lock or another scheduler. Arbitrary external/raw-shell
  record replacement is outside this narrow native-write contract.
- Contributions are independently counted and merged. Releasing one process
  removes only its own entries after actual process/resource exit, retaining
  overlapping Workers and concurrent Host DACL changes. The last release also
  removes only the ownership entries installed by this mechanism. Spawn,
  preparation and partial-ACL-install failures unwind their own contributions;
  cleanup failures remain visible and cannot certify a stopped resource.

The explicit filesystem capability is
`acquireProcessPathProtection(paths, installer, signal?)`. It supplies canonical
record paths and the actual filesystem provider's stable owner token to the
native ACL installer, then returns idempotent asynchronous `cleanup()`. The
installer and cleanup run under those same native mutation locks. The ACL owner
retains only its exact non-inherited entries and per-SID reference counts;
another filesystem owner cannot silently adopt an active record. Admission does
not revoke write handles previously opened by unrelated processes, and raw
external record replacement remains outside the native publication contract.

The filesystem/ACL integration must use an explicit native service capability.
`dsh-sandbox-local` must declare its filesystem service access and check the
actual provider capability. No undeclared import, process-global Symbol registry,
late plugin observer or test-only `internals` hook may coordinate production
protection. Any added package dependency and runtime/declaration change belongs
in the versioned manifest and package metadata. `node-addon-system` provides
Linux Landlock and POSIX flock here; it supplies no Windows exclusion primitive.

### Required Windows evidence

Use only newly owned temporary workspaces and real native Windows children.
Exercise three shared Workers protecting the same notes/archive while the Host
repeatedly performs native writes/edits/patches. Each Worker can read records and
mutate ordinary sibling artifacts, but cannot write, append, delete, rename,
replace, change DACL/owner, or replace an ancestor of the protected records.
Verify `OWNER_RIGHTS` with the same user owning Host and Worker resources, and
verify the Host can still update records and manage their descriptors.

Attempt a staging write-handle acquisition at the first-visible creation
boundary; test missing/reparse/multiply-linked records and destructive mutation
refusals. Cover concurrent protection install versus native atomic publication,
independent Session behavior, overlapping cleanup, spawn failure, cancellation
and delayed real resource exit. Verify the final descriptor retains pre-existing
and concurrent unrelated entries. Mock ACL results are not acceptance evidence.
Also run two overlapping commands from the same Session/workspace and therefore
the same temp SID: ending the first must not revoke the second's protection.
Task/Fork and the user's actual information-gathering workflow require separate
native/application acceptance; these tests do not turn Windows's existing
`partial` sandbox classification into `full` enforcement.
