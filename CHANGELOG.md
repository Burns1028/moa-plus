# Changelog

## Unreleased — MoA runtime

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
- Use the reviewed rc.3 compatibility manifest covering 13 native packages and 31 file paths. The existing package version remains 0.1.23; these changes are not a new published release.
- Record 55 regression files / 302 passing tests, Host/Client typechecks, a production build, and 19 passing launcher checks with no skips. Fresh npm, forwarding-package, and Git consumers plus clean-checkout npm ci passed at `1d24865`. The fresh Timer3 task passed independent artifact verification, normal Coordinator closure, and restart without replay; exact revisions and native UI evidence are recorded in [verification](docs/verification.md).

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
