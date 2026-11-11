# MoA tool API

This describes the MoA+ v0.2.0 runtime. The published v0.1.23 preview used `control_workers`; that name remains in backend compatibility paths and historical records, but is no longer mounted as a model tool here. Native DSH still owns execution, permissions, inboxes, and Session history.

The Coordinator receives `Task`, `Fork`, `SendMessage`, `QueryAgent`, and `KillAgent`. Every managed participant receives `SendMessage` and `ProjectContext`. A Worker gets the creation/query/kill controls only when its creator explicitly enabled `nested`. Alternative native delegation entries are suppressed in the participating scope; ordinary conversations are unaffected.

## Task

Start one to twenty clean-history native continuable Agents. A successful result is an array of accepted message/Worker receipts, not completed work.

```json
{
  "tasks": [
    {
      "name": "implementation",
      "task": "Implement the requested feature, run its checks, and report the evidence.",
      "role": "General-purpose",
      "workspace": "isolated"
    },
    {
      "name": "review",
      "task": "Review the specification independently and identify acceptance criteria.",
      "role": "Planner",
      "workspace": "shared"
    }
  ]
}
```

| Task item | Meaning |
| --- | --- |
| `name`, `task`, `role` | Required label, complete assignment, and role. |
| `workspace` | `isolated` by default; `shared` explicitly uses the creator's cwd. |
| `reportTo` | Optional active member ID; defaults to the creator. |
| `nested` | Defaults to `false`; explicitly permits this child to create/manage a further team. |

Role names are exactly `Explorer`, `Planner`, `Deep Research`, and `General-purpose`. Explorer and Planner expose the native `glob`, `grep`, and `read` execution tools. Deep Research exposes `web_search` and `web_fetch` when installed. General-purpose retains native execution tools. Communication and shared-context tools remain available in each role; role selection does not grant extra filesystem authority.

The twenty-item limit is a tool batch limit. Native runtime capacity is a separate limit and can reject additional resident Agents. Isolated execution needs a Git worktree-capable source and permitted Git resources. It snapshots staged, unstaged, and untracked current content without changing the source index. Shared execution is the explicit alternative when isolation is unsuitable.

Identity is injected into conversation history before the Task assignment. It states the child's real ID, cwd/isolation, reporting target, and reporting/shared-memory instructions. It is not a per-child System Prompt rewrite.

## Fork

Fork a selected member's committed native history into a fresh child identity. The source, native creator, and reporting target are separate facts.

```json
{
  "source": "<source-session-id>",
  "name": "alternative-approach",
  "task": "Try the alternate implementation and compare its evidence.",
  "role": "General-purpose",
  "workspace": "isolated",
  "reportTo": "<review-leader-id>"
}
```

Fork accepts the same item fields as Task, plus required `source`. Its single result is an accepted receipt. Native fork-seed preparation repairs open history tails; the new identity follows the inherited history and precedes the new assignment. Pending native admission retains the seed for recovery; confirmed admission leaves the copied history in the child Session and removes that temporary duplicate.

## SendMessage

Point-to-point communication within the enabled MoA family:

`SendMessage` is always a direct native tool call, including with a PTC Agent preset. Its schema appears beside `run_code`; it is absent from the program SDK. This keeps a Request's original result and turn intact through waiting, interruption, and persistence. Ordinary program tools retain PTC and background execution.

```json
{"target":"<worker-id>","message":"Prioritize the error state.","delivery":"steer"}
```

```json
{"target":"<worker-id>","message":"After this turn, check keyboard navigation.","delivery":"queue"}
```

| Argument | Contract |
| --- | --- |
| `target`, `message` | Required receiving member ID and nonempty message. |
| `mode` | `notify` by default, or `request`. |
| `delivery` | `steer` by default, or `queue`. Steer targets the next safe step; queue remains a later native turn. |
| `timeout_ms` | Required for Request; positive integer milliseconds, at most 86,400,000. |
| `reply_to` | Explicit Request ID to answer. A reply uses Notify, not Request. |

Notify returns after native acceptance. It can wake a retained Agent. Steer is a soft insertion and does not cancel the tool currently executing. The native pre-step consumes the full eligible next-step batch; it does not spend five model rounds consuming five messages one at a time. Explicit next-turn input stays queued.

A Request waits **inside its current Tool Call**. That is still `Running`, not task completion or Zombie:

```json
{"target":"<coordinator-id>","message":"Which migration is approved?","mode":"request","timeout_ms":30000}
```

The receiving message contains its Request ID. Answer explicitly:

```json
{"target":"<requester-id>","message":"Use migration B.","mode":"notify","reply_to":"<request-id>"}
```

The waiting Tool Result is one of:

- `answered`: includes `requestId` and the full `answer`.
- `interrupted`: another eligible message returned control before the answer.
- `timeout`: the wait deadline passed.
- `downgraded`: a wait cycle was detected; the message was admitted as nonblocking Notify.

The broker persists routing and operation receipts. A late explicit reply becomes an ordinary inbox message and can wake the sender; it is not discarded or guessed from sender identity. Repeated tool operation identities do not repeat accepted input. New unread input is reconsidered during a pending wait; the lightweight native judge does not consume that inbox. The Request ID correlates communication; it is distinct from the native Tool Call ID.

Cold targets are restored through the actual durable parent chain. Intermediate cold parents receive no invented prompt or false completed task. Cross-family target IDs do not grant access.

## QueryAgent

Inspect direct managed children without running a model:

```json
{}
```

```json
{"ids":["<worker-id>"],"history_offset":10,"history_limit":20}
```

```json
{"ids":["<worker-id>"],"wait":"selected","timeout_ms":30000}
```

`ids` defaults to all visible direct children. `wait` is `all` or `selected`; omitted means an immediate query. A waiting query returns on selected completion, eligible incoming next-step input, native cancellation, or timeout. Its default timeout is 30,000 ms. The waiting caller derives `Waiting`; Request remains `Running`. Explicit next-turn queue input does not interrupt this wait. Protocol waits own their exit conditions and are not transferred by the generic slow-tool background policy.

Results contain `children`, optionally `history`, and a wait `reason` of `done`, `interrupted`, or `timeout`. Each child's view includes native activity, availability, display phase, and derived `lifecycleState`: `Idle`, `Running`, `Waiting`, `Aborting`, or `Zombie`. A cold retained Session can be resumed; cold is not an unavailable/offline permission state.

`history_offset` and `history_limit` must be supplied together as nonnegative integers. They index committed visible dialogue from newest to oldest: offset zero is the latest message; offset ten and length twenty reads positions 10–29. Zero length or an offset past the available messages returns an empty window. There is no default hundred-message read or byte clipping.

Each history page contains `workerId`, current `status`, `offset`, `limit`, `total`, `messages`, and `observedThroughSeq`. Message entries include relative `index`, native `id`, `seq`, `turn`, `role` (`user` or `assistant`), and full visible `text`. The view includes committed human input, managed assignments, MoA messages, and intermediate/final visible AI replies. It excludes inherited Fork history, system/runtime instructions, reasoning, internal notices, and tool calls/results. Incoming messages can shift later relative indices. Pending inputs remain available in activity views until committed.

Messages with files or images also include `attachments`: entries contain `type`, the original native `attachment` reference (ID, name, byte count and image metadata), and a native readable `path` when available. Text stays verbatim, including an empty string for an attachment-only message; attachment-only AI replies remain visible. No file contents, image bytes or base64 are copied into a query. Recent human-input activity and the Workers timeline retain the same references. Reading a returned path uses the calling Agent's ordinary native tool permissions.

In a matching runtime, a user can open a retained Worker, select/paste/drop files in its native composer, and send them with text or alone. File uploads are staged for that exact receiving Session; sibling or parent receipts cannot be reused. The visible Worker uses the existing native residency borrow while the view is open. Native steer/queue and images retain their behavior. These additions require this checkout's [attachment compatibility contract](native-worker-attachments-contract.md); the published v0.2.0 runtime retains the earlier child-file restriction.

Reads do not wake Workers or create capsule participation. Deleted members and failed-creation placeholders are omitted. An existing Worker whose execution failed remains visible.

## KillAgent

Stop a direct child and await actual native execution cleanup:

```json
{"id":"<worker-id>"}
```

By default, history and workspace are retained. The Agent is `Aborting` during cleanup and can become Zombie only after cleanup completes. Later SendMessage can continue it.

```json
{"id":"<worker-id>","continue_with":"Stop the old approach and implement the smaller migration."}
```

`continue_with` admits the replacement only after the old driver/resources exit, history receives any missing Tool Results, and the abort signal is cleared. It does not race the new wake against old cleanup.

```json
{"id":"<worker-id>","destroy":true}
```

`destroy` explicitly removes membership and cleans its owned isolated worktree. It never removes a shared source directory. `destroy` and `continue_with` cannot be combined. Deleted Workers disappear from active queries, timelines, and all capsule seats; native Session history and recovery facts remain.

## ProjectContext

Read or replace a file relative to the project's actual shared context directory, including from an isolated Worker:

```json
{"action":"read","path":"decisions.md"}
```

```json
{"action":"write","path":"decisions.md","content":"# Decisions\n\nUse the accepted API contract.\n","version":"<version-from-read>"}
```

A read returns content and its current version; a missing/non-file path returns `moa/context-file-not-found`. Replacement requires that version; omit it only for creation. A concurrent modification rejects the stale replacement so the Agent can reread and merge. Keep `index.md` current. Paths cannot escape the context directory, and this tool does not write `notes.md` or `archived.md`. The acting Agent's native filesystem mode remains authoritative.

## Background tools

`query_background_tool` and `cancel_background_tool` are scoped to managed participants:

```json
{"tool_call_id":"<opaque-handle>","wait_timeout":10}
```

Query uses the opaque handle returned in a background placeholder, not a guessed bare model call ID. `wait_timeout` is seconds, defaults to zero, and is bounded to 300 seconds. Query returns repeatable full canonical results after completion, or actual native job status/progress and output. The same handle cannot be used by another owner.

```json
{"tool_call_id":"<opaque-handle>"}
```

Cancel requests cancellation of that owned native job. `stopping` remains visible until its resource actually exits. It is not permission to cancel arbitrary jobs. Completion is durably recorded and automatically returned to the Agent; a placeholder is a Tool Message indicating transfer, not forged success under the original tool's output schema.

## Completion criteria

With `completionVerification` enabled, participants have:

```json
{"criteria":"All required tests pass and the documented CLI works.","promise":"The requested CLI change is implemented and verified."}
```

This is `set_completion_criteria`. Ralph checks for the exact promise in the current task's final AI reply and requests continued work when absent. Successful delivery clears the binding; interrupted work retains it.

The Coordinator additionally has independent native Rubric Builder and Outcome Verifier helpers. Builder sees original human requirements and source snapshots. Explicit human references to a revised specification capture another version of that path, anchored to the corresponding requirement; previous versions remain available. Unreferenced edits and internal notices do not update the requirements. Its sole tool is `submit_rubric(rubric, tests_required)`, which submits source-anchored Markdown for the Host to write to `rubrics.md`; it has no file, shell, or delegation tools. Plain text is not a submission.

Verifier reads the applicable rubric with `read_rubric` and the complete frozen final-answer text for the current attempt with `read_candidate`. An empty candidate remains empty. This lets it inspect a deliverable supplied directly in chat without inventing a file or running Bash just to read text. File artifacts and required builds/tests still need actual native inspection or completed execution; the author's claims are not evidence. Candidate snapshots are scoped to one review attempt and released on exit or interruption. `Partial`, `Block`, missing evidence, or malformed verdicts return concrete gaps for rework. New eligible input and Stop can interrupt verification; queued later tasks cannot skip the current gate.

The hidden Verifier finishes with its private `submit_verdict(status, issues)` tool. `status` is `Pass`, `Partial`, or `Block`; `issues` is an array of strings. Submission ends that review without another model response. It belongs to the current candidate only, and does not count as inspection or replace a required successful Bash execution. The existing plain/fenced JSON verdict forms remain compatible. This tool is absent from Coordinator and Worker inventories.

Its optional `runtime_blocked` boolean defaults to false; together with an observed native capability failure, true reports that the remaining tools cannot independently verify the task, while ordinary `Partial` and `Block` issues remain eligible for rework.

Coordinator facts state whether automatic outcome verification is configured. When enabled, they identify the host-managed rubric and final verification flow; when disabled, they explicitly say so. A leftover rubric file or a retained helper does not determine the current setting.

## UI and backend compatibility

A real Worker turn returns its complete final committed AI message to `reportTo`, including an empty body when none exists. A message-driven background handoff is not a completed Worker task. Receipt identity and native committed message evidence prevent recovery from delivering the same result twice.

The UI-only `projectMode/timeline(sessionId, workerId, limit, signal)` stream shows newest native turns with original input, final AI reply, and recorded artifacts. Its initial ten-turn UI window is independent of QueryAgent's explicit history indices. It renders a two-line preview expandable to original Markdown, and does not call a model. Artifacts come from native deliverables and successful persisted file mutations, not guessed shell side effects.

The UI-only `projectMode/followWorkerParent(sessionId, workerId, signal)` stream keeps the selected nested Worker's native residency and true parent chain available while its conversation is visible. It checks the owning project's Remote access and current membership, adds no model input, and ends when the view closes or membership changes. Closing the view releases this hold; it does not cancel actual work. Top-level Workers retain the existing native Coordinator-reference path. A visible nested conversation uses native capacity for its target and cold ancestors.

The Remote service/storage/package identifiers retain their historical `projectMode`/`project-mode` names for existing consumers. Legacy backend request schemas are not a second model-visible delegation path.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `backgroundStrategy` | `llm-judge` | `after-seconds`, `new-message`, or `llm-judge`. |
| `backgroundAfterSeconds` | `10` | Nonnegative threshold before applying the chosen slow-tool policy; declared backgroundOnMessage bypasses it for eligible input. |
| `completionVerification` | `true` | Installs participant completion criteria and the Coordinator's independent outcome helpers. |
| `dataDirectory` | `.` | New workspace-root memory layout. Explicit private layouts and already saved paths remain supported. |
| `coordinatorHiddenTools` | Native delegation/workflow entries | Scoped replaced tool names; global preferences are not rewritten. |
| `progressTextMaxChars` | `100` | UI/activity preview length; does not clip explicit history or automatic final results. |
| `retryInitialDelayMs`, `retryMaxDelayMs`, `retryMaxAttempts` | `1000`, `30000`, `5` | Existing result-admission retry policy, not task execution retries. |

The short native judge uses the current model route, requests no-thinking output, and does not create a separate Agent. Route availability and real response latency belong in model acceptance evidence.
