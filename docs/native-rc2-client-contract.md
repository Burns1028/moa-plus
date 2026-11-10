# DSH 0.2.2 client and child compatibility

This contract carries the existing Worker attachment, promptless residency,
per-Session submission, and sidebar-branch guarantees to the inspected
DSH 0.2.2-rc.1 Desktop artifacts. It was reviewed separately from the port.
The exact native files and hashes belong to `compat/rc2`; the rc.3 profile
remains unchanged. This is an adapter for inspected capabilities, not a claim
that every DSH build with a matching version has identical bytes.

## Owners and preserved behavior

- `dsh-client-ui-conversation` exposes scoped submission overrides through
  the existing controller and permits the existing file intake for a live,
  continuable child. The new native upload-access denial, composer block,
  busy-input, image-limit, and non-continuable checks remain in force.
- `dsh-client-ui-workspace` exposes the original branch chain. Its original
  native Session row receives every new 0.2.2 context-menu, access, drag,
  hover, rename, and navigation prop. The chain wraps that row rather than
  replacing its implementation. Child rows use the same native row tokens.
- `dsh-api-session-controller` forwards child receipt parts through the
  existing subagent prompt route. Ordinary-session admission is unchanged.
- `dsh-client-file-upload` validates a live continuable child and its actual
  owning parent at the existing `store` entrance. The 0.2.2 `store`/`stage`
  split, streamed file/image uploads, disposed-receiver check, and receipt
  map keyed by the exact Session object remain native-owned.
- `dsh-subagent` reuses the existing reconstruction and admission machinery.
  Promptless Host callbacks borrow residency without appending fabricated
  input or starting a task observer. The new native `omitClosingText`
  bookkeeping and queue/claim listeners are retained.

## Same-Session attachment admission

The manager borrows the real child, enters its existing child lock, validates
the live direct parent, continuable descriptor, cancellation, and request ID,
then checks accepted inbox, history, and insertion events before resolving
receipts. This order covers a retry after inbox claim and before user-history
commit, including a receipt that has already retired.

In 0.2.2, `FileUploads.resolve` returns an admitted-part candidate with a
`type` discriminator, not the bare file reference returned by rc.3. The
adapter forwards that complete file or image part into native
`attachments.admitPromptContent`. It never nests that part inside another
file attachment. Missing and foreign receipts remain precise
`subagent/attachment-invalid` errors. Binding, synchronous native admission,
commit, and rollback all use that same receiving Agent and Session.

Borrower counts prevent natural settlement during a Host callback. Callback
release runs in `finally`, wakes the existing settlement watcher, and never
stops actual child work. Explicit disposal, capacity, delegated policy, and
Agent cleanup keep their existing native ownership.

## Verification

The port must parse/import as native modules and validate the real Host and
Client wire schemas. Targeted tests cover the 0.2.2 staged file/image shape,
foreign receipt rejection, receipt retirement retry, input blocking, scoped
submission disposal, and preservation of the original native row controls.
Scripted tests and actual application/model acceptance are reported separately.
