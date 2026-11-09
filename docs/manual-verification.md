# Manual verification

Use an isolated temporary workspace and fresh MoA conversation. Do not use an existing personal conversation as a test fixture.

1. Start with MoA selected. After the first turn begins, its identity becomes a static MoA label and cannot be downgraded. Ordinary conversations retain their original behavior.
2. Assign a small task with a reusable finding. Verify an existing Worker can be reused or a new one created, the shared index is read first, a context document is written and indexed, and the Coordinator owns notes/archived updates.
3. Inspect the real model request and trajectory: Coordinator has control_workers and lacks replaced native delegation/control tools. Workers retain native tool composition.
4. While a Worker runs, send a Coordinator message through Enter. Verify timely steer admission rather than waiting behind the Worker. Explicit queue remains a later-turn operation. Operate a Worker directly, then verify the next Coordinator interaction observes its updated status/input.
5. Verify the Worker final AI message returns in full. No final AI message must still report a completion with an empty body. Coordinator processes results before normal same-turn closure. Stop remains interruptible without cascading into all Workers.
6. Check capsules at each participating message-segment bottom. Passive replies do not copy or move them; accepted updates and received results create a new seat. Delete a Worker and verify all its capsules and active MoA queries disappear.
7. Check native sidebar title alignment, busy animation and ordinary rows. In a Worker composer, Back is transparent and the independent permission picker is absent. Coordinator and ordinary permission pickers remain.
8. Check Workers and notes.md native tabs, close/reopen behavior, a single empty state and newest-first timeline. Input/output headings stay visible; each message shows up to two text lines with an ellipsis when longer, including messages starting with tables or code fences. Click the message text to expand the complete original Markdown or collapse it, or focus it and use Enter/Space. Closed previews must not expose off-preview link/copy controls to keyboard focus. Verify expanded native links, copy actions and artifact opening still work.
9. Restart while results are pending; verify no duplicate result delivery. Archive/restore the MoA family without restoring independently archived children.

Record the actual runtime, model, task, visible result and limitations. Passing scripted fixtures alone is not real-model/UI acceptance.
