# MoA+

**Advancing intelligence through multi-agent collaboration.** MoA+ builds a Mixture of Agents system inside DeepSeek Harness: persistent agents share knowledge, exchange messages, explore different approaches, and review results together.

English | [简体中文](README.zh.md)

[![Real v0.1.23 workflow: two Workers, shared notes, and nine passing tests](docs/media/workflow-result.png)](docs/media/project-workflow.mp4)

[Watch the workflow](docs/media/project-workflow.mp4) · [Architecture](docs/architecture.md) · [Tool API](docs/tool-api.md) · [Install](#quick-start)

**This branch contains the unreleased MoA runtime work.** It extends the published v0.1.23 preview with the five Agent primitives, isolated workspaces, request/reply messaging, background tools, and completion gates described below. Integration and real-model/UI acceptance are being completed; [verification](docs/verification.md) separates that work from published evidence. No new release is implied by the existing package version.

The plugin targets DSH **0.2.1-rc.3 with explicit compatibility extensions**. Stock rc.3 cannot enable this runtime directly. The current manifest covers 13 native packages; v0.1.23 used three earlier extensions. See [compatibility](docs/compatibility.md) before mixing versions.

## Collaboration that persists

The Coordinator owns the goal, direction, shared work records, result review, and final delivery. Workers retain their conversation and working directory between assignments. Both run the same native DSH Agent Loop; roles, tool sets, and delegated permissions distinguish them.

| Capability | What it provides |
| --- | --- |
| `Task` and `Fork` | Start fresh specialists or branch from a selected Agent's committed history. |
| `SendMessage` | Notify a teammate, guide current work, queue later input, or ask a question and await its explicit reply. |
| `QueryAgent` and `KillAgent` | Inspect status/history, wait interruptibly, stop and join current execution, or explicitly remove a Worker. |
| Isolated or shared workspaces | Snapshot the source's current Git state into an owned worktree by default; choose shared execution when appropriate. |
| Shared knowledge | Read a progressive context index, contribute reusable facts, and carry accepted knowledge into later tasks. |
| Background execution | Let slow tools run as native jobs while an Agent handles new input; query, cancel, and receive their real results. |
| Completion review | Bind an exact completion promise and independently derive/check source-anchored acceptance criteria. |
| Human participation | Open a Worker, guide it directly, and return to a Coordinator that can inspect the change. |

The Coordinator keeps its ordinary execution tools. It chooses how to divide work; no task keywords or command-count rules force delegation. MoA's controls replace the alternative native delegation tools only for participating Agents. Workers cannot create another team unless nested delegation is explicitly enabled. Ordinary DSH conversations retain native composition.

## See it in action

[![Published v0.1.23 task: dispatch, human intervention, result review, and context reuse](docs/media/project-workflow.gif)](docs/media/project-workflow.mp4)

The **published v0.1.23** recording follows a real CLI task: Exporter implements title sorting, a human changes the ordering inside its conversation, Docs aligns the guide, and the Coordinator reviews the result. A later task reuses the same Workers and accepted context. The [actual output](docs/demo-result) passed nine tests.

This is a 60-second edit with waits omitted and labeled, not a completion-time benchmark. It demonstrates the earlier coordination chain; it does not validate every unreleased runtime mechanism. [Reproduce the task](docs/demo-workflow.md) or read the [capture details](docs/media/README.md).

| Worker work axis | Project notes |
| --- | --- |
| ![Original input, final AI reply, and recorded artifacts](docs/media/worker-timeline.png) | ![Notes beside the native conversation](docs/media/project-notes.png) |

The detail screenshots use v0.1.22 and the fictional Project Atlas workspace. Existing media retains its original **Project** label; the current UI identifies the mode as **MoA+**.

## Quick start

For the **published v0.1.23 preview**, use a separate compatible DSH Web environment. Requires Node **24.9+**, npm, and Git:

```sh
git clone --branch v0.1.23 https://github.com/Burns1028/moa-plus.git
cd moa-plus
node scripts/project-mode.mjs setup
node scripts/project-mode.mjs start
```

That tag installs the earlier preview and its three compatibility extensions. It does not contain this branch's new runtime. Select **Project** before the first message in that version.

To test **this branch**, build the checked-out source and prepare a new empty runtime directory using its matching launcher, lockfile, and manifest:

```sh
npm ci
node scripts/apply-native-compat.mjs --dry-run
node scripts/apply-native-compat.mjs --backup "$PWD/.superpowers/native-backup"
npm run build
node scripts/project-mode.mjs setup --dir /absolute/empty-moa-runtime
node scripts/project-mode.mjs start --dir /absolute/empty-moa-runtime
```

Select **MoA+** before sending a new conversation's first message. Its identity remains fixed after starting. Use a new Git workspace for isolated Workers; explicitly choose `shared` for assignments that should use the parent's directory.

The launcher prepares a separate native Web runtime, home, Agent configuration, and documents directory. Configure your model through native settings. It does not reuse your personal DSH profile or modify an installed Desktop app. Use `doctor` with the same `--dir` to verify it. See the [first-run guide](docs/quickstart.md).

## A usual working flow

1. Bring a goal to the Coordinator. It checks Workers and reads the work records and relevant context.
2. It creates a specialist with `Task`, branches useful history with `Fork`, or continues an existing Worker with `SendMessage`.
3. It updates `notes.md`, responds to new user input, and adjusts directions while work proceeds. A request waits within its Tool Call; a notification returns after acceptance.
4. An ended Worker turn returns its **complete last committed AI message** to `reportTo`, normally its creator. If no AI message was committed, the result is empty; an old reply is never substituted. A background handoff is not a completion.
5. The Coordinator reviews evidence and artifacts, follows up on gaps, updates reusable knowledge, and delivers the outcome. Normal closure waits for relevant work and result consumption. New input and native Stop remain responsive.

`QueryAgent` reads an explicit newest-relative human/AI history window. It does not silently load the last 100 messages. The Coordinator can inspect user activity inside Workers when the user returns; there is no separate human read/ack protocol.

## Project memory

New workspaces use:

```text
workspace/
├── notes.md                 Coordinator: stage, todos, assignments, progress, blockers
├── archived.md              Coordinator: concluded work and its results
├── rubrics.md               Independently authored acceptance criteria
└── context/
    ├── index.md             Shared file paths and short descriptions
    └── ...                  Reusable facts, decisions, and methods
```

The Host refreshes the Coordinator's **full `notes.md` before each inference**. Above 8,000 characters it adds a reminder to organize/archive; it does not truncate the file or archive work itself. Context stays progressive: read the index, then load relevant files. Workers contribute reusable findings; the Coordinator primarily organizes, consolidates, and prunes them. `ProjectContext` reaches the actual shared knowledge base from isolated worktrees too.

Existing saved paths and legacy `context/context.md` indexes remain usable. Conversations using the same workspace share its memory files; use separate workspaces for independent projects.

## Native DSH interface

- Expand the Coordinator in the original sidebar to open its Workers, with stable identity icons and current activity.
- Worker capsules remain at the bottom of their participating turn/message segment. Passive replies do not move or copy them; accepted updates and received results establish participation.
- The default **Workers** and **notes.md** right-side tabs use native tab behavior and can be closed. The work axis shows original input, final AI output, and recorded artifacts, newest first.
- Input and output show a one- or two-line text preview with an ellipsis; click the text to expand the original Markdown.
- Worker composers provide **Back** and inherited permissions, with no independent permission picker. Deletion hides a Worker from active lists and all capsule seats; native history remains. Archival follows the managed family.

## Code and documentation

```text
packages/project-mode/src/
├── host/                    Native composition, durable admissions, results, and MoA controls
│   └── moa/                 Agents, roles, messaging, workspaces, background, and completion
├── client/                  Native sidebar, capsules, controls, and tabs
└── shared/                  Transport views and common membership rules
compat/rc3/                  Reviewed native extensions and exact file hashes
runtime/rc3/                 Locked isolated runtime template
scripts/                     Build, explicit setup, and package-consumer checks
tests/                       Native fixtures, Client contracts, and launcher checks
```

The historical package name `dsh-plugin-project-mode`, storage domain, and Remote service identity remain stable for existing installations. Product naming does not require moving saved sessions or renaming the wire protocol.

See [architecture](docs/architecture.md), [roles and design](docs/moa-architecture.md), [Tool API](docs/tool-api.md), [compatibility](docs/compatibility.md), and [contributing](CONTRIBUTING.md). For a complete check:

```sh
npm test -- --maxWorkers=1
npm run typecheck
npm run test:native-contract
npm run test:launcher
npm run verify:package
```

Model judgment still matters: the architecture supports independent work and review, but does not guarantee ideal delegation or infallible acceptance criteria. Share concrete workflows or installation failures through [trial feedback](https://github.com/Burns1028/moa-plus/issues/new?template=project-mode-trial.yml).

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
