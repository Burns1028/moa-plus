# Code architecture and reading guide

MoA+ is a Cordis Host/Client plugin over DSH's native Agent Loop, Sessions, inboxes, subagent manager, filesystem, jobs, and workspace registry. Coordinator and Worker use the same runtime. The plugin supplies role composition, collaboration tools, shared knowledge, durable delivery facts, and completion hooks.

This guide describes the unreleased runtime in the current checkout. The v0.1.23 tag and its media document the earlier Project Mode preview. Read [compatibility](compatibility.md) for the matching native runtime and [verification](verification.md) for evidence status.

## Three layers

```mermaid
flowchart TB
    P["Collaboration patterns: delegate, branch, compare, review, continue"]
    C["Coordinator: goal, direction, notes/archive, review, delivery"]
    W["Workers/specialists: execution, findings, reporting"]
    M["Shared knowledge: context/index.md + topic files"]
    K["Native DSH: Agent Loop, registry, inbox, sessions, tools, jobs, permissions"]
    P --> C
    C <-->|"Task / Fork / SendMessage / QueryAgent / KillAgent"| W
    C <--> M
    W <--> M
    C --> K
    W --> K
```

Patterns are decisions made through these tools and role prompts. There is no second scheduler, universal cross-turn tool lock, or task-keyword routing layer. The Coordinator retains ordinary execution tools and decides task ownership.

## Reading order

| File | Responsibility and main entry points |
| --- | --- |
| [host/index.ts](../packages/project-mode/src/host/index.ts) | `ProjectMode[Service.init]`, `prepareAgent`, `attach`, `recover`, and authorized Remote methods compose the plugin. |
| [host/moa/tools.ts](../packages/project-mode/src/host/moa/tools.ts) | Native model definitions and validation for Task, Fork, QueryAgent, KillAgent, and ProjectContext. |
| [host/moa/agents.ts](../packages/project-mode/src/host/moa/agents.ts) | `MoAAgents.task`, `fork`, `query`, `kill`, `context`, `recover`, and `lifecycle` implement controls through existing native capabilities. |
| [host/moa/roles.ts](../packages/project-mode/src/host/moa/roles.ts) | `applyRoleRestrictions` mounts each specialist's execution-tool boundary. |
| [host/moa/workspaces.ts](../packages/project-mode/src/host/moa/workspaces.ts) | `MoAWorkspaceManager.prepare`, `discoverOwned`, and `destroy` own dirty-state snapshots and cleanup of owned worktrees. |
| [host/moa/messages.ts](../packages/project-mode/src/host/moa/messages.ts) | `MoAMessageBroker` matches explicit replies, waits interruptibly, detects wait cycles, and persists routing/receipts through `createNativeMessageBroker`. |
| [host/moa/residency.ts](../packages/project-mode/src/host/moa/residency.ts) | `withManagedAgent` borrows the actual native parent chain for cold message/result delivery without invented input. |
| [host/moa/judge.ts](../packages/project-mode/src/host/moa/judge.ts) | `judgeInterrupt` makes a short native no-thinking decision about pending input without consuming it or creating an Agent. |
| [host/moa/background.ts](../packages/project-mode/src/host/moa/background.ts) | `bindBackground` binds policy, job queries/cancellation, canonical result receipts, recovery, and teardown to one native Agent. |
| [host/moa/completion.ts](../packages/project-mode/src/host/moa/completion.ts) | `bindCompletion` installs Ralph and the Coordinator's owned independent Builder/Verifier helpers. |
| [host/project-memory.ts](../packages/project-mode/src/host/project-memory.ts) | `memoryPaths`, `identityMessage`, `ensureContextIndex`, and `bindProjectMemory` own paths, identity text, progressive index creation, and full notes admission. |
| [host/worker-operations.ts](../packages/project-mode/src/host/worker-operations.ts) | `spawnMoA` and the existing prepare/admit/accept/reconcile path persist input acceptance and capsule provenance. Legacy backend controls use the same path. |
| [host/completion-outbox.ts](../packages/project-mode/src/host/completion-outbox.ts) | `ingest`, `deliver`, and `consume` persist full ended-turn results and route them once to the designated recipient. |
| [host/agent-events.ts](../packages/project-mode/src/host/agent-events.ts) | `bindAgentEvents` retains native registration order; pre-step normalization reconciles native settlement notices with canonical MoA delivery. |
| [host/turn-coordination.ts](../packages/project-mode/src/host/turn-coordination.ts) | `guardTurn` waits on current project obligations while yielding to input/Stop; `freezeTurn` records historical capsule outcomes. |
| [host/project-lifecycle.ts](../packages/project-mode/src/host/project-lifecycle.ts) | `ProjectLifecycle` owns permanent mode identity and draft enable/disable through native maintenance. |
| [host/project-views.ts](../packages/project-mode/src/host/project-views.ts) | `buildProjectSnapshot` assembles transport views from observed native/durable facts. |
| [host/capsule-participation.ts](../packages/project-mode/src/host/capsule-participation.ts) | `participatingMemberships` and `repairCapsuleOwnership` retain native turn/human-segment anchors. |
| [host/history.ts](../packages/project-mode/src/host/history.ts), [worker-activity.ts](../packages/project-mode/src/host/worker-activity.ts), [worker-timeline.ts](../packages/project-mode/src/host/worker-timeline.ts) | Explicit dialogue windows, current input provenance, and read-only work-axis projections. |
| [host/project-archive.ts](../packages/project-mode/src/host/project-archive.ts) | Family archival through the native workspace registry. |
| [client/runtime.ts](../packages/project-mode/src/client/runtime.ts), [store.ts](../packages/project-mode/src/client/store.ts) | Remote subscriptions/reconnect and derived complete-snapshot/capsule caches. |
| [client/index.tsx](../packages/project-mode/src/client/index.tsx), [branch.tsx](../packages/project-mode/src/client/branch.tsx), [components.tsx](../packages/project-mode/src/client/components.tsx) | Native slot contributions: original sidebar rows, capsules, MoA+/Back controls. |
| [client/panels.tsx](../packages/project-mode/src/client/panels.tsx), [worker-timeline.tsx](../packages/project-mode/src/client/worker-timeline.tsx) | Default closable native tabs and expandable original Markdown input/output. |

`host/native.ts` is the version-sensitive adapter boundary. `HostAccess` supplies native capabilities and the Host callbacks used by extracted components. It is not a parallel execution engine. `host/control.ts` retains legacy backend request schemas; it no longer defines a model-visible `control_workers` tool.

## Durable facts and derived views

[host/state.ts](../packages/project-mode/src/host/state.ts) owns persisted schemas; [shared/index.ts](../packages/project-mode/src/shared/index.ts) owns transport views.

| Structure | Owner and lifetime |
| --- | --- |
| `ProjectRecord` / `projectSchema` | Root Session identity, workspace/memory paths, permanent mode lock, revision. Historical name retained. |
| `Worker` / `workerSchema` | Managed membership (`provisioning`, `active`, `deleting`, `deleted`, `provision-failed`), not execution state. |
| `AgentDescriptor` | Actual creator, `reportTo`, role, nested permission, workspace mode/ownership, and Fork source facts. Stored in existing project operations. |
| `MoAWorkspaceRecord` | Shared source reference or owned isolated worktree, branch, Git common directory, and owner identity. |
| `assignmentSchema` | One prepared input operation and its native acceptance ID, delivery mode, turn, and human-message segment. |
| `Completion` | One real ended Worker turn, keyed by Worker and native turn-end sequence, containing its complete last committed AI payload. |
| `deliverySchema` | Canonical result, recipient, admission/consumption state, attempts, and diagnostics. Legacy missing recipient means Coordinator. |
| `RequestRoute` | Request ID, sender/receiver, waiting/ended/answered route, and explicit answer; retained for late replies/recovery. |
| `BackgroundResultData` | Full canonical native result and stable identified delivery persisted in the owning Session. |
| Completion input/criteria records | Task identity, original human/spec snapshots, exact promise, and current task state; stored in existing operations. |
| `RecordState` | Persisted aggregate of plugin-owned relationships, admissions, results, and recovery facts. |
| `Projection` | Fold of native events: turn boundaries, committed inputs/finals, handoff carry-over, and capsule anchors. |
| `WorkerView` / `ProjectSnapshot` | Derived native activity, membership, availability, progress, and UI state. |
| `WorkerHistoryPage` / `WorkerTimelinePage` | Explicit human/AI message windows versus UI native turns and artifacts. |

Native Session events are authoritative for execution and accepted/committed messages. Project storage records collaboration and delivery facts. `notes.md`, `archived.md`, and context files are Agent-maintained knowledge/work records, not a result-dedup database. Client caches derive from complete Host snapshots.

Five-state lifecycle is derived from native activity, approval/query waits, cancellation cleanup, and history. Request's awaited Tool Call remains **Running**; Query/human approval can be **Waiting**. **Aborting** lasts through actual cleanup. **Zombie** retains conversation/workspace without active model execution; SendMessage resumes it. A newly created Agent with no run is **Idle**. Membership, native busy/idle, cold residency, and display phase remain distinct facts.

## Composition and admission

`ProjectLifecycle.setEnabled → native maintenance → memory files/project record → prepareAgent → scoped tools/background/completion bindings`.

The first owned turn locks mode identity. Creation and mode enable await bindings before native tool-schema assembly. Role identity is dialogue: Task first; Fork after inherited history. The five controls replace alternative native delegation in managed scopes; nested control tools default off. Draft disable/unload reverses scoped contributions and drains owned work without editing global preferences.

Task/Fork reserve stable identities and persist descriptor/workspace facts before native activation. `WorkerOperations` prepares an assignment before accepting input, records its native receipt, and establishes capsule participation. Per-Worker mutation ordering ends after admission; it is not held for the whole model task. Fork's temporary recovery seed is removed only after confirmed native acceptance. Uncertain acceptance is reconciled against persisted native evidence before retrying.

Isolated preparation snapshots the source's current tracked/staged/untracked state using an independent Git index. Git commands use the acting native sandbox policy. Owned markers identify cleanup resources; destruction never removes a shared source. For explicitly permitted nested creation, management is scoped to the project's Git resources while ordinary execution keeps the child's own cwd policy. Read-only mode remains read-only; foreign Git resources outside the permitted project boundary are rejected.

## Messages and result return

Notify admits an identified message and returns. Request persists its route, admits input, and waits inside the native Tool Call. Explicit `reply_to` resolves that call; unrelated input can interrupt the wait, and a late answer is delivered through the inbox. A wait-cycle check downgrades the new cyclic wait to Notify. The native pre-step drains all eligible next-step input; explicit next-turn queue input remains separate.

`withManagedAgent` reads durable headers and borrows the true parent chain, including cold intermediate parents. The reviewed Host-only native callback preserves reconstruction, delegated policy, capacity, and cleanup. It does not create synthetic user prompts or task events for intermediate hydration.

```mermaid
sequenceDiagram
    participant W as Native Worker
    participant O as CompletionOutbox
    participant S as Project storage
    participant R as reportTo Agent
    W->>O: Real turn/end + final committed AI
    O->>S: Unique completion + pending delivery
    O->>R: Identified native input, live or cold
    R->>O: Result commits as user/message
    O->>S: Mark consumed; preserve original capsule anchor
    R->>R: Review evidence and choose next action
```

An empty final AI result is delivered as empty; an earlier turn's reply is never substituted. The designated `reportTo` receives the result once, without a duplicate full-body copy to the root. The root can still observe team state. A message-driven background handoff is not a Worker completion; projection carries its consumed assignment IDs until a real ending accounts for them.

Normal Coordinator closure considers its own project queue, remaining assignments, actual Worker/background activity, and unconsumed results. Incoming next-step input and native Stop interrupt the wait. Historical errors on consumed/suppressed results do not block another project or later closure. Recovery reconciles durable acceptance, receipts, deletion, worktree ownership, and capsule anchors.

## Six control flows

| Flow | Implementation boundary |
| --- | --- |
| Interruptible waiting | QueryAgent waits on native changes, relevant completion, input, timeout, or Stop. It never starts a second driver. |
| Soft insertion | SendMessage uses native next-step/next-turn admission symmetrically for main and child Agents. |
| Slow-tool transfer | Native activity detaches into an owned job; `bindBackground` applies AfterSeconds/NewMessage/LLMJudge, records full results, and exposes query/cancel. |
| Hard interrupt/steer | Native `cancelAndJoin` awaits old driver/resource exit, repairs missing Tool Results, flushes, then admits optional replacement with fresh control. |
| Completion gates | Ralph checks a bound exact promise; independent Builder/Verifier derive source-anchored criteria and inspect real artifacts/tools. |
| Parallel/end races | Native batch ordering retains foreground sibling barriers and pairing; eligible final inbox input withdraws candidate completion. |

AfterSeconds without new input returns control within the current turn. A message-driven transfer writes a Tool Message placeholder, ends that turn with handoff, and lets incoming input open the next turn. Actual original-tool output validation/render/finalization runs once; a placeholder is not original-schema success. Pending jobs/results remain owned until real completion/delivery, and idle Agents can wake for their results. See the [reviewed native contract](native-moa-contract.md) for the exact resource and handoff contract.

Completion helpers are native owned Agents, hidden from the managed Worker catalog. Builder sees original human inputs and captured source references, not implementation output. Verifier reads authoritative workspace `rubrics.md` and checks deliverables through native tools. Promise/source records survive interrupted work and restart. Internal gate notices have a separate source kind so they cannot become new human requirements or capsule segments. Helpers are retired/drained through native ownership; new human input is not held behind an obsolete verifier.

## Memory and UI boundaries

New projects use root `notes.md`, `archived.md`, `rubrics.md`, and `context/index.md`. Existing paths remain unchanged. `bindProjectMemory` injects full notes on every Coordinator inference; above 8,000 characters it appends an organization reminder, leaving archival to the Coordinator. Context remains progressively loaded. ProjectContext applies native conditional writes in the actual shared context directory, so isolated Workers can contribute without overwriting another Agent's latest version.

Workers and Coordinator share a knowledge base, while the Coordinator maintains notes/archive. Same-cwd conversations share these files and `rubrics.md`; independent projects should use separate workspaces. Rubric task/generation/content checks prevent another task's overwritten file from silently passing verification.

The Client contributes native slots and tabs; it does not replace the workspace browser, composer, permission engine, or file preview. Capsule keys remain `(Coordinator Session, native turn, human-message segment, Worker)`. Dispatch, accepted updates, and received results establish participation; reads and passive input do not. Deletion hides all seats and public membership while native history remains. Workers use Back and inherited permissions.

The Workers tab is read-only. It shows original input, final AI output, and artifacts with two-line expandable Markdown previews. It does not summarize via a model. Workers/notes defaults use native closable tab behavior. Native sidebar rows retain their alignment and controls.

The historical `ProjectMode`, `ProjectClient`, storage, package, and Remote names remain compatibility identifiers. They are not separate product modes or a reason to migrate user data. See [contributing](../CONTRIBUTING.md) for checks and [verification](verification.md) for evidence still required before release.
