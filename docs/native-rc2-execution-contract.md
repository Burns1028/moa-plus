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

The active preset determines the PowerShell provider. The inspected Desktop base and Standard/PTC presets select nonpersistent `dsh-tool-pwsh`, whose default foreground execution uses the native jobs controller and promotion path. The persistent `pwsh` tool is different: it operates an owned PTY through `terminals`, returns a string and has no Bash producer job. A generic root transfer keeps awaiting its existing command operation. Its cancellation path awaits the native terminal reset/kill and backend close; it is not marked as a Bash-style producer.

Nonpersistent PowerShell retains a preparation exception in that invocation's `startJob` closure while the existing job owner records its ordinary failed status and detail. A foreground settlement with no process rethrows that same exception, preserving native `HarnessError` name/code and cause through the canonical tool pipeline; it does not reconstruct an error from console text or job detail. Both ordinary and managed foreground paths retain this identity, and an undetached managed failure removes its settled job before returning. Explicit background-job DTOs, permissions, cancellation and process-exit ownership remain unchanged. The manifest accepts both original runtime bytes and the previously patched runtime through separate full/upgrade variants that converge on the same final hash.

Persistent PowerShell's native wrapper already generates a fresh random nonce and computes structured `complete.exitCode` from its own end marker. The tool now retains those facts under the pipeline-minted Symbol execution token until its canonical output is projected. The existing `output.presentationMeta(args, value)` callback receives the prepared execution as an optional third argument, preserving two-argument callbacks. The persistent definition emits `meta.nativeShell = { kind: 'pwsh', completed: true, exitCode, signal: null, timedOut: false, aborted: false }` only from that confirmed completion branch. Timeout, abort, session exit and stdin-read outputs set `completed: false`; missing status does not become exit zero. Facts are consumed/deleted at metadata projection and cleared on execution failure. Public string value and rendered content remain unchanged. Completion review consumes this metadata paired to the actual native call/result, never a parsed rendered success message.

The persistent PTY backend currently has no reviewed implementation of path-specific Worker record protection. Before obtaining or sending to a terminal, the tool resolves the actual owner's current native Session policy. Any `readOnlyPaths` contribution rejects with `ReadOnlyPathUnsupportedError` before terminal spawn, including full-access mode. This preserves the Coordinator's notes/archive boundary; an unrestricted Coordinator remains able to use persistent PowerShell. It does not claim Windows Worker shell support by routing around the restriction.

## Windows process protection lifetime

The narrow existing-record and native-atomic-write contract is specified in
[Worker record ownership](native-rc2-memory-contract.md#windows-boundary).
The current native filesystem already preserves target DACLs during
`ReplaceFileW(flags=0)`; the filesystem/ACL owners add secure initial staging,
owner-rights handling and active mutation guards to that boundary.

The existing Windows ACL owner supplies the protection contribution for the
Session/workspace's existing private-temp SID. `dsh-sandbox-local` acquires it
through a declared native filesystem capability before it returns confined argv.
The confined-command result may carry an optional owned cleanup capability.
Acquisition requires an explicit native consumer acknowledgement of that
cleanup/exit contract; a consumer that does not implement it refuses before
installing ACL contributions. PTC, workspace command and terminal callers must
not silently ignore an optional cleanup field.

The declared native signature is
`confine(argv, policy, signal?, { processLifetime: 'managed' })`. A Windows
protected-record result carries `cleanup(): Promise<void>` and
`bindProcessLifetime(lifetime: Promise<void>): void`. Before target admission,
the consumer binds its single existing preparation/range/cleanup promise to the
lease; late preparation and virtual deadline handles retain that same owner.
The provider awaits this exact promise during teardown. Rejection remains a
failure with protection retained, rather than becoming evidence of exit.
An unbound/live contribution prevents capability revocation.

Every cleanup-bearing execution sets the native
`SubprocessSpawnSpec.requireManagedRange: true`. The local subprocess owner
refuses before starting the target if its selected containment is the weaker
fallback; ordinary executions retain their existing fallback behavior. A
managed-shaped handle or a successful earlier probe is not sufficient proof.
The actual Windows Job range remains the execution owner.

The existing Bash/PowerShell sandbox executors retain the contribution in their
per-process facts and release it only after the managed execution range is
empty. The ACL runner's direct child exit, `proc.done`, `onProcessDone`, and
kill-on-close initiation do not independently establish descendant exit;
`ShellExecution.managed.waitForExit` must supply the native Windows job-range
barrier. Completion hooks may begin that join but cannot release protection
early. A
preparation rejection, cancellation before spawn or spawn failure releases the
untransferred contribution; after a process is admitted, only its real exit
boundary can release it. An adopted producer/background job retains the same
owner. No placeholder, timeout, rendered result or terminal job status alone
counts as exit, and cleanup errors remain part of native failure/join handling.

The local executor races asynchronous preparation against abort/deadline. A
confine result arriving after that race is lost must still be released by its
preparation owner before it can be forgotten. Once transferred to a process,
start one uncancelled managed-exit/cleanup promise and retain it through provider
teardown. A failed/false exit observation is not proof of an empty range and
must not release protection. Observe early promise rejection without discarding
the original failure; native join/teardown must await and report it.

The protection does not disappear after approved permission escalation. The
existing runner's `read-only`/`workspace-write` mode and its reported enforcement
remain truthful; an unsupported full-access/extra-root policy must not be
silently re-labelled, or gain unconfined execution, to bypass record protection.
Whole-workspace read-only execution is not a substitute for required build/test
writes. Native Windows CIM, PowerShell language-mode, pipe, alias and sandbox
enforcement limits require actual task evidence rather than a successful trivial
command. The persistent PTY provider remains a separate unsupported owner until
its own lifecycle and path-protection implementation are reviewed.

The expected runtime owners are `dsh-sandbox-windows-acl` (its ACL/grant internals
and any necessary export), `dsh-sandbox-local`, `dsh-fs-local`, and the existing
`dsh-bash-sandbox`/`dsh-pwsh-sandbox` process facts and completion hooks. Any
optional confined-command cleanup type or filesystem service capability must be
declared at its existing native seam. New imports require explicit package
metadata and audited hashes; no new execution loop, plugin protection scheduler,
global Symbol protocol or undeclared cross-package lease registry is permitted.

Cordis 4 optional lifecycle dependencies use real `ctx.inject` child scopes:
the subprocess provider's sandbox-dependent scope joins its existing managed
processes before the sandbox capability disappears, and the sandbox's
filesystem-dependent scope retains the actual filesystem mutation owner through
release. Neither provider declares the unsupported `{ optional: [...] }`
injection syntax. The bound lifetime joins asynchronous cleanup before temp-SID
revocation, including background processes whose foreground result is unread.

The inspected runtime has these process-confine consumers. Every restricted
consumer must implement the lifecycle or refuse before acquiring protection;
the six-owner core change alone must not imply that all callers are supported.

| Consumer | Required ownership boundary |
| --- | --- |
| `dsh-bash-sandbox`, `dsh-pwsh-sandbox` | Retain per-process protection until the existing managed range exits, including adopted jobs and failed startup. |
| `dsh-ptc-runtime-node` | Does not acknowledge Windows lease ownership and therefore refuses protected Windows use before acquisition. Supported non-lease backends retain protection for the persistent process; retained policy comparison includes protected paths. |
| `dsh-terminal-bash` | Persistent PTY lifetime is separate; returning only confined argv cannot transfer cleanup ownership. Refuse protected use until that lifetime is implemented. |
| `dsh-experimental-worktree`, `dsh-experimental-client-ui-forge` | Do not acknowledge Windows lease ownership and therefore refuse protected Windows use before acquisition. Their full-access paths still honor protected paths. |
| MoA `workspaces.ts` Git and fixed-Node commands | Use the native managed subprocess exit boundary for any acquired protection; raw `execFile` completion is insufficient. |

Any `danger-full-access` fast path must also inspect `readOnlyPaths`; standing
mode alone never authorizes bypassing record ownership. The similarly named
private `dsh-api-workspace-files.confine` resolves paths and is not a process
sandbox consumer.

## Focused verification

Run `tests/compat/rc2-execution.test.mjs` with `MOA_COMPAT_MODULES` pointing to a disposable prepared runtime's `node_modules`. The test runtime additionally installs the matching native AgentLoop testkit, which is not a production dependency or part of the compatibility manifest.

These scripted checks use the real rc1 AgentLoop, ToolExecutionPipeline, NativeToolExecutor, SessionStore and LocalJobRegistry. They exercise timer continuation and complete output after step disposal; message handoff and model-order pairing; delayed cleanup and parked input; native capacity refusal without re-dispatch; and hard continuation ordering. Additional native PowerShell-tool checks use controlled process/terminal providers to inspect producer adoption, delayed managed-exit cancellation, string/metadata compatibility, partial-output refusal and protected-record rejection before spawn. They do not establish real-model collaboration quality or OS sandbox acceptance, which require the separate application and platform checks.
