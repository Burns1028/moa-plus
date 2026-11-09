![MoA+ — Intelligence, multiplied. Persistent Agents, direct collaboration, and shared context for DeepSeek Harness.](docs/media/moa-plus-banner.png)

# MoA+

**Advancing intelligence through multi-agent collaboration.**

MoA+ brings a powerful **Mixture of Agents architecture** to DeepSeek Harness. A persistent Coordinator holds the goal, chooses the direction, and brings the results together. Workers investigate, build, challenge, and review in their own conversations, remaining available for the next assignment.

The architecture connects independent execution with **direct communication, shared knowledge, and native lifecycle control**. The Coordinator decides how the team works; the runtime delivers messages, preserves conversations, returns results, and supports independent verification. The goal is to raise what the whole system can accomplish through collaboration.

English | [简体中文](README.zh.md)

[Architecture][roles] · [Try the runtime](#try-the-runtime) · [Watch a real workflow](docs/media/project-workflow.mp4) · [Verification][verification]

**Developer preview:** the new MoA runtime is available on `main` following [PR #3](https://github.com/Burns1028/moa-plus/pull/3), and has not yet been tagged as a new release. It requires the matching DSH **0.2.1-rc.3 compatibility runtime**. The latest published tag, **v0.1.23**, is the earlier Project Mode preview. [Version and setup details][compatibility].

## How the MoA architecture works

Long tasks put pressure on context, judgment, and throughput. MoA+ gives the team an architecture for keeping global decisions clear, exploring independently, and making parallel work accumulate:

- **Persistent teams, independent contexts.** Coordinator and Workers share the native Agent Loop. Tool output, experiments, and retries stay in Workers' execution contexts; the Coordinator keeps the goal, decisions, and progress in view. Retained conversations and workspaces let the team continue across assignments.
- **Deliberate delegation and parallel work.** `Task` starts a specialist with a fresh context; `Fork` branches selected committed history. Isolated Git worktrees separate parallel changes, while an explicit shared workspace supports work in the parent's directory.
- **Direct Agent-to-Agent communication.** `SendMessage` carries notifications, current guidance, queued assignments, and blocking questions. Interruptible Request waits for an explicit reply; `QueryAgent` inspects state and selected history, or waits for progress and new input.
- **Knowledge that compounds.** The Coordinator maintains `notes.md` and `archived.md`; full notes refresh before each Coordinator inference. Both roles contribute reusable findings through `context/index.md`, loading relevant files progressively instead of copying entire backgrounds into every assignment.
- **Responsive execution and lifecycle control.** Slow tools can move to the background and return results automatically. `KillAgent` stops execution and waits for resources to exit before continuation. Each real ended Worker turn returns its complete final AI message to its reporting Agent.
- **Independent, evidence-based completion review.** A Rubric Builder derives acceptance criteria from the original requirements and specification. An Outcome Verifier checks actual deliverables with native tools; incomplete results and missing evidence return as concrete gaps for rework.

These mechanisms give the team durable memory, independent perspectives, and control over ongoing work. The [architecture guide][architecture] maps their ownership and the six native control flows; the [Tool API][tools] covers configuration and exact behavior.

![Coordinator directs persistent Workers; peers exchange messages and share indexed knowledge on the same native DSH runtime.](docs/media/moa-collaboration.svg)

Coordinator and Workers use the same native Agent Loop. Identity, tools, and delegated permissions define their responsibilities. You can open a Worker, give it instructions directly, and return to the Coordinator.

## The collaboration toolkit

| Primitive | What the team can do |
| --- | --- |
| `Task` | Start specialists with a fresh context and a defined responsibility. |
| `Fork` | Branch a selected Agent's committed history for another line of work. |
| `SendMessage` | Notify peers, steer current work, queue later instructions, or ask a blocking question with an explicit reply. |
| `QueryAgent` | Inspect state and selected human/AI history, or wait until progress or new input calls for attention. |
| `KillAgent` | Stop and join current execution; keep the conversation for continuation, or explicitly destroy it. |

Workers remain available between assignments. Each real ended turn returns its **complete final AI message** to its designated recipient. The Coordinator can review the result, reuse that Worker, or change the direction. New user input remains responsive while the team works.

The runtime also provides isolated/shared workspaces, slow-tool background execution with automatic result return, reusable context, and independent completion review. The Coordinator keeps its ordinary execution tools and decides how to divide work. Nested delegation is explicitly enabled when needed. See the [roles and operating flow][roles] and [Tool API][tools].

## See it in action

MoA+ keeps the native DSH interface:

- **Capsules are child conversations.** Click one to open its Worker; the same Worker appears beneath the Coordinator in the original sidebar. Capsules stay with the turn/message segment where that Worker participated.
- **Agent messages are visible in the chat.** Coordinator, Worker, and peer messages show their sender. Original text previews expand to full Markdown when clicked.
- **Work stays inspectable.** The default, closable Workers and notes.md tabs show the work axis and current records. Inputs and outputs use compact, expandable previews.
- **You can participate directly.** Workers inherit permissions and provide Back to the Coordinator. Removing a Worker hides its active entries and capsules; family archival follows the Coordinator.

[![Published v0.1.23 workflow: dispatch, human intervention, result review, and context reuse](docs/media/project-workflow.gif)](docs/media/project-workflow.mp4)

This **v0.1.23** recording follows a real task: Exporter changes a CLI's title sorting, a human changes the accepted order inside its conversation, Docs aligns the guide, and the Coordinator reviews the result. The next task reuses those Workers and the agreed context. [The output](docs/demo-result) passed nine tests.

The 60-second edit omits and labels waits. It shows the earlier coordination workflow with its original Project label; current-runtime evidence is recorded separately in [verification][verification]. [Reproduce the demo](docs/demo-workflow.md).

| Worker work axis | Shared work records |
| --- | --- |
| ![Original input, final AI reply, and artifacts](docs/media/worker-timeline.png) | ![notes.md beside the native chat](docs/media/project-notes.png) |

These detail images are from the v0.1.22 fictional Project Atlas fixture. The current mode is labeled MoA+.

## Try the runtime

Requires **Node 24.9+**, npm, and Git. To try the runtime from main in a separate Web environment:

```sh
git clone --branch main --single-branch https://github.com/Burns1028/moa-plus.git
cd moa-plus
npm ci
node scripts/apply-native-compat.mjs --dry-run
node scripts/apply-native-compat.mjs --backup "$PWD/.superpowers/native-backup"
npm run build
node scripts/project-mode.mjs setup --dir /absolute/empty-moa-runtime
node scripts/project-mode.mjs start --dir /absolute/empty-moa-runtime
```

The launcher prepares an isolated runtime, home, configuration, and documents directory. Configure the model in native settings, then select **MoA+** before the first message of a new conversation. Mode identity stays fixed after starting. Use a Git workspace for isolated Workers; choose `shared` when they should operate in the parent's directory.

The matching compatibility manifest currently extends 13 native packages across 31 file paths. Setup applies reviewed changes with backups inside the chosen environment; it does not install into your personal Desktop app. Stock rc.3 and a runtime prepared from another plugin revision cannot be substituted. Follow the [first-run guide][quickstart] for model setup, `doctor`, runtime selection, and rollback.

For the **earlier published preview**, use the [v0.1.23 tag and its instructions](https://github.com/Burns1028/moa-plus/tree/v0.1.23#quick-start). That version has the original Project label and three earlier extensions, rather than the runtime described here.

## Memory that carries forward

```text
workspace/
├── notes.md                 Current goals, assignments, progress, and blockers
├── archived.md              Concluded work and its results
├── rubrics.md               Independently authored acceptance criteria
└── context/
    ├── index.md             Shared knowledge paths and short descriptions
    └── ...                  Reusable findings, decisions, and methods
```

The Coordinator maintains notes/archive. The Host refreshes **full notes before each inference**; an 8,000-character soft budget prompts the Coordinator to organize and archive without truncating the text. Workers contribute reusable findings to Context; the Coordinator consolidates and prunes it. Agents read the index first, then load relevant files, including from isolated worktrees.

Existing saved paths and legacy context indexes remain compatible. Independent projects should use separate workspaces; conversations in the same workspace share its records and knowledge.

## Explore and contribute

The [architecture guide][architecture] maps modules, structures, ownership, and the six control flows. [Verification][verification] separates automated checks, real-model tasks, browser acceptance, and historical release evidence. It covers request/reply, background results, cancellation, independent review, normal closure, and restart deduplication.

- [Roles, lifecycle, and common flows][roles]
- [Tool contract][tools]
- [Compatibility and rollback][compatibility]
- [Build, tests, and contribution guide][contributing]
- [Report a real trial or installation problem](https://github.com/Burns1028/moa-plus/issues/new?template=project-mode-trial.yml)

MoA+ is an unofficial DSH plugin. Its historical package name, `dsh-plugin-project-mode`, and saved protocol identities remain stable. The aim is better collaborative intelligence; model judgment and task results still determine how well a particular team performs.

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).

[roles]: https://github.com/Burns1028/moa-plus/blob/main/docs/moa-architecture.md
[architecture]: https://github.com/Burns1028/moa-plus/blob/main/docs/architecture.md
[tools]: https://github.com/Burns1028/moa-plus/blob/main/docs/tool-api.md
[verification]: https://github.com/Burns1028/moa-plus/blob/main/docs/verification.md
[compatibility]: https://github.com/Burns1028/moa-plus/blob/main/docs/compatibility.md
[quickstart]: https://github.com/Burns1028/moa-plus/blob/main/docs/quickstart.md
[contributing]: https://github.com/Burns1028/moa-plus/blob/main/CONTRIBUTING.md
