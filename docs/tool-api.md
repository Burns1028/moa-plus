# control_workers

Available only to the enabled MoA coordinator. DSH still owns permission checks, tools, prompts and native child activity. The actual execution Agent determines ownership; a worker ID alone never grants control.

| Action      | Required arguments                 | Result                                                                 |
| ----------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `spawn`     | `name`, `task`                     | Native child and accepted initial-message receipt                      |
| `list`      | none                               | Visible managed workers and real current status                        |
| `get`       | `worker_id`                        | One worker's status and progress                                       |
| `send`      | `worker_id`, `message`, `delivery` | Native message acceptance; `delivery` is `steer` or `queue`            |
| `history`   | `worker_id`, `offset`, `limit`     | Current worker status and a newest-first user/assistant message window |
| `interrupt` | `worker_id`                        | Request native cancellation; pending queue follows DSH                 |
| `delete`    | `worker_id`                        | Drain native resources and remove team membership                      |

`list` returns an array of `WorkerView`; `get` returns one `WorkerView`. Public lists/snapshots omit deleted members and failed creation placeholders, while existing Workers with failed execution remain visible. Internal operation records are retained. Its `lifecycle` is team membership; `status` is busy/idle/unknown; `availability` describes live/cold/unavailable native observation; `phase` is a derived display label. `activity` contains the latest committed input, latest human input, native `observedThroughSeq`, pending human input previews and their total count. An unavailable activity read returns `null`.

The current activity preview includes the latest three pending human inputs and a total count. `list` text uses `progressTextMaxChars` (default 100 characters); `get` returns full text for those entries, with the same preview count. Committed dialogue is read through explicit `history` windows. These preview limits do not cap history or the full automatic completion payload. No human read cursor or separate acknowledgement state is maintained.

`spawn` and `send` may include `task_ref` to link a task in notes. A successful dispatch response means admission, not completion. The coordinator normally delegates before updating task files.

```json
{
  "action": "spawn",
  "name": "Frontend",
  "task": "Implement the requested form and report validation.",
  "task_ref": "PM-001"
}
```

```json
{
  "action": "send",
  "worker_id": "<native-child-session>",
  "message": "Check keyboard navigation after this task.",
  "delivery": "queue"
}
```

```json
{
  "action": "send",
  "worker_id": "<native-child-session>",
  "message": "Prioritize the error state in the current work.",
  "delivery": "steer"
}
```

Steer does not hard-kill a running tool. Queue is not an alias for steer: it targets the next native turn. Cold workers are resumed through the native subagent manager, never as independent root Sessions.

History uses zero-based indices from the newest visible message. `offset: 0, limit: 10` reads the latest ten; `offset: 10, limit: 20` reads positions 10–29. Both arguments are explicit nonnegative integers; zero length or an offset beyond available messages returns an empty window. There is no default count, 100-message cap, byte clipping, or opaque cursor.

```json
{
  "action": "history",
  "worker_id": "<native-child-session>",
  "offset": 10,
  "limit": 20
}
```

The reply contains `workerId`, current busy/idle/unknown `status`, `offset`, `limit`, `total`, `messages`, and `observedThroughSeq`. Each message includes its relative `index`, native `id`/`seq`/`turn`, `role` (`user` or `assistant`), and full visible `text`. Messages are returned newest first; indices are calculated after filtering dialogue. User messages include coordinator assignments and committed human input; AI entries include committed intermediate replies and finals. System/runtime instructions, internal notices, reasoning, and tool calls/results are excluded. Pending input remains visible through list/get activity until it is committed. Each query indexes its current snapshot, so incoming messages shift relative positions.

History reads do not wake a cold worker, invoke a model, or create capsule participation. Full automatic completion delivery is unchanged.

Every worker turn sends a completion notification with its worker identity, turn and outcome. Its result is the full last committed AI message from that turn; if no AI message exists, the result body is empty and the notification is still delivered to the coordinator. No previous reply is substituted. The coordinator can then inspect history, reassign work or decide another next step; an empty result does not suppress notification or force a runtime retry policy.

Deletion removes the Worker from MoA list/snapshots and all capsule seats, including historical turns. There is no include_deleted list option. Deleted Workers reject get/history/timeline, interrupts and new MoA dispatches; repeated delete remains idempotent. Native conversation history and internal recovery/delivery facts remain. Queries do not resume cold workers or invoke models.

The UI-only `projectMode/timeline(sessionId, workerId, limit, signal)` Remote stream returns latest native turns with timestamped original inputs, each ended turn's last AI reply, recorded artifacts and completion outcomes, and updates on native Session events. Input and final output render directly as Markdown; intermediate replies and summaries are not displayed. The initial visible window is ten turns; Load earlier increases it. This is independent of `control_workers` history, which still includes intermediate visible AI replies, and does not add an Agent tool or a message-count cap. Artifacts use native `deliverables/presented` events and successful persisted file-mutation metadata; reads, failed tools and guessed shell effects are excluded. Closing/hiding the tab or selecting another worker cancels its observer.
