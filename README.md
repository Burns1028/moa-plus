![MoA+ — Intelligence, multiplied. Persistent Agents, direct collaboration, and shared context for DeepSeek Harness.](docs/media/moa-plus-banner.png)

# MoA+

**Advancing intelligence through agent collaboration.**

MoA+ is a **Mixture of Agents collaboration plugin for DeepSeek Harness**. It connects persistent agents through independent contexts, direct communication, and shared knowledge, with the goal of expanding what the whole system can accomplish together.

A Coordinator keeps the goal and overall direction in view. Workers investigate, build, challenge, and review in their own conversations, remaining available for the next assignment. The team can explore different approaches, work in parallel, and carry its findings into later tasks.

English | [简体中文](README.zh.md)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Demo](#see-it-in-action) · [Documentation][roles]

## Quick start

Requires **Node 24.9+**, npm, and Git. MoA+ **v0.2.0** needs the matching **DSH 0.2.1-rc.3 compatibility runtime**: its explicit manifest extends **19 native packages across 43 file paths**. Stock rc.3 and runtimes prepared from another plugin revision cannot be substituted.

Worker Bash record protection uses macOS Seatbelt or Linux bubblewrap. See [backend requirements][compatibility] before setup on Linux or Windows.

Clone the project and prepare a separate Web runtime:

```sh
git clone --branch v0.2.0 --single-branch https://github.com/Burns1028/moa-plus.git
cd moa-plus
npm ci
node scripts/apply-native-compat.mjs --dry-run
node scripts/apply-native-compat.mjs --backup "$PWD/.superpowers/native-backup"
npm run build
node scripts/project-mode.mjs setup --dir /absolute/empty-moa-runtime
node scripts/project-mode.mjs start --dir /absolute/empty-moa-runtime
```

The compatibility command backs up the changed files before extending this checkout's dependencies. Setup prepares an isolated runtime with its own home, configuration, documents, and native backups; it leaves your personal Desktop app and `~/.dsh` profile untouched. Use an empty directory outside the checkout and reuse the same `--dir` for subsequent commands.

Configure the model in native settings, create a conversation, and select **MoA+** before its first message. Mode identity stays fixed after starting. Use a Git workspace for isolated Workers; choose `shared` when they should work directly in the parent's directory. The [first-run guide][quickstart] covers model setup, `doctor`, and recovery; [compatibility][compatibility] covers manual setup and rollback.

For the earlier published Project Mode, follow the [v0.1.23 installation instructions](https://github.com/Burns1028/moa-plus/tree/v0.1.23#quick-start). That tag uses the Project label and the earlier three-extension runtime.

## How it works

![Coordinator directs persistent Workers; peers exchange messages and share indexed knowledge on the same native DSH runtime.](docs/media/moa-collaboration.svg)

### Independent work, direct communication

Coordinator and Workers use the same native Agent Loop, with different identities, tools, and delegated permissions. `Task` starts a specialist with a fresh context; `Fork` branches selected committed history. Independent Git worktrees separate parallel changes, while an explicit shared workspace lets Workers use the parent's directory.

`SendMessage` lets agents notify peers, steer work, queue instructions, or ask a blocking question that waits for an explicit reply. `QueryAgent` inspects state and selected history, or waits for progress. `KillAgent` stops execution and waits for resources to exit. Slow tools can run in the background and return their results automatically.

When a Worker turn finishes, its **complete final AI message** returns automatically to its designated reporting Agent. The Coordinator can review the result, continue with that Worker, or change direction. Retained conversations and workspaces let the team continue across assignments.

### Shared knowledge, independent review

The Coordinator maintains `notes.md` and `archived.md`; the Host refreshes full notes before each Coordinator inference. Coordinator and Workers contribute reusable findings through `context/index.md`, then read relevant files as needed. Isolated Workers access the same shared knowledge, so later work can build on confirmed findings without copying every execution detail into the main conversation.

A Rubric Builder derives acceptance criteria from the original requirements and specification. An Outcome Verifier checks actual deliverables with native tools and returns concrete gaps when results are incomplete or evidence is missing. See [roles and common flows][roles], the [code architecture][architecture], and the [Tool API][tools] for the full contracts.

## See it in action

MoA+ keeps collaboration in the native DSH interface. **Capsules are child conversations**: click one to open its Worker, or find the same Worker beneath the Coordinator in the sidebar. You can give the Worker instructions directly and use Back to return to the Coordinator. Capsules stay with the turn or message segment where the Worker participated.

Agent messages show their sender and expand from an original-text preview to full Markdown. The closable Workers and notes.md tabs show inputs, final replies, artifacts, and current work records. New user input remains responsive while the team works.

[![A real CLI task with delegation, human intervention, result review, and context reuse](docs/media/project-workflow.gif)](docs/media/project-workflow.mp4)

Recorded on **v0.1.23** with the original Project label, this 60-second edit follows a real CLI task: Exporter changes title sorting, a human adjusts the accepted order inside its conversation, Docs aligns the guide, and the Coordinator reviews the result. The next task reuses the Workers and agreed context. Waits are omitted and labeled. [View the artifacts](docs/demo-result), [reproduce the demo](docs/demo-workflow.md), or read [current-runtime verification][verification].

## Documentation and contribution

- [Roles, lifecycle, and common flows][roles]
- [Code architecture][architecture] and [Tool API][tools]
- [First-run guide][quickstart] and [compatibility / rollback][compatibility]
- [Verification records][verification]
- [Build, tests, and contribution guide][contributing]
- [Report a trial or installation problem](https://github.com/Burns1028/moa-plus/issues/new?template=project-mode-trial.yml)

MoA+ is an unofficial DSH plugin. The package name `dsh-plugin-project-mode` and saved protocol identifiers remain compatible with existing data.

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).

[roles]: https://github.com/Burns1028/moa-plus/blob/main/docs/moa-architecture.md
[architecture]: https://github.com/Burns1028/moa-plus/blob/main/docs/architecture.md
[tools]: https://github.com/Burns1028/moa-plus/blob/main/docs/tool-api.md
[verification]: https://github.com/Burns1028/moa-plus/blob/main/docs/verification.md
[compatibility]: https://github.com/Burns1028/moa-plus/blob/main/docs/compatibility.md
[quickstart]: https://github.com/Burns1028/moa-plus/blob/main/docs/quickstart.md
[contributing]: https://github.com/Burns1028/moa-plus/blob/main/CONTRIBUTING.md
