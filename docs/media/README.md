# Project imagery and product captures

## MoA+ cover

`moa-plus-banner.png` is AI-generated brand artwork for the project. Its 16:9 composition places the MoA+ identity on the left and connected Coordinator, Worker and shared-context illustrations on the right. Both READMEs use this same image; the walkthrough videos below remain native product recordings.

## Historical captures (v0.1.22)

These assets show Project Mode v0.1.22 running with the compatible DeepSeek Harness 0.2.1-rc.3 runtime, captured on 2026-11-02. The captures use the installed Desktop Host and its native Web UI in a local browser. No runtime code was changed for capture, and no product UI was mocked or generated.

Project Atlas is a fictional workspace for a CLI note exporter. Two real Worker conversations reviewed a small release brief, returned results to the Coordinator, and handled a second handoff request. The fixture's test counts and release claims are fictional inputs, not verified results or plugin benchmarks.

| File | What it shows |
| --- | --- |
| `project-workspace.png` | Coordinator response, native Worker branches, result capsules and the notes tab. |
| `worker-timeline.png` | Native panel crop: two Worker turns, original input, final AI output and recorded artifacts. |
| `project-notes.png` | Native panel crop: the Coordinator-maintained `notes.md`. |
| `project-mode-demo.gif` | Silent, looping UI navigation after both Worker turns completed. |
| `project-mode-demo.mp4` | The same approximately 22-second walkthrough, with player controls. |

The stills are direct browser-content captures. The video records actual panel and conversation navigation at 2.5 frames per second; it does not depict live model generation or imply task completion speed. GIF and MP4 are scaled encodings of the same captured frames. Worker's inputs and outputs are the original conversation content.

Private workspace groups were collapsed before capture. Only the fictional Project Atlas conversation and its Workers appear. No personal conversation, account identifier, credential or private filesystem path is included. `/private/tmp/project-atlas-demo` and the Project UUID visible in the UI belong only to this fixture.

Project-authored demo content and media may be reused under this repository's MIT license. DeepSeek Harness branding and native UI remain attributable to DeepSeek; their appearance does not imply endorsement.

## Complete workflow (v0.1.23)

`project-workflow.mp4` and `project-workflow.gif` show an actual run in the new isolated npm Web runtime on macOS arm64, Node 24.19.0, DSH 0.2.1-rc.3, with Project Mode 0.1.23. `workflow-result.png` is an unmodified capture of the final result. The older Project Atlas screenshots/navigation clip above were captured on 0.1.22.

The new 60-second edit uses six real UI excerpts, at normal playback speed, with waits omitted and that fact labeled throughout. The first five excerpts come from the continuous task recording at source offsets (1.5–5.5 plus 37–43), 43–53, 119–129, 260–270, and 275–285 seconds. The final excerpt is a later read-only inspection of the completed result and its independently reproduced tests. The local uncut capture is retained for review. The edit is not a claim that the task completed in 60 seconds.

The human sent a change while Exporter was busy; native input queued it for its next turn. It is shown as a direct human update, not a hard interruption. The Coordinator received the full ended-turn result, recognized the changed requirement, aligned Docs, then reused the same Workers in a later task. The finished fixture has 9 passing tests; see [the reproducible starter](../../examples/note-bundle) and [actual result files](../demo-result).

Only the synthetic Note Bundle workspace and isolated runtime are visible. No personal profile, conversation, credential settings or API key is in the recording. Typography banners were rendered from code above the original UI using ImageMagick and FFmpeg; the product pixels were not mocked or relabeled.
