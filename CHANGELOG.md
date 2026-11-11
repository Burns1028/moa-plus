# Changelog

## 0.2.6 — 2026-11-12

- Simplify the Workers panel to a chronological timeline with input, output and artifacts for every turn. Keep all inputs together and remove the separate communication log and folded task cards.
- Keep the Coordinator's opening task visible as input in the native Worker conversation. Fold later internal correspondence with the process after completion while retaining its original native placement.
- Preserve text expansion, attachments, native artifact opening and timeline subscription ownership.
- Disable automatic completion verification by default. Builder/Verifier helpers run only when `completionVerification` is explicitly enabled; the opt-in verification flow remains available.

## 0.2.5 — 2026-11-11

- Group the Workers panel into compact task cards, with the latest open and earlier turns folded by default. Show two-line task and four-line final-result previews, expandable original Markdown, and attachment/artifact file chips.
- Fold communication records behind a message count, keeping every input, sender/time details, and original messages accessible. Keep Markdown links and copy controls outside disclosure summaries.
- Hide only exactly verified MoA-authored transport and initial identity prefixes in presentation text, while preserving raw dialogue, attachments, and native execution. The panel remains read-only and makes no model summary calls.

## 0.2.4 — 2026-11-11

- Fold internal Agent communication into the native work process after completion, keeping the final answer visible. Preserve live progress, human interleaving, failed/stopped turns and capsule ownership.
- Replace large user-style Agent bubbles with compact sender/type cards and answer previews. Keep Markdown outside the disclosure control and reasoning in a separate disclosure, preserving the complete original content.

## 0.2.3 — 2026-11-11

- Restore isolated Task/Fork preparation on Windows by accepting the audited native provider's partial enforcement while preserving Session policy and owned-resource checks.
- Support protected Worker commands through the rc.2 native nonpersistent PowerShell/Bash executors. Preserve record protection during Coordinator atomic updates, overlapping Session contributions and isolated-worktree access; keep Windows enforcement classified as partial.
- Retain protection until native Windows Job exit, including late preparation, background execution and provider teardown. Refuse weaker containment and unsupported process owners before target admission; preserve cleanup failures.
- Use native subprocess ownership for workspace commands, explicitly unset ambient Git routing, and audit runtime package metadata alongside code. Ship matching original/previous-release upgrade patches and service declarations.
- Keep user-facing collaboration mode names in Chinese. Windows persistent terminals, PTC and other unadapted protected process owners remain explicit limitations.

## 0.2.2 — 2026-11-11

- Use Chinese orchestration mode names throughout the README and current guides, including 自适应协调. This release changes documentation and version metadata only; runtime bytes remain unchanged from v0.2.1.

## 0.2.1 — 2026-11-11

- Add an audited DSH 0.2.2-rc.1 / DSH Next 2.0.22-next compatibility profile while retaining the rc.3 profile with 21 packages / 49 file paths. Select profiles by reviewed runtime bytes and package contracts, preserve original backups, and support explicit upgrades from prior patched bytes.
- Fix Desktop Next completion-helper startup by selecting the scoped native tool executor through the available native API. Honor the parent's selected model and effort, and select the Builder's lightest supported effort through the native model-selection boundary.
- Keep the Coordinator and completion helpers aligned on active task requirements and native context, including complete preset prompts and later human clarifications, while retaining unfinished requirements.
- Write lossless versioned projection checkpoints and replay older cached shapes instead of failing native Session cache persistence at the start of a turn.
- Preserve original native PowerShell preparation failures through the default job-backed foreground path, including structured error identity and settled-job cleanup. Native cancellation, permissions, and producer ownership remain intact.
- Stop failed completion helpers without directing the Coordinator into infrastructure self-repair. When commands are optional, remove an unavailable shell for that review and continue with actual native file or candidate inspection; required execution and confirmed runtime blocks remain explicit failures. Ordinary Partial/Block findings, Stop, incoming human direction, and real evidence requirements retain their behavior. Windows protected Worker shell execution remains limited by the backend.
- Treat a brief acknowledgement or ordinary chat clarification as a complete deliverable when no actionable goal or unfinished concrete requirement exists. Keep tools, memory work, and structured questions relevant to an actual task.
- Use platform-independent isolated-workspace cleanup through the existing native sandbox, preserving permission refusals and cleanup-failure recovery.
- Avoid retaining disposed Agent contexts through completion generation and rubric-write bookkeeping; keep native write ordering and unload invalidation.
- Add Adaptive Coordinator guidance for retained Worker reuse, useful-history forks, clean-context tasks, ready parallel branches, and native interruptible waits, while preserving direct handling of simple work.
- Bundle five optional orchestration prompts with Chinese display names: 并行攻坚, 多方会审, 协同探索, 迭代精修, and 统筹推进. Enabled MoA Coordinators can expand them through native `@` candidate selection by click, Enter, or Tab; native Send, file references, uploads, queue, and steer retain their behavior. These are prompt texts over the existing tools and roles.
- Let continuable Workers upload ordinary files through the native composer, streamed storage, receiving-Session receipts, and child admission. Retain native permissions, cancellation, and exact-request retry behavior.
- Preserve file/image references and readable paths in Coordinator queries, recent human inputs, and Worker timeline previews, including attachment-only messages.
- Replace the draft MoA+ checkbox with a compact cover-style wordmark button. The off state is gray; the on state is electric lime in the dark theme and a darker green in the light theme. Started conversations retain a fixed mode identity.

## 0.2.0 — 2026-11-10

- Release validation passed 345 tests across 59 files, Host/Client typechecks, the production build, and all 19 launcher checks with zero skips. Earlier revision-specific evidence remains identified below.

### Review corrections

- Accept a Verifier's plain JSON verdict or one fenced JSON verdict with surrounding explanation. Malformed or ambiguous output reports a JSON-format problem; native inspection and required-test evidence remain mandatory.
- Organize role, review, identity and interrupt-judge prompts under `host/prompts/`, centralize collaboration tool definitions, and move shared Context I/O to the memory module without changing prompt output or native execution contracts.
- Match accepted messages by their native source identity during recovery; unrelated message text can no longer hide a prior admission and cause duplicate insertion.
- Use the model's lowest supported reasoning effort for rubric extraction, without changing the Coordinator or evidence-gathering Verifier's selected effort.
- Clarify workstream ownership, reuse of completed checks, specialist execution capabilities, explicit Notify replies, and selective shared-knowledge contributions.
- Let independent verification inspect the complete final chat answer through an attempt-scoped candidate tool, while retaining real artifact and required test evidence.
- Capture chronological specification versions when a human explicitly refers to an updated source, retaining earlier snapshots for ongoing tasks.
- Keep explicit QueryAgent waits under their own completion, input, cancellation and timeout rules instead of transferring them through the generic slow-tool policy.
- Inject fixed Coordinator guidance once in the active prompt assembly, preserving dynamic paths and complete-system-prompt fallback.
- Enforce Worker read-only access to the Coordinator's actual notes/archive through native session policy, filesystem and Bash providers, while retaining ordinary writes and shared Context. Unsupported restriction backends fail explicitly; Linux restricted Bash requires bubblewrap.
- Display received Agent messages in right-aligned native-style bubbles in Coordinator and Worker chats, retaining sender identity, expandable original Markdown, and existing capsule navigation.

### MoA runtime

- Implement Task, Fork, SendMessage, QueryAgent, and KillAgent over the native Agent Loop, with specialist tool scopes, explicit nested delegation, reporting targets, shared workspaces, and owned isolated worktrees.
- Preserve current Git state when preparing isolated worktrees, hydrate the true cold parent chain for delivery, and retain existing memory paths, turn/message capsule ownership, and native UI controls.
- Add explicit Request/ReplyTo matching, same-turn interruption, late-answer recovery, and native slow-tool transfer. SendMessage remains a direct native tool beside run_code under PTC; it is excluded from program SDKs and nested dispatch.
- Persist full background outcomes through native ignorable plugin records and expose current native job state. Cancellation remains stopping until resource exit; hard continuation waits for the old execution's cleanup.
- Preserve detached PTC dispatch starts and settlements as ignorable records with their original lineage and canonical payloads, keeping native cold history readable after the foreground turn closes. See the [detached PTC log contract](docs/native-moa-detached-ptc-log-contract.md).
- Refresh full Coordinator notes before inference and retain progressive shared context. Add exact completion promises, Builder rubric submission from original requirements, and independent verification with retained native execution tools.
- Interpret later clarifications chronologically and clarify pre-end Builder/Verifier ownership, avoiding a circular requirement for their own future completion or the parent's subsequent turn end. Native closure, resource checks, and explicit artifact/test requirements remain enforced.
- Keep canonical results unique across inbox claims/recovery and hold Coordinator closure while its final Worker result is queued for ingestion.
- Show incoming Agent messages with their real sender and expandable two-line original Markdown inside existing Coordinator/Worker conversations. Preserve native ordinary messages, capsule seats, and synchronous Request Tool Results without adding a page or duplicate message.
- Recover a creation-time timeline observation once the same Worker becomes natively ready, without periodic retries or reopening healthy streams on busy/idle changes; genuine ready-state errors retain explicit Retry. Remove unreachable empty states and unused Host closure wiring.
- Align Git-install metadata with the publishable package and use one self-contained collaboration diagram in both READMEs.
- Use the reviewed rc.3 compatibility manifest covering 19 native packages and 43 file paths. Keep this release and its native compatibility runtime together.
- Earlier implementation evidence: 55 regression files / 302 passing tests, Host/Client typechecks, a production build, and 19 passing launcher checks with no skips. Fresh npm, forwarding-package, and Git consumers plus clean-checkout npm ci passed at `1d24865`. The fresh Timer3 task passed independent artifact verification, normal Coordinator closure, and restart without replay; exact revisions and native UI evidence are recorded in [verification](docs/verification.md).

## 0.1.23 — 2026-11-02

- Add an explicit isolated Web setup, start and read-only doctor CLI with a pinned native runtime lock, audited compatibility backup and recoverable owned setup.
- Keep the new runtime's DSH home, Agent configuration and default workspace separate from the normal Desktop installation.
- Add a dependency-free project task, trial feedback form, and first-run documentation for community testing.
- Publish a 60-second edited real-task recording, independently verified result files and the shared context used by the follow-up task.
- Project coordination and native execution behavior are unchanged from 0.1.22.

## 0.1.22 — 2026-11-02

- Remove sticky global error bookkeeping that could poison unrelated Project turns after a recovered background failure. Current Project assignments, native activity and canonical result delivery still govern closure.
- Use one membership predicate for Coordinator list, public snapshots and Client lists. Failed creation placeholders remain internal; existing Workers with failed execution stay visible.
- Separate native Agent event bindings, Project mode lifecycle and snapshot assembly from the Host entry point. Split Worker dispatch into lifecycle actions, durable intent preparation and native admission; preserve public/storage shapes.
- Clarify data ownership and contributor guidance; align bilingual READMEs with a capability table, quick start, usage guide and project structure.

## 0.1.21 — Initial public developer preview

- Persistent Coordinator and continuable Workers controlled through native DSH sessions.
- Shared progressive context index, Coordinator work records, full final-message return and native recovery deduplication.
- Turn and message-segment capsule ownership, Worker icons, native sidebar branches and Project family archival.
- Native right-side Worker timeline and notes preview; original Markdown inputs and final outputs are collapsed by default.
- Compact idle sidebar spacing, transparent Back control and no independent Worker permission picker.
- Explicit, hash-verified rc.3 compatibility patches and a generated installable Cordis bundle.

This public snapshot starts from a clean initial commit. Private development history and acceptance materials are not included.
