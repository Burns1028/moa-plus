# DSH 0.2.2 Worker record ownership

This compatibility profile carries the existing Worker record-ownership
contract onto the Desktop `0.2.2-rc.1` runtime. It uses the native policy,
filesystem, shell and process-sandbox services. It does not introduce another
executor or change the Coordinator's file policy.

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
  runner, Landlock or Windows ACL runner without an exact path restriction
  dialect refuses the restricted call before spawning.

All modified distribution files and their before/after SHA-256 values are
listed in the rc.2 compatibility manifest. Existing rc.3 artifacts are retained.

## Windows boundary

The currently bundled Windows ACL backend grants capabilities to filesystem
objects. It cannot yet express a persistent path exclusion while another
Agent replaces the record atomically. Adding a deny ACE to the old record
does not protect the replacement; inheriting that deny from the directory
would also deny legitimate sibling output. A shared workspace SID deny would
affect unrelated Sessions. Holding a non-writable record handle would block
the Coordinator's updates.

Consequently, the base rc.2 profile retains the explicit
`READ_ONLY_PATH_UNSUPPORTED` refusal for restricted Windows shell calls. This
is a known execution limitation, not proof of Windows full collaboration
support. Filesystem record protection remains available. A future Windows
implementation must separately prove path continuity across atomic replacement,
ancestor rename/delete protection, concurrent Coordinator writes, unrelated
execution independence, and cleanup after the actual child has exited.
