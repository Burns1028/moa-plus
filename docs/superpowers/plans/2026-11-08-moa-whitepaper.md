# Complete MOA Whitepaper Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute the internal tasks, with test-first changes and independent reviews. These tasks are dependencies inside one goal, not separate delivery scopes.

**Goal:** Implement and verify the complete six-chapter MOA architecture in the existing MoA+ DSH plugin.

**Architecture:** DSH owns the actual Agent Loop, native inbox, Sessions, tools, permissions and cancellation. Plugin components own MOA identities, request routing, derived lifecycle, shared knowledge and collaboration hooks. Native extensions are explicit, contract-reviewed and included in the audited compatibility helper.

**Tech Stack:** Existing TypeScript/Cordis plugin, Zod, DSH 0.2.1-rc.3 compatibility runtime, Vitest, native integration fixtures and Ego real UI acceptance.

**Execution note — 2026-11-09:** Tasks 1–10 satisfy the implementation and acceptance criteria, with 54 files / 296 tests at `e617f0f` / bundle `e982a59`, typechecks and 19 launcher checks. Fresh npm/forwarding/Git consumers and clean-checkout npm ci passed at `231663c`. The initial proposed file split was consolidated after the Stop That Shit review: existing memory, message and completion modules own those responsibilities. File lists and interfaces below describe the delivered code; Git history retains the original proposal. Fresh Timer3 independent Pass, normal closure, final restart/recovery and native UI inspection passed on `e982a59`. PR #3 exists with source `231663c` pushed and CI passing; Root owns the final documentation push, Ready metadata and goal-status update. Timer2 Partials and the subsequent pre-end/chronology clarification remain recorded. See the [requirement map and evidence](../../verification.md).

## Global Constraints

- The user authorized the entire whitepaper as one completion target. Do not stop after an internal task or report a subset as completion.
- Continue in the existing Project Mode repository and plugin. Preserve native sidebar, capsules, closable Workers/notes tabs, original Markdown previews, direct human Worker operation, inherited permissions and native Stop.
- Preserve full last committed Worker AI result, including empty-result notification, recovery deduplication and capsule turn/segment provenance.
- Agent loops are homogeneous. Task identity is first in new dialogue; Fork identity is appended after inherited history. Do not personalize System Prompt per child.
- Orchestrator exposes Task, Fork, SendMessage, QueryAgent, KillAgent as its MOA control tools. Workers have role tools, SendMessage and ProjectContext; nested spawning defaults off. QueryAgent belongs to agents controlling descendants.
- Five lifecycle states: Idle, Running, Waiting, Aborting, Zombie. Request await remains Running. Zombie preserves session and workspace; explicit destruction cleans only owned isolated worktrees.
- Task creation has a maximum of 20 starts per batch; native active capacity is a separate constraint.
- Notify and Request both exist; replies require explicit ReplyTo. No sender-based automatic matching. Request waits interrupt for priority inbox work; timeout/interruption retain late-reply routes. Wait cycles downgrade the new Request to Notify.
- Inbox consumption drains the current eligible batch before inference. Explicit queue remains next-turn input. Judge inspection is not consumption; new messages cause incremental rejudgment.
- notes.md is full-text injected before each Orchestrator inference, with 8K characters as a soft budget. Orchestrator maintains notes/archived, both roles maintain reusable Context through context/index.md. Existing memory remains readable and is never overwritten by migration.
- Slow tools support After Seconds, New Message, LLM Judge, plus background_on_message=true. Placeholder is Tool Message. Timer-only without new input continues the same turn; message-triggered handoff closes the old turn after remaining foreground tools settle, then starts a new turn.
- Background work can be queried, waited on or cancelled and wakes its owner with real results. Hard interrupt waits for old execution exit, repairs missing tool results and only then admits new direction.
- Ralph completion-promise checks and independent Rubric Builder / Outcome Verify enforce normal completion; only Pass passes. End-of-loop inbox races withdraw candidate completion. Cancellation and execution handoff are not normal completed work.
- New core interfaces must have explicit reviewed contracts and audited patches. Do not silently patch a personal DSH installation or mutate personal conversations.
- Keep credentials, profiles, private discussions, raw trajectories and acceptance artifacts out of Git.

## Task 1: Memory contracts and progressive context

**Status:** Complete.

**Files:** Reuse `packages/project-mode/src/host/project-memory.ts` and `project-lifecycle.ts`; tests in `tests/host/moa-memory.spec.ts` and `project-memory.spec.ts`.

**Interfaces:** Existing `ProjectPaths`, `MoAIdentity`, `memoryPaths`, `notesInjection`, `identityMessage`, `contextIndexTemplate`, `contextIndexPath`, `readNotes`, `ensureContextIndex` and `bindProjectMemory`. Paths retain saved legacy records; access uses the acting Agent's native filesystem and policy. Full notes reach each inference, with a reminder above 8K Unicode characters. Identity is dialogue containing id, workdir/mode, reportTo and reporting instructions.

- [x] Cover full notes, Unicode budget/reminder boundaries, legacy index coexistence and identity facts.
- [x] Use the existing scoped native filesystem and conditional index creation, without a duplicate memory service or model call.
- [x] Integrate per-inference memory into the Host and pass focused/full regression and typechecks.

## Task 2: Worktree ownership and current-state isolation

**Status:** Complete.

**Files:** `packages/project-mode/src/host/moa/workspaces.ts`, with `tests/host/moa-workspaces.spec.ts` and `moa-workspace-integration.spec.ts`.

**Interfaces:** Export `MoAWorkspaceManager.prepare({ownerId,sourceDirectory,mode,signal})`, `restore(record)`, `destroy(record,signal)` and serializable `MoAWorkspaceRecord`. Isolated creates a Git Worktree based on the source's current tracked and non-ignored untracked content; Shared returns the parent directory. Workspace ownership and native permission roots are explicit. Reusable Context stays shared even when code worktrees differ.

- [x] Cover dirty tracked/staged/untracked state, independent worktrees, retained Zombie workspaces and owned-only destruction with temporary real Git repositories.
- [x] Execute Git management through the acting native sandbox policy and filesystem boundary.
- [x] Prepare, discover, restore and destroy owned records while preserving shared/user-owned directories; pass Git and integration regressions.

## Task 3: Request broker and interruptible waits

**Status:** Complete.

**Files:** `packages/project-mode/src/host/moa/messages.ts`, reusing `judge.ts`, `residency.ts` and existing `host/state.ts` records; `tests/host/moa-messages.spec.ts`.

**Interfaces:** `MoAMessageBroker.send(actor,input,operationId,signal)`; `recover(rootId)`, `dispose()`. Host-supplied ports authorize actual membership, persist routes, deliver identified native messages, observe unread input and invoke the lightweight judge. Export serializable `MoAMessageEnvelope`, `RequestRoute`, `SendMessageInput`, and `RequestResult` (answered/interrupted/timeout/downgraded). No custom Agent Loop/inbox.

- [x] Cover explicit answer waits, priority interruption, notification judgment/rejudgment, timeout, late reply, cycles, cancellation, duplicate replies and restart routing.
- [x] Keep durable routes/receipts, active waits and cycle detection in the broker, with native identified delivery and abort/membership cleanup.
- [x] Integrate `createNativeMessageBroker` and the direct native SendMessage tool into actual DSH, including PTC and held-receipt same-turn regressions.

## Task 4: Agent identity, five-state views and native control tools

**Status:** Complete.

**Files:** `packages/project-mode/src/host/moa/agents.ts`, `tools.ts`, `roles.ts` and `messages.ts`; native integration and specialist tests under `tests/host/`.

**Interfaces:** `MoAAgents.task`, `fork`, `query`, `kill`, `context`, `recover` and `lifecycle`. Destruction uses `kill(..., {destroy:true})`. Task/Fork/QueryAgent/KillAgent/ProjectContext definitions live in `tools.ts`; SendMessage lives in `messages.ts`. Query defaults to state, with explicit newest-relative history and interruptible selected/all-child waits. Role restrictions and nested permission are scoped.

- [x] Cover clean Task history, committed-history Fork/open-tail repair, new identity, creator/reportTo distinction, retained preset tools, batch limit and derived lifecycle states.
- [x] Use native continuation, registry, Session history, scoped capability restrictions and joined cancellation.
- [x] Pass actual native tool-schema, role, control, residency and history regressions and typechecks.

## Task 5: Reviewed native background/handoff/cancellation integration

**Status:** Complete.

**Files:** Reviewed native contracts in `docs/native-moa-contract.md`, `native-moa-residency-contract.md`, `native-moa-protocol-presentation-contract.md` and `native-moa-detached-ptc-log-contract.md`; exact patches in `compat/rc3/`; plugin `packages/project-mode/src/host/moa/background.ts` and `host/native.ts`; regressions in `tests/native-contract/moa-background.spec.ts` and `moa-protocol-presentation.spec.ts`.

**Interfaces:** Actual native tool-execution hooks detach supported tool promises into the native background owner. `query_background_tool(tool_call_id,wait_timeout)` and `cancel_background_tool(tool_call_id)`. A handoff records its cause and triggering inbox IDs after all foreground sibling calls settle; it is distinguishable from completed work. Native cancel/continue waits for the cancelled activity to exit and clears its abort state before new input.

- [x] Independently review native contracts and pin their actual runtime/declaration changes in the existing manifest.
- [x] Cover timer/message/judge policy, placeholders, same-turn timer versus message handoff, sibling barriers, canonical output/wakeup, cancellation, pairing and hard continuation.
- [x] Keep native-only SendMessage outside PTC programs, persist background outcomes and detached traces through native ignorable records, and expose current native job state.
- [x] Pass native regressions and exact npm/legacy/runtime-only compatibility, refusal, rollback and launcher checks; retain the 13-package / 31-path boundary.

## Task 6: Completion guards and independent verification

**Status:** Complete.

**Files:** `packages/project-mode/src/host/moa/completion.ts` owns both Ralph and independent Builder/Verifier; coverage is in `tests/host/moa-completion.spec.ts`.

**Interfaces:** `bindCompletion` mounts `set_completion_criteria` and native hooks. Coordinator human input at pre-step captures original requirements/source snapshots and creates hidden helpers; restart fallback recreates them at turn-stopping. Builder's only tool is validated `submit_rubric`; the Host writes `rubrics.md`. Verifier retains native preset execution tools, reads that authoritative rubric, inspects artifacts and runs required checks. Only Pass clears normal completion; Workers do not receive recursive outcome helpers.

- [x] Cover exact promises, source-independent Builder input/submission, tool-backed verification, Partial/Block rework, input/end races, cancellation and restart.
- [x] Use hidden native sessions and hooks, preserve helper evidence, deny Builder execution/delegation and retain Verifier preset capabilities.
- [x] Pass completion and native preset-isolation regressions; observe real Builder submission, Verifier Pass and Ralph correction separately in Task 10.
- [x] Clarify chronological instructions and pre-end Builder/Verifier ownership without requiring their own future completion records or the parent's subsequent end.

## Task 7: Integrate complete runtime into existing Host

**Status:** Complete.

**Files:** Existing `packages/project-mode/src/host/` modules: `index.ts`, `host-access.ts`, `state.ts`, `agent-events.ts`, `worker-operations.ts`, `completion-outbox.ts`, `turn-coordination.ts`, `project-memory.ts`, prompts/config; existing shared view contracts.

- [x] Exercise actual Agent execution/inboxes, hot/cold parent chains, Request recovery, full ended-turn AI results and handoff/completion separation.
- [x] Bind startup/disposal, tools and persisted facts while preserving legacy backend and ordinary-session behavior.
- [x] Admit identity as dialogue and full notes before inference, with role tools, shared context and native delegated permissions.
- [x] Preserve empty AI results, canonical claim/recovery deduplication, handoff capsule provenance and same-turn closure through queued final ingestion.
- [x] Pass focused and complete Host/Client/integration/native-contract regression.

## Task 8: Minimal native UI and user controls

**Status:** Complete.

**Files:** Existing `packages/project-mode/src/client/` runtime/store/components/branch/panels/timeline modules and locale files; `tests/client/` and native sidebar contracts.

- [x] Cover native busy state, permanent mode identity, capsule ownership, deleted-member hiding and nested parent addresses.
- [x] Retain original sidebar/controls, Markdown previews, closable Workers/notes tabs, Back and inherited permissions.
- [x] Pass Client/native-renderer contracts; keep live UI evidence and final scenario acceptance separate in Task 10.

## Task 9: Package, documentation and broad independent review

**Status:** Complete.

- [x] Align architecture, API, usage, changelog and compatibility documentation with the delivered code and stable package/storage identities.
- [x] Pass production build, Host/Client types, 54 files / 296 combined tests, 19 launcher tests and `231663c` npm/forwarding/Git consumers with clean-checkout npm ci.
- [x] Complete independent architecture/Stop reviews and bounded reviews of acceptance fixes; resolve findings with focused verification.
- [x] Maintain the six-chapter and six-control-flow requirement-to-code/test/evidence map in existing [verification](../../verification.md).

## Task 10: Real DSH/model/UI acceptance and PR

**Status:** Complete. PR #3 contains the pushed source and passing CI; final documentation push and Ready metadata are delivery housekeeping.

- [x] Prepare a fresh isolated compatible DSH runtime and test workspace without personal sessions/profiles.
- [x] Observe real Task/Fork, role/nested reporting, Request/ReplyTo/interruption/late replies, direct human Worker control, shared knowledge and full canonical result return.
- [x] Observe real message-triggered background work, cancellation/resource exit, hard continuation, Ralph promise correction, Builder submission and independent Verifier Pass/rework.
- [x] Inspect native status/tools/trajectories/capsules and actual artifacts through Ego; observe deletion, family archive and restoration while preserving deletion. After final restart, confirm the cold Worker/Back flow, idle Coordinator, original compact capsule, closable tabs and Markdown previews.
- [x] Keep scripted versus real-model evidence separate and retain failed runs. The older timer completed its Worker flow but its Coordinator failed cold observation; the detached writer correction and cold-read regressions are in `ec9b011`.
- [x] Retain both Timer2 Partial attempts and operator clarification; correct circular pre-end and chronological-scope instructions through `e617f0f`. Accept the separate fresh Timer3 task only after its actual independent Pass and normal completed Coordinator end, now observed on `e982a59`.
- [x] Finish final runtime restart/recovery acceptance: completed ends and artifact unchanged, one consumed relay at one attempt, no duplicate background result and no reopened model turn.
- [x] Deliver the complete source in PR #3, with `231663c` pushed and CI passing. Root completes the final documentation push and Ready metadata; merge/release remains the user's decision.
- [x] Satisfy the complete-goal criteria: all whitepaper implementation, required automated checks and real runtime/UI acceptance have passed.

Root owns the final goal-status and PR-readiness metadata; this document records satisfied implementation and acceptance criteria.
