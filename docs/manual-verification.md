# Manual verification

Use the final checked-out build, matching compatibility manifest/lockfile, a **fresh isolated DSH runtime**, a real configured model, and a new Git workspace. Do not send test prompts to a personal conversation or reuse old media as evidence for the new runtime. Keep raw logs, profiles, credentials, and private captures out of Git.

Record the branch/commit, native runtime and Node versions, model/route, configuration, task, actual artifacts, independent command results, visible outcome, and limitations. Distinguish scripted native fixtures, real tool processes, real model decisions, and rendered UI evidence.

## Composition, lifecycle, and workspace

1. Select MoA+ before the first message. Starting locks it to a static MoA+ identity; it cannot become an ordinary conversation. Check an ordinary conversation retains its original tools, input, and layout.
2. Inspect actual model schemas/trajectory: Coordinator has Task, Fork, SendMessage, QueryAgent, and KillAgent, with ProjectContext/background/completion tools as configured. It lacks replaced native delegation/workflow entries and the old model-visible control_workers. Ordinary execution tools remain.
3. Task creates clean specialists with declared roles. Verify identity appears in history before the task and does not personalize each Worker's System Prompt. A default Worker cannot spawn another team; an explicitly nested-enabled Worker can. Native capacity is separate from Task's twenty-item batch limit.
4. Use staged, unstaged, and untracked source content. Default isolated execution sees the current snapshot in a distinct Git worktree without changing the source index. Two Workers can make conflicting attempts independently. Explicit shared execution uses the creator's cwd.
5. Fork a selected member, then inspect inherited committed history, repaired open tail where applicable, and appended new identity. Verify source, creator, reportTo, and cwd are distinct actual facts. Restart an uncertain admission and confirm no duplicate child or permanent duplicate Fork seed.
6. Inspect Idle, Running, Waiting, Aborting, and Zombie facts. Request's awaited tool stays Running; Query/human approval may be Waiting. Kill waits for actual execution/resource cleanup before Zombie. A normal stop retains history/workspace; SendMessage continues it.
7. With deliberate delayed cleanup, use KillAgent continue_with. Verify old driver/resource exit and Tool Call/Tool Result pairing before new input runs under fresh cancellation control. Explicit destroy hides the member and cleans only its owned isolated worktree; it does not delete a shared source.

## Communication and result return

8. Run Worker Request to its parent with an explicit ReplyTo answer. Confirm the original Tool Call gets that answer before the next model invocation. Inject urgent unrelated input during a pending Request; control returns, all eligible input is read, and the late explicit answer later arrives through the inbox. Check timeout and wait-cycle behavior with deterministic fixtures alongside the real route.
9. Send multiple next-step messages while a tool runs. The next inference sees the eligible batch. Explicit queue remains next-turn input. Query wait is interrupted by eligible input or completion/timeout; queued later input does not bypass current work or its completion gate.
10. Deliver peer input and a result to a cold nested Worker whose true parent is also cold. Restore the actual parent chain without synthetic input or new task events in intermediate parents. Preserve original header lineage, delegated policy, and cwd.
11. End a Worker turn and compare its complete final committed AI content with the designated reportTo's canonical result. Check one delivery, not a duplicate full body to both leader and root. A turn without an AI message returns an empty result, never the previous reply. Coordinator can query history or continue the Worker to recover.
12. Restart with admitted/pending results and replies. Compare stable identity and committed receipts; no accepted input, final AI result, or late reply should be delivered twice. Failed creation placeholders and deleted members stay out of public lists; failed execution of an existing Worker remains visible.

## Background tools and completion

13. Run real slow Bash under a short test threshold. AfterSeconds without new input returns control within the same turn. NewMessage and LLMJudge transfer on eligible input, write a **Tool Message** placeholder, wait for foreground siblings, close with handoff, and let new input start the next turn. A false judgment preserves unread input and new input triggers reconsideration. Declared backgroundOnMessage can bypass the threshold.
14. Query actual stdout/progress, repeat a completed full result, and cancel an owned tool. Native Bash's ordinary timeout/promotion is not final process completion. Native standalone background jobs retain their ordinary controller. Stop/Kill cannot claim resource exit merely because a cancellation request was accepted.
15. Let an Agent become idle while a transferred tool still runs. The job/result remains owned, real completion wakes the Agent, and the Coordinator cannot report all work complete while that obligation remains. Test receipt recovery after Stop/flush failure/restart without rerunning the original command.
16. Bind set_completion_criteria, initially omit its exact promise, and verify Ralph withdraws completion. Stop/restart retains an unfinished task's promise; successful completion clears it before a new task.
17. Give a real task with an initially failing test and explicit source requirements. Inspect Builder's inputs: only original human/spec snapshots, no implementation or verifier feedback. Check its only tool is submit_rubric and the rubric comes from that actual submission. Inspect authoritative rubrics.md and Verifier's inherited native read/build/test evidence. Partial/Block or unsupported Pass causes rework; actual accepted completion follows the required passing evidence. Incoming eligible human input and Stop escape an obsolete verifier; queue does not skip the current gate.
18. Compare current notes at successive inferences. Full text remains present even unchanged; above 8,000 characters the tail survives and the Coordinator gets a cleanup reminder. Read index first, load relevant topics, and reuse a confirmed fact in a later task. Isolated Workers update the actual shared Context through native versioned writes. Coordinator maintains notes/archive, not an automatic truncator.

## Visible native interface

19. While a Worker runs, send a Coordinator message through Enter/Send. Verify timely native steer rather than waiting behind that Worker. Operate a Worker directly and verify the next Coordinator interaction observes its new status/input and can read the required history window.
20. Check capsules at the bottom of each participating native turn/human-message segment. Passive input and reads do not copy or move them; actual accepted updates and received results establish participation. Preserve earlier seats. Delete hides all seats. Each compact capsule has one identity icon and one status label, not duplicate Completed text.
21. Check native sidebar alignment, activity/spinner updates, current selection, original row actions, and ordinary sessions. Worker Back retains native styling and its independent permission picker is absent; root/ordinary permission controls remain.
22. Check default Workers and notes.md tabs, native switching/closing/reopening, a single useful empty state, and newest-first original input/output/artifacts. Preview one to two lines with ellipsis, including input beginning with code or tables; click text or Enter/Space to expand original Markdown. Hidden preview controls must not steal focus. Links/copy/artifact opening still use native behavior.
23. Archive/restore the managed family. Children follow the Coordinator, while independently archived children are not restored accidentally. Reopen completed/cold conversations and confirm UI observation alone does not create a task, move capsules, or invoke a model.

Use the repository's full automated/package checks as well. Record failures and actual limitations; a successful scripted adapter run alone is not real-model/UI acceptance.
