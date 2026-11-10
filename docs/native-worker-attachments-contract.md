# Native Worker attachments

This extends the pinned DSH 0.2.1-rc.3 compatibility contract for browser uploads to continuable Workers. It does not add an upload service, scheduler, permission mode, or message queue.

## Required behavior

A user can select, paste, or drop ordinary files in a visible continuable Worker, send them alone or with text, and continue using native steer/queue delivery. Images keep their existing behavior. Native history and restart retain the accepted file reference. Coordinator queries return attachment references as well as the original dialogue text, so the Coordinator can inspect the uploaded material using its native tools.

Root conversations keep their current path. Non-continuable child views, removed sessions, disabled composers, upload failures, and native filesystem permissions keep their existing restrictions. Task does not implicitly copy parent attachments; Fork retains its existing history inheritance.

## Receiving Session and upload ownership

The existing `followWorkerParent` subscription already borrows the addressed child and its actual parent chain through `withManagedAgent`. The Client must use it for every visible active Worker, including direct children; currently it is used only for nested children. Its callback-scoped native residency keeps the upload's receiving Agent and exact Session alive while the Worker view is open. Closing the view releases that borrow without stopping real work.

The native file-upload service accepts a live continuable child in addition to an ordinary Agent. It retains its existing streamed storage, exact-Session receipt map, cancellation, disposed-receiver checks, and prompt-binding lifecycle. It must reject a child that is not continuable. No global Session-ID receipt map or alternate cold resolver is introduced. A raw request addressing a cold Worker without the managed view is not a new supported entry point; reopening the Worker first uses the existing residency seam.

## Native prompt admission

The existing subagent prompt protocol accepts staged-file receipt parts alongside text and encoded images. The browser Session controller forwards those parts instead of rejecting every child file. The Host subagent prompt path resolves receipts against the actual receiving child's Session, admits the resulting native file blocks through the existing attachment service, and binds the receipt IDs to the native request identity.

Inside the existing per-child admission critical section, first obtain and validate the exact activation, actual parent, continuable descriptor, cancellation, and nonempty request identity. Look for that `rpcId` in the child's next-step/next-turn inbox, committed human messages, and non-inherited native inbox-insertion events. The last source covers the real interval after inbox claim but before history commit. An accepted retry returns the original message ID before resolving receipts that may already have retired. Only then resolve receipts, admit content, bind, submit, and commit against that same receiving Session. Do not resolve outside the admission boundary and subsequently deliver into a possibly reconstructed child. The lock ends after admission, not after the Worker's model task.

A missing or foreign receipt returns `subagent/attachment-invalid` with reason `FILE_NOT_STAGED`; it must not be hidden as `gateway/internal` or become a user-supplied filesystem path. Failed admission rolls back the binding. Successful admission commits it; native inbox/history observation retires accepted receipts. The accepted user message retains its native `rpcId`, so request deduplication and retirement use the same identity.

No files are read or written under invented permissions. The Worker still inherits its native delegated policy, and the plugin's notes/archive readonly policy remains installed. Querying attachment metadata does not grant new filesystem access.

## Query and work-axis projection

Add optional attachment arrays to the existing dialogue, recent-input, and timeline views. Each entry contains the original native file/image reference and its native process path when available. Keep text verbatim; do not replace it with a synthesized description. Do not return image bytes, base64, reasoning, or tool messages. Pure-attachment human/AI messages remain visible within the same newest-relative offset/limit window.

Activity reflects attachments on pending and committed human inputs. The existing work-axis preview can show compact attachment names and use its existing resource-open action; no new page or independent history is added. Deleted Worker visibility and capsule ownership do not change.

## Native scope and evidence

Extend only the explicit compatibility manifest: the conversation UI, API Session controller Client, subagent protocol/Host adapter, and file-upload service, plus the real declarations affected by these changes. Native UI File/Blob uploads use its existing authenticated HTTP stream route; no broader Agent lookup for unrelated Agent-scoped Remote fallback methods is added. Published npm and bundled Desktop variants must both have exact before/after hashes, reversible patches, and explicit backups. Previously released compatibility bytes must have an explicit upgrade path rather than being treated as stock rc.3.

Required regressions cover receiving-Session ownership, foreign/missing receipts, acceptance retry deduplication, failed-admission rollback, native receipt retirement, live/cold Worker view retention and release, ordinary/non-continuable UI preservation, native file intake, and file/image query windows without binary payloads.

Real application acceptance uses an isolated matching DSH runtime and real model: upload a file through a Worker's native picker, have that Worker read its unique contents, inspect its attachment through Coordinator QueryAgent and native read, confirm full result return and natural turn closure, then restart/reopen and repeat the query. Also smoke-test an ordinary root upload and Worker image input. Scripted tests and real UI evidence are reported separately.

## Implementation order

1. Review this contract independently before native production changes.
2. Add red regressions for native file admission, UI intake/residency, and query projections.
3. Extend the existing native seams and plugin projections; regenerate exact compatibility patches and browser/protocol artifacts.
4. Run build, types, native/Host/Client regressions, launcher checks, and package consumers.
5. Run the real UI/model/restart acceptance above, review the final diff independently, then submit a PR. Do not merge or publish a new release as part of this task.
