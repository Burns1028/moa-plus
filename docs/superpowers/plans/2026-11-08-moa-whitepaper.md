# Complete MOA Whitepaper Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute the internal tasks, with test-first changes and independent reviews. These tasks are dependencies inside one goal, not separate delivery scopes.

**Goal:** Implement and verify the complete six-chapter MOA architecture in the existing MoA+ DSH plugin.

**Architecture:** DSH owns the actual Agent Loop, native inbox, Sessions, tools, permissions and cancellation. Plugin components own MOA identities, request routing, derived lifecycle, shared knowledge and collaboration hooks. Native extensions are explicit, contract-reviewed and included in the audited compatibility helper.

**Tech Stack:** Existing TypeScript/Cordis plugin, Zod, DSH 0.2.1-rc.3 compatibility runtime, Vitest, native integration fixtures and Ego real UI acceptance.

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

**Files:** Create `src/host/moa/memory.ts`, `tests/host/moa-memory.spec.ts`; integrate existing `project-memory.ts` in Task 7.

**Interfaces:** Export `MoAMemoryPaths`, `memoryPaths(root)`, `notesInjection(text)`, `identityMessage(identity)`, `contextIndexTemplate`, and a native-filesystem-backed `MoAMemory` service. Input paths are supplied by the host, including legacy records; read/write uses the acting Agent's scoped filesystem and policy. notesInjection returns the complete text and a cleanup reminder only when character count exceeds 8K. identityMessage contains id, workdir/mode, reportTo and report requirements, as history content.

- [ ] Write tests for full notes preservation, Unicode character budget, reminder boundary, index/legacy coexistence and identity facts; observe expected failure.
- [ ] Implement the memory functions and policy-aware service without direct unrestricted filesystem writes or model calls.
- [ ] Run focused memory tests and typecheck; commit only the component and tests.

## Task 2: Worktree ownership and current-state isolation

**Files:** Create `src/host/moa/workspaces.ts`, `tests/host/moa-workspaces.spec.ts`.

**Interfaces:** Export `MoAWorkspaceManager.prepare({ownerId,sourceDirectory,mode,signal})`, `restore(record)`, `destroy(record,signal)` and serializable `MoAWorkspaceRecord`. Isolated creates a Git Worktree based on the source's current tracked and non-ignored untracked content; Shared returns the parent directory. Workspace ownership and native permission roots are explicit. Reusable Context stays shared even when code worktrees differ.

- [ ] Use temporary real Git repositories to fail tests for dirty tracked files, staged files, untracked files, conflicting independent writes, Zombie retention and owned-only destruction.
- [ ] Reuse native worktree/filesystem APIs where available; any missing native policy seam is a reviewed contract, not an unrestricted shell escape.
- [ ] Implement cleanup and restore without deleting Shared or user-owned directories; run real temporary-Git tests and commit.

## Task 3: Request broker and interruptible waits

**Files:** Create `src/host/moa/messages.ts`, `request-waits.ts`, `message-state.ts`, `tests/host/moa-messages.spec.ts`.

**Interfaces:** `MoAMessageBroker.send(actor,input,operationId,signal)`; `recover(rootId)`, `dispose()`. Host-supplied ports authorize actual membership, persist routes, deliver identified native messages, observe unread input and invoke the lightweight judge. Export serializable `MoAMessageEnvelope`, `RequestRoute`, `SendMessageInput`, and `RequestResult` (answered/interrupted/timeout/downgraded). No custom Agent Loop/inbox.

- [ ] Fail behavioral tests for normal reply, request await preventing return, priority interruption, ordinary-notification judge false, incremental rejudge, timeout, late reply, parallel requests, cycles, cancellation, double replies and restart routing.
- [ ] Implement durable request identity before admission, active process waits and wait graph, explicit ReplyTo, late native delivery, abort cleanup and membership removal behavior.
- [ ] Run focused tests with real event-emitting ports; commit. Integration into actual DSH occurs in Task 7.

## Task 4: Agent identity, five-state views and native control tools

**Files:** Create `src/host/moa/agents.ts`, `tools.ts`, `roles.ts`, `tests/host/moa-agents.spec.ts`; use actual native types.

**Interfaces:** `MoAAgents.task`, `fork`, `query`, `kill`, `destroy`, `lifecycle`. Five model-facing definitions Task/Fork/SendMessage/QueryAgent/KillAgent and ProjectContext. Query status by default, explicit newest-relative offset/limit for human/AI history, optional event-driven wait for selected/all children. Kill defaults to stop/sleep; explicit destruction and existing delete remain distinct. Role tool restrictions and nested switch are scoped.

- [ ] Fail native-oriented tests for Task clean history, selected-source Fork at a committed watermark including open-tail repair, fresh identity, parent/reportTo distinction, role tools, maximum batch size, Request Running and Query Waiting.
- [ ] Implement using native continuation providers, registry, Session fork and history, scoped tool suppression and native cancellation. Do not clone a live JS execution or expose inherited tool authority.
- [ ] Run targeted native tests and typecheck; commit.

## Task 5: Reviewed native background/handoff/cancellation integration

**Files:** Contract in `docs/native-moa-contract.md`; audited additions under `compat/rc3/`; plugin `src/host/moa/background.ts`, native adapter in `native.ts`; tests under `tests/native-contract/` and `tests/host/moa-background.spec.ts`.

**Interfaces:** Actual native tool-execution hooks detach supported tool promises into the native background owner. `query_background_tool(tool_call_id,wait_timeout)` and `cancel_background_tool(tool_call_id)`. A handoff records its cause and triggering inbox IDs after all foreground sibling calls settle; it is distinguishable from completed work. Native cancel/continue waits for the cancelled activity to exit and clears its abort state before new input.

- [ ] Inspect exact native execution seams, write the concrete types/events and independent contract review before any core patch.
- [ ] Fail native tests for all three strategies/threshold bypass, incremental judge, Tool Message placeholder, timer same-turn, message new-turn, sibling barriers, real output return/wakeup, cancel, history pairing and abort/continue ordering.
- [ ] Implement minimal audited interfaces and plugin integration; update manifest before/after hashes, rollback, declarations, runtime variants and launcher tests as necessary.
- [ ] Run native control tests and compatibility preflight; commit only after review.

## Task 6: Completion guards and independent verification

**Files:** Create `src/host/moa/completion.ts`, `verification.ts`, `tests/host/moa-completion.spec.ts`, `tests/host/moa-verification.spec.ts`.

**Interfaces:** A model tool binds task completion criteria and exact completion promise. Agent turn-stopping calls an ordered completion guard. Main startup creates hidden native Rubric Builder/Outcome Verify helpers without recursively attaching graders to every Worker. Builder sees original requirements/specs only, writes source-anchored rubrics.md; verifier reads actual artifacts and runs native Bash build/tests; verdict status is Pass/Partial/Block.

- [ ] Fail tests for missing/exact promises, independent builder input, real tool-backed verification, Partial/Block rework, no premature completion event, inbox arriving before/during final commit, and cancellation escaping normal gates.
- [ ] Implement using native sessions and hooks, not a keyword delegation rule or self-declared successful check. Preserve full helper evidence in the native history.
- [ ] Run focused tests and native verification fixtures; commit.

## Task 7: Integrate complete runtime into existing Host

**Files:** Modify `host/index.ts`, `host-access.ts`, `state.ts`, `agent-events.ts`, `worker-operations.ts`, `completion-outbox.ts`, `turn-coordination.ts`, prompts/config and shared view contracts.

- [ ] Add failing native integration scenarios covering real Agent tool execution, actual inbox delivery, hot/cold peers and parents, request replay, returned final AI, handoff-versus-completion and state recovery.
- [ ] Wire every component into actual Host startup/disposal and persisted records. Install five MOA primitives atomically, replace old model control entries, preserve backend compatibility and ordinary sessions.
- [ ] Inject identity as dialogue and full notes per inference. Mount role tools/ProjectContext and shared-memory references. Configure workspace permissions through native delegation.
- [ ] Update durable projections so missing AI stays empty, late replies deduplicate, handoffs do not fabricate completed work and candidate-completion races reenter the native loop.
- [ ] Run focused scenarios followed by existing full Host/integration regressions and commit.

## Task 8: Minimal native UI and user controls

**Files:** Existing `client/runtime.ts`, `store.ts`, `components.tsx`, `branch.tsx`, `panels.tsx`, timeline and locales as needed; client/native-contract tests.

- [ ] Fail UI tests for new derived states while retaining actual busy spinners, permanent MoA identity, capsule ownership, deleted-member hiding and parent/child alignment.
- [ ] Show only necessary lifecycle/wait/background information through existing native UI. Preserve two-line Markdown previews, closable tabs, Back and inherited permissions.
- [ ] Run real native-renderer UI regressions and commit.

## Task 9: Package, documentation and broad independent review

- [ ] Update public architecture/API/usage documentation around implemented capabilities and all actual compatibility requirements. Reconcile prior branding work without merging it implicitly.
- [ ] Run production build, typechecks, full Host/Client/integration/native-contract/launcher tests and npm/forwarding/committed-Git clean-consumer checks.
- [ ] Generate a whole-branch review package; independently review whitepaper coverage and code quality, fix findings, rerun relevant checks.
- [ ] Maintain a requirement-to-code/test/evidence map with every six-chapter item accounted for.

## Task 10: Real DSH/model/UI acceptance and PR

- [ ] Prepare a fresh isolated compatible DSH runtime and new test workspace; do not reuse personal sessions/profiles.
- [ ] Run real-model tasks for Task/Fork, independent exploration/review, Request/replies/late input, direct human Worker control, shared knowledge reuse, worktree isolation, slow-tool handoff, cancellation/recovery and real verdict-driven rework.
- [ ] Use Ego to inspect status, tools, trajectories, turn closure, message timing, capsule ownership and existing layout; inspect actual artifacts and independently run their checks.
- [ ] Record scripted versus real-model evidence separately; correct defects and repeat only affected acceptance.
- [ ] Push focused reviewable commits/PRs for the complete goal; keep incomplete work clearly draft. Merge/release remains the user's decision.
- [ ] Mark the goal complete only when all tasks, all whitepaper requirements and required acceptance are complete.
