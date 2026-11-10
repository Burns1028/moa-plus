# Native execution compatibility for DSH 0.2.2-rc.1

The `rc2` directory names the 0.2.2 compatibility family. The inspected Desktop Next artifacts are **0.2.2-rc.1**. Versions and exact original/final hashes are recorded in the manifest; a version string alone is insufficient evidence of compatibility. The existing rc.3 patches remain unchanged.

## Preserve the current native owners

In this release `dsh-tools/pipeline` owns `ToolExecutionPipeline`, `executeToolBatch`, `runGroup` and `BatchSettlement`. Native and PTC executors call that shared pipeline. `dsh-agent-loop` consumes a complete batch through `tools.execute`. The compatibility extension modifies these existing owners; it does not replace them with the old rc.3 scheduler, create an alternate executor, or add an owner-wide tool lock.

The execution contract in [native-moa-contract.md](native-moa-contract.md) still applies: one admitted invocation, one cancellation authority at a time, one canonical final result, and actual managed-resource exit before a joined stop or replacement direction. `dsh-agent`, `dsh-session`, `dsh-jobs` and `dsh-shell` need no runtime stubs: their additive MoA interfaces describe behavior implemented by the loop, pipeline, jobs provider and shell provider. The Desktop artifacts omit TypeScript declarations; this profile currently targets their runtime files.

## Narrow additions to the current pipeline

- A logged, MoA-enabled root receives an owned abort relay before native pre-policy. Approval, wrappers, body, output validation, post-policy, projectors and finalizers keep the existing pipeline and correlation identity. Ordinary unlogged calls and nested program calls return canonical results.
- The existing batch preserves ordered policy/result commits, rolling concurrency and foreground sibling barriers. A background placeholder is a batch scheduler outcome: it never enters the tool's output schema or result observers. The eventual complete result passes the original pipeline once.
- Each prepared transferable execution is associated with its actual pipeline. `TOOL_RUNTIME_SCHEDULER.start` routes to that pipeline rather than maintaining a second execution path.
- A started root holds a snapshot of its step's already admitted ToolSet. The new native loop disposes the step ToolSet after batch settlement; this snapshot permits the same root's later output normalization and PTC child calls to finish after transfer. It adds no capabilities admitted by a later step and does not reopen the disposed ToolSet for other callers.
- The optional executor `source.reject` callback receives the resolved definition as its third argument. Existing two-argument callbacks retain their behavior; PTC can reject native-only tools inside programs while admitting their direct native schemas.
- Scope-local suppression removes the current Agent's own and inherited named capabilities, without propagating that mask to Workers. Definition metadata carries `nativeOnly`, `backgroundOnMessage` and `supportsBackgroundProducer`.

The pipeline uses the native SessionStore's existing `flush` checkpoint before acknowledging a placeholder. Executor contexts acquire that service through `ctx.get('sessions')`, respecting Cordis 4.1's declared-injection boundary.

## Background ownership, results and cancellation

The root reuses a bound Bash producer job where one exists; otherwise the existing LocalJobRegistry admits the already running invocation as one `moa-tool` job. Registration failure, exhausted capacity, settlement or cancellation retain foreground ownership. Only successful admission unlinks the old turn's abort relay. The native job record carries `completionNotice: 'producer'`; the ordinary jobs reporter skips that record before reading or publishing a second completion notice. Independent native jobs retain their existing reporter, read, wait and cancellation behavior.

`agent/tool-activity-started` exposes a contained request capability to plugin policy. `agent/tool-background-result` carries the complete canonical result after its placeholder checkpoint and producer exits. The existing plugin controller retains durable result receipts and retry/deduplication responsibility; a terminal registry status alone never substitutes for that full result.

Timer/producer-promotion transfer continues within the same native turn. Message/judge transfer returns a `handoff` outcome only after every foreground sibling commits; the old native turn closes before unread input reaches inference in a new turn.

The loop's `cancelAndJoin` reserves the existing cancellation phase, aborts the foreground driver and all owned MoA roots, and joins their real body/wrapper/finalizer and producer exit promises. It then flushes repaired history. Incoming input remains parked during the join. A standalone stop creates no prompt or turn; an explicit continuation is admitted ahead of parked input with a fresh driver signal only after the exit/flush barrier. The existing rc1 teardown's `keepInbox: !ready` behavior is preserved for unsuccessful initial attachment. A failed observation or flush leaves the join unresolved/rejected rather than certifying a stopped Worker.

Local Bash exposes the captured native subprocess handle's `terminate` and `waitForExit` as `ShellExecution.managed`. Foreground Bash binds its existing producer, awaits its canonical process result and the unbounded real exit observation, and retains adopted job ids. Explicit `run_in_background` stays an ordinary native job. No subprocess signalling ladder, sandbox downgrade or duplicate process launch is added.

## PowerShell variants

The nonpersistent `dsh-tool-pwsh` has the same native jobs/promotion shape as Bash. Its extension uses the same owner-scoped producer admission and canonical-result/managed-exit join, backed by `dsh-pwsh-local` forwarding the existing subprocess handle. A native promotion reuses the existing `pwsh` job and does not certify completion until its real DTO and managed range settle. Explicit native background PowerShell retains its ordinary job ownership.

The default persistent `pwsh` tool is different: it operates an owned PTY through `terminals`, returns a string and has no Bash producer job. A generic root transfer keeps awaiting its existing command operation. Its cancellation path awaits the native terminal reset/kill and backend close; it is not marked as a Bash-style producer.

Persistent PowerShell's native wrapper already generates a fresh random nonce and computes structured `complete.exitCode` from its own end marker. The tool now retains those facts under the pipeline-minted Symbol execution token until its canonical output is projected. The existing `output.presentationMeta(args, value)` callback receives the prepared execution as an optional third argument, preserving two-argument callbacks. The persistent definition emits `meta.nativeShell = { kind: 'pwsh', completed: true, exitCode, signal: null, timedOut: false, aborted: false }` only from that confirmed completion branch. Timeout, abort, session exit and stdin-read outputs set `completed: false`; missing status does not become exit zero. Facts are consumed/deleted at metadata projection and cleared on execution failure. Public string value and rendered content remain unchanged. Completion review consumes this metadata paired to the actual native call/result, never a parsed rendered success message.

The persistent PTY backend currently has no reviewed implementation of path-specific Worker record protection. Before obtaining or sending to a terminal, the tool resolves the actual owner's current native Session policy. Any `readOnlyPaths` contribution rejects with `ReadOnlyPathUnsupportedError` before terminal spawn, including full-access mode. This preserves the Coordinator's notes/archive boundary; an unrestricted Coordinator remains able to use persistent PowerShell. It does not claim Windows Worker shell support by routing around the restriction.

## Focused verification

Run `tests/compat/rc2-execution.test.mjs` with `MOA_COMPAT_MODULES` pointing to a disposable prepared runtime's `node_modules`. The test runtime additionally installs the matching native AgentLoop testkit, which is not a production dependency or part of the compatibility manifest.

These scripted checks use the real rc1 AgentLoop, ToolExecutionPipeline, NativeToolExecutor, SessionStore and LocalJobRegistry. They exercise timer continuation and complete output after step disposal; message handoff and model-order pairing; delayed cleanup and parked input; native capacity refusal without re-dispatch; and hard continuation ordering. Additional native PowerShell-tool checks use controlled process/terminal providers to inspect producer adoption, delayed managed-exit cancellation, string/metadata compatibility, partial-output refusal and protected-record rejection before spawn. They do not establish real-model collaboration quality or OS sandbox acceptance, which require the separate application and platform checks.
