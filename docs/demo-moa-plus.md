# A real MoA+ team task

The [current walkthrough](media/moa-plus-workflow.mp4) was captured during **MoA+ v0.2.0 release preparation**, using the matching DSH 0.2.1-rc.3 runtime and a real DeepSeek-V4.1-Flash model with High reasoning. The GIF and MP4 combine sampled native UI clips with real key frames from one task. They are an edited walkthrough, not an uninterrupted screen recording; waiting is removed and labeled.

## What happens

1. The Coordinator reads the Note Bundle task and starts **Exporter** and **Docs** with `Task`, in a shared workspace with separate file ownership.
2. The Workers exchange the CLI contract directly with `SendMessage`, including Request and explicit replies.
3. A human opens Docs from its capsule and asks for copyable commands and exact output headings.
4. Back in the main conversation, the Coordinator checks Docs' current state and relevant human/AI history with `QueryAgent`, then brings both Workers into line.
5. Workers return complete final replies; the Coordinator checks actual output, saves reusable knowledge, and finishes through the independent completion-review flow.

## Reproduce it

Copy [examples/note-bundle](../examples/note-bundle) into a new Git workspace. Prepare the [matching runtime](quickstart.md), create a new conversation, and select **MoA+** before its first message. Use separate source files for each Worker so the shared workspace has clear ownership.

Send the Coordinator:

> Finish TASK.md with two general-purpose Workers in this shared workspace. Exporter owns note-bundle.mjs and tests; Docs owns docs/usage.md. Use Task to delegate both. Ask them to agree the --sort title interface through a direct Agent message. Save the confirmed CLI contract and test command in shared context and its index for later reuse. Run the tests and generate dist/notes.md before reporting the result. Keep it local: no dependencies or commits. Use concise English.

Open Docs and send:

> Please include copyable commands for both filename ordering and --sort title, plus the exact headings each produces. Confirm the interface directly with Exporter, and save the accepted command in shared context. Keep the guide concise.

Use **Back** and send the Coordinator:

> I added a documentation requirement directly to Docs. Check its current status and relevant human/AI messages, keep both Workers aligned, and finish the existing task.

Use native **Steer** when a message should interrupt a current wait; native Queue leaves it for the next turn.

## Actual result

The recorded run passed **10 tests**, including default filename ordering, title ordering, heading fallback, tie-breaking, option errors, and output-file generation. The final `dist/notes.md` contains `# apples`, `# Bananas`, `# Pears` in that order. `docs/usage.md` includes commands and exact heading lines for both default and title sorting. The accepted contract and test command are indexed under `context/`.

This is a reproducible feature demonstration. Its edit length is not a task-duration or comparative-performance claim. The earlier [v0.1.23 recording](demo-workflow.md) remains available separately.

## Recording provenance

The recorded task took about 10 minutes 36 seconds and ended normally after two native Verifier attempts. The first inspected the artifacts and ran the tests successfully, but prefaced its fenced JSON verdict with prose; the candidate's strict parser rejected that format. The task continued without a bypass, and the second attempt returned the accepted JSON verdict. The Coordinator completed 9 ms after that Verifier turn ended. The release fixes this formatting mismatch; the edit does not claim a first-attempt Pass or a 60-second task execution.

The walkthrough uses 75 source frames across six scenes: a held dispatch frame, four sampled UI clips, and a held completion state. Captures use the browser's native screenshot API. Conversation content, Worker state, and tool results are unmodified.

After installing the completion-format fix, the same retained conversation was restarted and given a short follow-up to check saved context and outputs without new implementation work. Both Workers stayed idle. The Coordinator rechecked the existing outputs and 10 passing tests; an independent Verifier read the rubric and candidate, inspected files, and ran 20 Bash commands. It returned a plain JSON Pass, and the Coordinator completed 30 ms later. This follow-up took about 84 seconds. The prose-plus-fenced-JSON parser case is covered by the native regression suite; this follow-up did not reproduce that output format.
