# Native MOA execution contract

Status: independently reviewed native contract, implemented against pinned rc.3 artifacts on 2026-11-08. The exact production patches and declaration counterparts are listed in `compat/rc3/manifest.json`. Focused scripted native-loop and real Bash/PTC tests cover the behavior below; full application and real-model acceptance are recorded separately in the [whitepaper plan](superpowers/plans/2026-11-08-moa-whitepaper.md).

## Baseline and ownership

The target is the **published, pinned DSH 0.2.1-rc.3 artifacts**, with this repository's existing compatibility patches. The installed `dsh-tools/lib/index.js` owns `ToolRuntime`, its single-call pipeline and `TOOL_RUNTIME_SCHEDULER`. The installed `dsh-agent-loop/lib/index.js` owns `executeToolCalls`, `runGroup`, `appendToolResult` and `ReactLoopAgent`. Its `lib/types/tool-calls.d.ts` is the corresponding scheduler declaration. Do not implement against a newer batch API just because its package version is also rc.3.

The local Harness source at commit `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` was read only. It has already moved root batch execution into `packages/core/tools/src/batch.ts` and added `ToolExecutor`; these are **reference locations, not the installed patch target**. Likewise, local `packages/jobs/tool-jobs/src/index.ts` has inline-output delivery that the published rc.3 package does not have.

The original development composition lacked `dsh-jobs`, `dsh-jobs-local` and `dsh-tool-jobs`; the implementation now pins the required native development and runtime dependencies. They were already present transitively in `runtime/rc3/package-lock.json` through native bundles. The locked published jobs declarations and jobs-local/tool-jobs runtimes were inspected from their tarballs in memory; jobs-local and tool-jobs tarball SHA-512 values matched the lock. The implementation must add the exact native dependencies needed for compile-time and test composition, while retaining the runtime's single existing jobs provider. Missing jobs/controller capability must fail MOA background activation visibly; it must not create an alternative registry.

| Responsibility | Owner and inspected seam |
| --- | --- |
| Policy, output schema, cancellation relay, canonical result | `dsh-tools` `createExecution`, `dispatchToolBody`, `dispatchScheduledExecution`, `finalizeScheduledExecution`, `finishScheduledExecution` |
| Root ordering, one result per call, foreground barrier | `dsh-agent-loop` `executeToolCalls`, `runGroup`, `appendToolResult` |
| Turn boundary, inbox claim, abort and restart | `dsh-agent-loop` `ReactLoopAgent.turn`, `step`, `send`, `kick`, `wakeDriver`; `ReactLoopInbox.claim` |
| Execution identity, owner isolation, capacity, kill, wait, teardown | Existing `dsh-jobs` / `dsh-jobs-local` `start`, `get`, `wait`, `kill`, `events.subscribe`, `attachController` |
| Threshold, message policy and judge | Plugin `host/moa/background.ts`; native execution capabilities supplied through `host/native.ts` |
| Full result receipt and deduplicated owner wake | Plugin background controller, backed by native Session events and native inbox |

No new agent loop, scheduler, inbox or jobs registry is introduced. Native concurrency remains batch-local. Transfer releases the foreground scheduling slot, as native Bash promotion already does. The rejected owner-wide lease, deferred suffix jobs, backgroundControl classification and multi-job admission transaction are removed; they are not implementation requirements.

## Existing guarantees and concrete gaps

1. `tools/execute` wrappers cannot detach work: `dispatchToolBody` fuses the captured caller signal back into a replacement signal, and later stages recheck the captured signal. Merely racing `next()` against a timer both violates quiescence and leaves the body cancellable by its former turn.
2. A successful wrapper-authored `ToolExecutionResult` is normalized by the original output schema. A made-up `{background: true}` value is invalid for most tools. Definition-owned projectors/finalizers may also assume the original value. The placeholder must therefore be a **scheduler outcome**, not a fabricated successful execution result.
3. `concludeTurn()` maps a successful batch to `completed`; `turn()` continues whenever `inbox.nextStep` has input. It neither guarantees a new turn nor distinguishes handoff from completed work.
4. `runGroup` preserves model-order policy/results and drains started foreground promises on abort. Preserve that batch guarantee; do not extend it into exclusion against background jobs in later batches.
5. Native `cancel(); steer()` already redirects waking input to next-turn and latches it until the aborted driver exits. `whenIdle()` follows replacement drivers, so it is not an old-activity receipt. After detachment, the driver alone no longer represents all cancelled execution.
6. Native jobs retain a string `JobOutcome.result`, consume it once through `read()`, and bound stream retention. Their durable `job/settled` event does not contain the full tool output. Published `tool-jobs` sends a status notice, suppresses it on `event.awaited`, and can use quiet delivery/wake budgets. Those facts do not satisfy durable full-result wake by themselves.

## Native capability interfaces

These are the reviewed compatibility capabilities; they are not APIs in stock rc.3. Existing branded `SessionId`, `SessionSeq`, `ToolCallId`, `MessageId`, `JobId` and native result types must be imported rather than replaced with strings.

```ts
interface ToolActivityIdentity {
  readonly owner: SessionId;
  readonly turn: number;
  readonly step: number;
  readonly callSeq: SessionSeq;
  readonly callId: ToolCallId;
  readonly rootCallId: ToolCallId;
}

type BackgroundCause =
  | { readonly kind: "after-seconds" | "producer-promotion" }
  | { readonly kind: "new-message" | "llm-judge";
      readonly messageIds: readonly MessageId[] };

interface BackgroundReceipt extends ToolActivityIdentity {
  readonly jobId: JobId;
  readonly cause: BackgroundCause;
}

type BackgroundAdmission =
  | { readonly kind: "background"; readonly receipt: BackgroundReceipt }
  | { readonly kind: "foreground";
      readonly reason: "settled" | "aborted" | "unavailable" };

// Scoped, contained emit event, supplied by the native root scheduler.
interface ToolActivityStarted {
  readonly agent: Agent;
  readonly identity: ToolActivityIdentity;
  readonly execution: Readonly<ToolExecution>;
  readonly finished: Promise<void>; // resource exit, including policy cleanup
  requestBackground(cause: BackgroundCause): Promise<BackgroundAdmission>;
}
// agent/tool-activity-started(payload: ToolActivityStarted): void

// Internal TOOL_RUNTIME_SCHEDULER additions; never a model capability.
interface ToolDispatchActivity {
  readonly dispatch: Promise<ScheduledToolDispatch>;
  readonly exited: Promise<void>;
  cancel(reason: unknown): void;
  // Native scheduler only, after successful native job ownership admission.
  releaseCaller(): void;
}
// prepare(input, { transferable: true }) installs the owned signal relay.
// start(exec) invokes the existing dispatch exactly once and returns the activity.

type RootCallOutcome =
  | { readonly kind: "result"; readonly result: ToolExecutionResult }
  | { readonly kind: "background"; readonly receipt: BackgroundReceipt };

interface TurnHandoff {
  readonly kind: "handoff";
  readonly cause: "background-message";
  readonly calls: readonly BackgroundReceipt[];
  readonly triggeringMessageIds: readonly MessageId[];
}
// executeToolCalls returns { concluded: boolean; handoff?: TurnHandoff }.
// Merge TurnHandoff into the native TurnEndReasonMap.

interface Agent {
  // Derived from the native cancellation phase or an uncompleted join; no second lifecycle state.
  readonly moaAborting: boolean;
  // Keeps a continuation resident until its transferred work and result obligations settle.
  readonly moaHasPendingBackground: boolean;
  enableToolBackground(options?: { readonly hasPendingResult?: () => boolean }): () => void;
  cancelAndJoin(
    cause: AgentCancelCause,
    options?: { readonly continuation?: UserMessage },
  ): Promise<void>;
  // No continuation: stop-and-join without input or a new turn.
  // Continuation: join, flush replacement admission, then start fresh work.
}
```

`ToolExecutionResult` remains the existing success/failure union. `RootCallOutcome` is used only by the native logged-root scheduler. Direct `tools.execute(...)` and program sub-dispatches continue returning canonical results. A root `run_code` may transfer as a whole; individual PTC subcalls must not return placeholder values into a running program. Its nested calls retain the existing PTC policy and cancellation chain. Their canonical values and native concurrency classification are unchanged.

`SendMessage` is a direct native protocol tool even for PTC presets: the narrow `nativeOnly` metadata exposes its native schema beside `run_code` and excludes it from program bindings. Request retains its own original Tool Result through interruption and durable receipt writes. The [protocol presentation contract](native-moa-protocol-presentation-contract.md) defines schema, SDK, execution and ordering parity; ordinary program tools keep the behavior above.

The new event is emitted only after root admission and actual dispatch start, not while approval is pending. The plugin installs timers and inbox observers, calls the provided capability, and removes observers when `finished` settles or its context disposes. It never receives a raw promise it can abandon, a mutable native phase, or permission to replace the cancellation signal. Native scope teardown must cancel and drain admitted work even if the plugin unloads.

## Transfer, lifetime and output policy

Before pre-execute policy for a transferable root, ToolRuntime creates one activity controller and a removable relay from the turn signal. Pre-policy, wrappers, body and later post-policy receive that activity signal. Around wrappers may add timeout cancellation; the registry still fuses wrapper cancellation with the **activity** signal. The original turn signal is relayed only while foreground. All cancellation checks must consult this same activity state, including `callerCancelled`, not an obsolete captured turn signal. Ordinary calls preserve current behavior.

Transfer has one native linearization point. A settled result or prior abort wins over transfer. For a bound producer the scheduler reuses its already-admitted native job; it does not register a second job. Otherwise, the scheduler calls `jobs.start` with the exact live Agent owner, creating tool-call identity, `kind: "moa-tool"`, synchronous idempotent `cancel`, and a nonrejecting `done` promise. This registers the **already-running** invocation; it does not dispatch it again. The registry preflights controller availability and capacity. Only after successful registration may the scheduler unlink the turn relay and commit background ownership. Reentrant abort during registration wins before unlinking: cancel/join the newly registered job and retain foreground cancellation. Capacity or registration failure retains the foreground promise and its signal; no placeholder or handoff is published. `requestBackground` is idempotent for the same activity.

There must be no unowned interval and no window in which both foreground and background code finalize the same result. Foreground abort remains responsible until the transfer commits; afterward native job cancellation, owner disposal, native runtime disposal, wrapper deadlines and explicit hard interruption remain effective. Transfer never resets an already-aborted signal. For a newly registered generic root job, `JobHooks.done` resolves after body/wrapper cleanup and canonical output processing. For an existing producer job it remains the producer's resource-exit receipt; MOA separately waits for the root's canonical result and persistence checkpoint before delivering completion. Neither native job status nor a tool promotion acknowledgment is a final MOA result. A registry record forced failed after a throwing producer cancel is not proof of resource exit; cancellation continuation must join the activity's actual `exited` promise.

Only the eventual real result runs original schema validation, output rendering, projectContent, tools/post-execute, finalizeContent and tools/result, exactly once. Pre-execute and approval are not rerun after transfer; policy identity and scope are retained. The placeholder goes through none of those tool-value callbacks. Post-policy still may block, replace or spill the real result. “Complete result” means all canonical model-facing content after legitimate policy, including its native spill reference, error and presentation metadata; it does not mean recovering data the original tool itself omitted. Background completion must not apply an additional arbitrary text truncation.

Ordered foreground results remain model ordered. A transferred invocation's later post-policy/result notification occurs when it completes, explicitly outside the old foreground order. Detached deferred contexts are delivered with that result, never silently discarded or injected into the already-closed turn. A detached tool's `concludeTurn` intent cannot conclude a newer unrelated turn and is not forwarded as normal completion.

## Batch scheduling and the actual Bash producer

Keep installed `executeToolCalls/runGroup` ordering: execute every original sibling in submission/classification order, and commit results in model order. A transferred root contributes its placeholder and releases its foreground slot. Remaining siblings run normally; they do not become jobs merely because another call detached. Wait for every actual foreground sibling before the next inference or message handoff. Background work may overlap later tools, including exclusive tools, exactly as existing Bash promotion permits. There is no cross-turn lock, privileged control bypass or multi-job transaction.

The locked published Bash defaults to `enableRunInBackground: true` and `promoteOnTimeout: true` (`dsh-tool-bash/lib/index.js:340–342`). `startJob` at 390–422 creates a native `bash` producer with process output sources. `waitOnJob` at 424–490 can return `kind: "promoted"` before exit, and its abort path waits only `timeoutMs`. Binding this real producer is required; wrapping the tool promise alone cannot satisfy full result or hard-stop semantics.

Add one optional producer binding to the transferable tool execution context. It is supplied only by the native logged-root scheduler (or inherited beneath a transferable root), and is absent in ordinary native executions:

```ts
interface ToolBackgroundProducer {
  readonly jobId?: JobId; // existing producer job; absent for direct foreground
  readonly exited: Promise<void>; // actual owned resource range has exited
  readonly output?: readonly JobOutputSource[]; // direct foreground case
  cancel(reason?: string): void;
}
interface ToolRunContext {
  readonly background?: {
    readonly detached: boolean;
    bindProducer(producer: ToolBackgroundProducer): void;
    promote(): Promise<BackgroundAdmission>; // existing producer timeout only
  };
}
// Existing JobSpec / JobView addition, defaulting to ordinary native reporting:
// completionNotice?: "producer"
interface ShellManagedExecution {
  terminate(): void;
  waitForExit(signal?: AbortSignal): Promise<boolean>;
}
// ShellExecution.managed?: ShellManagedExecution
```

For a normal foreground Bash with this capability, keep the existing `startJob` and reuse its job ID. Bind immediately after registration, before any bounded wait. `waitOnJob` keeps its current timeout observation, but on timeout calls `background.promote()` and then continues awaiting the **actual canonical foreground value** instead of returning a promoted value. MOA may transfer the same activity earlier via its configured strategy. Producer timeout is an existing Bash rule, recorded as `producer-promotion`; it has timer-only same-turn semantics. If transfer fails, the body stays foreground and waits; it never loses ownership or manufactures a successful final result. No shell command is started twice. If background.detached is true, retain the native producer record instead of the existing waitOnJob removal: the model now holds its ID. A wholly foreground completion may keep the existing removal behavior.

Bash constructs the eventual value through its existing `canonicalBashResult(await process.result(), workdir)`, with existing sandbox/stopped facts. For these managed foreground calls, startJob also extends its producer done hook through the same managed-exit promise; cancellation forwards to both its preparation signal and the published managed handle. Bash awaits that exit as well before returning. Only this value reaches the original output schema/render/post/finalize pipeline. Its text, exit status, error and spill paths therefore describe the finished command, not the earlier promotion notice. On caller or job cancellation, signal the producer and await its actual exit without reusing the ordinary `registry.wait(...timeoutMs)` as an exit certificate. Preserve the original failure while joining cleanup.

For Bash configured with promotion disabled, retain its direct foreground path and hard timeout policy. After `shell.execute` yields a handle, bind its output readers and resource exit; a later MOA transfer registers one root job with these existing readers. Do not globally switch Bash to foreground-only or disable ordinary native background support. Explicit `run_in_background: true` remains an independent native job/handle operation: its immediate canonical handle is valid, its native reporter and job controls remain responsible, and it is not falsely relabelled as an automatically transferred foreground call.

The exact exit seam needs a small shell adapter, not a new process controller. Published `dsh-bash-local/lib/index.js:223–226,254–259,301–313` derives `ShellExecution.result()` from `SubprocessHandle.done`; that is spawned-command exit, whereas published `dsh-subprocess/lib/types/types.d.ts:174–182` already exposes `terminate()` and `waitForExit()` for the provider-managed range. Add optional `ShellExecution.managed` with those same two methods, forwarding directly to the captured native subprocess handle in `LocalBashExecutor.executeArgv`. For a no-spawn settled handle, terminate is a no-op and wait resolves true. `bash-sandbox` decorates the same returned handle and retains the capability. Do not change subprocess signalling or invent another timeout ladder.

MOA Bash binds `exited` to unbounded `managed.waitForExit()` and requires `true`; an observation failure is surfaced and cannot certify successful stop. Its cancel invokes `managed.terminate()` even when the root process has already reported exit (existing `ShellProcess.kill()` alone can then no-op). The shipped MOA composition requires the patched local/sandbox Bash providers; missing managed-exit capability is an activation incompatibility, not an implicit downgrade. Cancellation and teardown join body/wrapper completion **and** each bound resource exit. No new admission exclusion follows from retaining this receipt.

For bound Bash, keep native output pumping and use `jobs.get/readAt` to report running/stopping state, retained stdout/stderr deltas, lossy markers and spill locations through the MOA handle. Queries use their own offset and must not consume the producer's model cursor or lose its final value. Direct foreground readers use the existing `processSources` adapter at root job registration. Progress is the producer's native progress/status plus actual stream output, never an invented percentage.

A managed foreground Bash registers its native job with `completionNotice: "producer"`; a generic MOA root does likewise. jobs-local carries this field into JobView and published tool-jobs skips its status-only notice for those records. This per-job ownership leaves independent `bash` jobs and ordinary sessions unchanged, unlike excluding the entire Bash kind. MOA observes the canonical root result, not `job/settled` alone, and wakes only after the complete result is flushed. A bound job can settle before post-policy finishes; query reports that result finalization is pending until the canonical record exists. Native kill still targets the same producer ID.

A direct root adopts its one already-bound producer ID. A composite root such as run_code retains all descendant producer exit/cancel bindings, but uses one root job rather than picking one child ID; nested promote requests target that root and still return canonical values to the program. If a generic root transfer occurs before asynchronous producer preparation finishes, its job remains the root identity and a later binding adds that producer to its exit/cancel join, without changing the published handle. These are ordinary producer lifetimes, not queued sibling jobs.

There are no provisional multi-job admissions. Each root transfer either adopts its direct producer or starts one native root job. Generic registration still needs the single-call abort/registration race described above. A rejected transfer leaves that call foreground; it does not cancel unrelated siblings or start deferred bodies. Tool/preset unload must join accepted activities through native ownership; detaching a controller registration alone is not cancellation.

## Placeholder and history pairing

For each committed background outcome, append exactly one native `tool/result`, linked to its original `tool/call` sequence and original model `callId`, in the batch's normal result order. Use `createToolResultMessage` with ordinary Tool role and `isError: false`; content names the background handle and how to query/cancel it. Its metadata identifies the `BackgroundReceipt` and says execution remains pending. This is a scheduler acknowledgment, not an output-schema value or completed task. The original call receives no second surface Tool Message when its work later completes.

The model-facing `tool_call_id` accepted by the two background tools is the **opaque handle printed in this placeholder**. Encode the original owner/call sequence identity, not a raw provider call ID: this repository already establishes that provider ToolCallId can repeat across turns. The receipt preserves the provider ID separately. Resolve the handle against the calling Agent's session before native `jobs.get/wait/kill`; copied or forked history never transfers authority.

After canonical settlement, use native `appendPluginRecord` to append the log-only `plugin:moa/background-result` record, with the native `ignorable: true` envelope. Read it through `pluginRecordOf` and validate its payload. Do not add a required event to `SessionEventMap` or bypass the native unknown-event check:

```ts
interface BackgroundResultData {
  readonly receipt: BackgroundReceipt;
  readonly result: {
    readonly content: readonly ContentBlock[];
    readonly isError: boolean;
    readonly error?: ToolErrorInfo;
    readonly meta?: JsonValue;
  };
  readonly additionalContexts: readonly UserMessage[];
  readonly delivery: UserMessage; // stable native ID; exact full result message
}
```

Retain canonical model content rather than logging the execution-local raw success value, which native Tool results deliberately omit. The receipt plus event sequence identifies the delivery. The wake is a native user/context message containing the full real tool output and its original call identity; it is not a second unmatched Tool Message. `query_background_tool` returns its own matched Tool Message with the same recorded result. Stable delivery IDs, native pending evidence and committed model-facing receipt evidence provide deduplication across restart. `agent/inbox/claimed` is transient removal before asynchronous pre-step assembly, not consumption; claim alone cannot discharge the result obligation. A prior logged placeholder remains unchanged when the result arrives.

Session append and inbox splice are synchronous in-memory commits, not storage durability. Await `ctx.sessions.flush(session)` after the placeholder/result records and before reporting them durable or depending on their recovery. Await a flush after receipt admission; on failure retain the result obligation and surface the failure. Completion can beat placeholder logging after transfer. Hold its result delivery behind the placeholder commit gate; never expose a background result before its original tool/result acknowledgment. If placeholder append fails, do not open a new turn: cancel/drain the owned work and let native ToolCallRecovery repair missing results before closing the failed step. If terminal result append fails, release execution resources but surface the persistence failure and block result-dependent completion; a generic jobs status must not be misreported as a recorded full result.

Jobs are process-local. Restart does not resume a JavaScript promise or duplicate a tool invocation. Recorded completed results remain queryable from Session history. A claimed or Stop-cleared receipt without a committed model-facing receipt is re-admitted with its recorded identity on recovery/resume; native pending/consumption evidence prevents duplication. A recorded pending transfer with no live job after restart is reported as interrupted/unavailable, never running or successful; restoration must record that outcome before admitting dependent work. Fork preserves historical receipts as history only and cannot query/cancel the parent's job.

## Strategies and exact turn behavior

Configuration belongs to the plugin: After Seconds threshold, New Message threshold, LLM Judge threshold/model selection, and `background_on_message`. A timer starts from actual body dispatch, not approval or a not-yet-started sibling. Before its MOA strategy threshold a tool remains foreground unless its existing native producer promotion rule fires; `background_on_message: true` bypasses the threshold on eligible new inbox input. Unsupported/non-root calls remain ordinary native executions; this is not permission to omit supported Bash/build/test cases.

New Message inspects native unread next-step messages after its minimum runtime; LLM Judge evaluates that same identified snapshot after its threshold. A negative judgment leaves the call foreground and does not consume the inbox. Every newly inserted eligible message increments the observed revision and triggers another judgment; a pending judgment coalesces arrivals then rejudges the newer snapshot. Before applying an affirmative result, intersect the judged IDs with still-pending input and ensure the activity is still running. Removed/replaced messages cannot cause a stale handoff. Judge requests are plugin policy work using the native model service and owner cancellation, not an additional Agent Loop.

Explicit next-turn queued input remains queued; it is not treated as steering and does not by itself interrupt the old turn. The eligible batch is native next-step input. After a message-based transfer, the batch accumulates its confirmed triggering IDs and background receipts. Once every original call has either a committed real result or a committed background placeholder, `executeToolCalls` returns `handoff`. It does not abort remaining foreground siblings.

`ReactLoopAgent.turn()` handles handoff **immediately after that step ends and before `preStep`, `inbox.claim`, or `agent/turn-stopping` can run again**. It appends `turn/end` with `kind: "handoff"`, preserves the inbox without splicing/reinserting messages, resets per-turn step state and controller through the normal next-turn transition, and opens the next native turn if pending input exists. The new turn's first claim consumes the current complete next-step batch, retaining the existing rule for explicitly queued next-turn input. A handoff with messages removed before the barrier closes still closes the old turn but does not fabricate a new input or model call.

Timer-only transfer returns no handoff and no conclusion. After placeholders commit, the native loop runs its next inference in the **same turn**, even without new input. A timer transfer that wins before later message arrival does not retroactively become a message handoff; the later input follows normal next-step semantics. If a message-based transfer wins first, its cause and IDs remain authoritative even if its timer fires next. Calls completing before transfer return their actual result and do not invent a handoff.

Cancellation/error takes precedence over a requested handoff. Handoff takes precedence over a sibling's normal concludeTurn marker. Handoff and cancellation bypass Ralph/rubric normal-completion checks and must not enter the parent's successful Worker completion outbox. Their full committed assistant history remains available; no assistant text is fabricated to close a handoff. Normal final-answer completion and its end-of-loop inbox race checks retain their existing/Task 6 semantics.

## Full-result delivery and model controls

The MOA controller attaches through `jobs.attachController`, registers native job kind `moa-tool`, and exposes:

```ts
query_background_tool({ tool_call_id: string, wait_timeout?: number })
cancel_background_tool({ tool_call_id: string })
```

`wait_timeout` is seconds; absent/zero is a status read. Positive finite waits are converted to the validated configured native wait bound. Waiting uses `jobs.wait` and, if producer settlement precedes root finalization, the retained root result promise within the same remaining deadline and caller signal; timeout or caller abort never cancels the job. The query returns running/stopping state or the complete durable result, repeatably. A cancellation returns requested/already-finished plus the current state; it never claims killed until the producer exits. Errors and failed policy outcomes preserve their original content and structured error metadata.

After canonical root settlement and successful result flush, the controller delivers the full result using `owner.send(delivery, "next-step", true)` (equivalently native `steer`), avoiding a status-check/inject race. Busy owners consume it at the next permitted step; idle owners wake; an aborted activity parks it for the next turn. Disposal has no reader and does not wake. Delivery never uses a wake budget for an uncollected MOA result. Explicit KillAgent/disposal parks delivery under the cancellation policy below, preserving the durable result for deliberate resume. A query does not automatically suppress this receipt merely because `jobs.wait` reports `awaited`: native jobs reports waiter release, not that a query Tool Message committed. Deduplication may withdraw a still-pending receipt only after a successful query's result commit is known; a failed/aborted query must leave the wake available.

The per-job `completionNotice: "producer"` reporter rule above replaces the earlier excluded-kind configuration proposal. Native job listing, output and kill tools remain available with their ordinary policy. The MOA reporter does not suppress real-result delivery just because a native waiter received terminal job status.

## One cancellation join, with or without continuation

Implement `Agent.cancelAndJoin(cause, { continuation? })` in the native phase owner. Both standalone KillAgent and hard-interrupt-with-new-direction call this same method. It reserves the cancellation boundary even when the foreground driver is idle but transferred jobs exist, clears old pending direction once, invokes ordinary foreground cancellation, cancels this Agent's transferred/bound MOA root activities, and joins their actual body/wrapper/finalizer and producer resource-exit promises. Independent explicit native background jobs retain native ownership/control behavior; a producer bound to a transferred root is part of this join.

The old batch drains started foreground calls and repairs missing Tool Messages with ToolCallRecovery before step/end and turn/end. Flush the repaired history before resolving the join or admitting replacement work. During the join, later waking sends are stored in the native inbox but cannot open another driver. A producer that ignores cancellation keeps the Agent Aborting; registry forced-failure or elapsed timeout does not resolve this barrier. Observation/persistence failure is reported and must not produce Zombie or admit dependent execution.

`moaHasPendingBackground` derives from the native transferred activities and the one installed controller's existing result obligations. The controller callback reuses its pending canonical retry map and Session receipt/committed-message evidence; it is cleared on disposal. Native child settlement consults the getter so an idle foreground driver cannot dispose a Worker whose background work still needs to return. Persistence failure retains the result obligation without pretending its process is still running. After a successful explicit stop, a fully persisted result may remain parked for deliberate resume without occupying a live execution slot.

With **no continuation**, resolve only after actual exit and history flush. Do not fabricate a message or open a turn. The plugin then derives Zombie from that completed stop; the Session/workspace remain intact. Later messages received during the join stay parked, including cancelled-tool result receipts; they cannot immediately undo KillAgent. A new explicit wake/resume submitted after the stop completes can resume the Agent using the existing native send path. Store any undelivered canonical results for that resume. Disposal uses the same join without waking and then disposes the owner.

With **continuation**, after the same exit/repair barrier, admit that exact replacement ahead of messages received during the join, flush admission, and open the normal native driver with a fresh AbortController. Preserve later messages; never clear the inbox twice. Resolve after this admission checkpoint, not after the replacement turn completes. Concurrent requests share the native phase reservation and arrival ordering; they cannot start overlapping drivers.

Ordinary `Agent.cancel` remains the existing synchronous native Stop request and keeps its established foreground/inbox policy, including native independently backgrounded work. It does not claim the stronger joined stop. KillAgent and hard continuation explicitly use cancelAndJoin; the plugin must not derive Zombie from a foreground idle snapshot or `whenIdle()`. Query/cancel background controls require no scheduling exemption because the proposed owner-wide lock has been removed.

## Audited patch inventory

| Published package/files | Required change |
| --- | --- |
| `dsh-tools/lib/index.js`, `lib/types/index.d.ts` | Transferable activity relay and cleanup; scheduler activity and producer binding; preserve existing scope isolation patch |
| `dsh-agent-loop/lib/index.js`, `lib/types/tool-calls.d.ts`, `lib/types/agent.d.ts` | Root outcome/placeholder path; single-root job transfer/adoption; existing foreground batch barrier; exact handoff branch; shared stop/continue join |
| `dsh-agent/lib/types/runtime-types.d.ts` and affected emitted runtime export artifacts if any | Public Agent method and scoped event declarations; no guessed runtime stub |
| `dsh-session/lib/types/types.d.ts` or explicit plugin declaration merge | Handoff reason; review readers that exhaustively project TurnEndReason; no unnecessary session-format rewrite |
| `dsh-tool-bash/lib/index.js` | Bind its existing producer; keep awaiting canonical final output; map native promotion to root transfer; unbounded actual-exit join; native output/readers and per-job reporter ownership |
| `dsh-shell/lib/types/types.d.ts` and exported type declarations | Optional ShellExecution.managed forwarding capability, using existing subprocess termination/exit semantics |
| `dsh-bash-local/lib/index.js` and emitted `lib/types/index.js` if that export is consumed | Forward captured subprocess terminate/waitForExit; retain capability through existing bash-sandbox decoration (no new sandbox policy) |
| `dsh-jobs/lib/types/{types,view}.d.ts`, any corresponding published type reexports; `dsh-jobs-local/lib/index.js` | Add/copy optional per-job completionNotice reporter ownership; no new registry lifecycle or scheduling operation |
| `dsh-tool-jobs/lib/index.js` | Skip status-only completion notices for producer-owned delivery; leave independent jobs unchanged |
| Plugin source/config/declarations | MOA strategy policy, jobs controller, full-result event/read/wake, two controls, lifecycle/completion projection, exact native adapter and required dependency composition |

The local-source reference equivalents are `packages/core/tools/src/{index,contracts,pipeline,batch,schema}.ts`, `packages/core/agent-loop/src/{agent,inbox}.ts`, `packages/core/agent/src/runtime-types.ts`, `packages/jobs/{jobs,jobs-local,tool-jobs}/src/*`. They must not be mutated as part of plugin compatibility work. The only jobs-local addition is copying reporter ownership metadata; existing registration, capacity, wait, kill and teardown remain authoritative. No subprocess provider patch is proposed: its existing terminate/waitForExit supplies the missing exit evidence. Exact emitted leaf files and exports must be enumerated before generating patches.

For each actual npm/desktop runtime artifact, implementation must record exact before/after hashes, reversible patch and declaration counterparts in `compat/rc3/manifest.json`; unsupported hashes fail preflight. The existing tool-isolation patch must compose rather than be overwritten. Include launcher backup/rollback/idempotence checks, fresh runtime dependency composition and clean npm/Git consumer declarations. Enumerate actual changed files from inspected package exports; do not assume local source filenames are shipped. Follow any affected native UI/SDK/history discriminant consumers rather than treating a new turn reason as automatically understood.

## Focused native acceptance cases

Tests must run the installed patched native registry, loop, Session and jobs provider; plugin-only promise mocks cannot certify these obligations.

| Case | Required observation |
| --- | --- |
| Timer, New Message, Judge and bypass | Real held tool promise; exact threshold behavior; pre-threshold background_on_message; false judge followed by new unread message and affirmative rejudge; no inbox claim by judging |
| Output schema and policy | Strict scalar/object output tools accept scheduler placeholder without schema forgery; actual result passes original schema; deny/ask/block/timeout/project/finalize hooks retain authority; tools/result observes exactly one actual outcome |
| Timer continuation | Placeholder is a paired native Tool Message; subsequent model request uses the same native turn number |
| Message handoff | At least two foreground siblings finish in reversed wall-clock order; all call/result pairs commit before old turn/end; new unread batch first reaches inference in the new turn; handoff is not completed |
| Transfer races | Real completion, abort, capacity failure, reentrant registration observer, timer and message race; exactly one ownership path, no orphan promise, no duplicate body/result |
| Real locked Bash promotion | Run patched locked tool-bash with real native shell/jobs, with native promotion timeout shorter than command duration. One producer ID is adopted; placeholder permits same-turn work; final query/wake contains actual exit code and final output, never merely promoted. Running query includes real output/progress. Ordinary and explicit background Bash keep their original reporter |
| Real locked Bash delayed cancellation | Cancellation cleanup exceeds Bash ordinary wait timeout; stop/join remains pending until managed resource range exits. Include root process exit before a surviving managed child, and verify neither body result nor root done alone certifies stop |
| Native batch ordering | Exclusive/parallel classifications and sibling result order remain unchanged until each call settles or transfers; later ordinary tools can run while background work continues, with no extra queued jobs or hidden global lock |
| Nested/program calls | Root run_code transfer retains nested policy, cancellation and logs; subcall values stay canonical; no placeholder values enter a program and existing nested concurrency is retained |
| Complete result wake | Nonempty, empty, large text, structured error and nontext content survive durable result event and actual next LLM request; owner idle/busy/aborting; exactly one automatic MOA receipt and no status-only duplicate |
| Query, wait, cancel | Running/read/terminal repeated query; timeout leaves work alive; aborted waiter still gets later receipt; killed state only after cleanup; foreign/forked handle denied; repeated provider call IDs do not alias |
| Standalone KillAgent | Foreground idle plus active transferred Bash; no replacement input; delayed cleanup keeps Aborting, then Zombie only after actual exit/repair flush. Later messages park during join; no empty/new turn is fabricated |
| Hard abort/continue | Same shared join; no replacement inference before old body/wrapper/finalizer and managed-resource exit plus repair flush; later messages preserved; fresh signal; native Stop remains intact |
| Persistence and recovery | Inject flush failures; crash after placeholder, result append/before flush, inbox admission and claim/before committed model receipt; no reexecution or duplicate receipt; missing native job reported interrupted; forks cannot inherit execution ownership |
| Composition and teardown | Actual locked jobs provider and controller loaded once; missing capability fails activation; owner/plugin/runtime disposal drains resources and removes effects; ordinary sessions and native job reporting unchanged |

Independent review must resolve any interface or ordering defect before patches begin. The result of this document is a concrete proposed native change, not evidence that any of these acceptance cases already pass.
