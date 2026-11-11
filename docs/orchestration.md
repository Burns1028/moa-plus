# Adaptive coordination and optional patterns

This guide covers **MoA+ v0.2.1**. MoA+ uses one default Adaptive Coordinator policy and five optional bundled prompt texts with Chinese display names, all over the existing [native collaboration tools](tool-api.md).

## Default Adaptive coordination

The Coordinator keeps simple work direct. When delegation helps, it first considers reusing a suitable Worker's retained context with `SendMessage`, then `Fork` when committed history is useful to a new branch, then a clean `Task` when the history is irrelevant or an independent judgment matters. These choices depend on the responsibility and available context.

When no actionable goal or unfinished concrete work exists, a brief acknowledgement or an ordinary chat clarification is a complete response. Tools, memory changes, worker checks, and structured user questions should advance an actual goal rather than become a ritual for every message. A necessary decision within a concrete task can still use the native question tool. Independent acceptance continues to judge the actual requested deliverable.

The Coordinator starts independent ready branches within native capacity, keeps work with unmet dependencies pending, and updates the plan as results or questions arrive. It can advance another useful responsibility while Workers run. When waiting is the useful next step, it uses `QueryAgent` rather than repeatedly querying unchanged state. A timeout prompts a progress assessment; it is not by itself evidence that a Worker has failed. A substantially overdue or unclear run can be asked for its blocker and ETA through `SendMessage` in request mode before deciding whether it must be stopped.

## Use a bundled `@` prompt

Only an enabled MoA+ Coordinator offers the five packs. Workers and ordinary conversations do not offer them.

1. Type `@` and choose a pack by clicking it or pressing Enter or Tab.
2. The pack expands into editable composer text. Add the task, constraints, and relevant references; review or edit the text as needed.
3. Send through the native composer as usual.

For example, type `@`, select **并行攻坚**, then add: “Review these independent adapters, report findings for each, and check the combined coverage.”

Selecting or expanding a pack does not create a team. It inserts instructions for the Coordinator to act on after sending. Native Send is not intercepted. Ordinary file references, uploads, queue, and steer keep their native behavior.

## Choose a pattern

| Prompt | Use it for | Collaboration contract |
| --- | --- | --- |
| **并行攻坚** | Work that can be divided into genuinely independent slices. | Scout actual boundaries, give each Worker a disjoint slice, gather every result, integrate strictly, and independently verify judgments or results without an objective gate. |
| **多方会审** | A disputed decision with several defensible perspectives. | A Lead hosts 3–5 independent Panelists assessing the same question through different lenses, resolves information gaps, and preserves genuine value conflicts. |
| **协同探索** | Exploration whose findings keep changing the useful next steps. | A Builder establishes a shared charter and team, 3–6 Specialists choose their own routes, and a Keeper synthesizes a factual board without steering them. |
| **迭代精修** | An artifact that needs judgment and iterative improvement. | One retained Actor works against fixed criteria; every round uses a fresh blind Critic. Relay revision issues verbatim and stop on approval or after at most three critique rounds. |
| **统筹推进** | A compound task needing different collaboration forms across phases. | Diagnose the structure, keep a living phase plan with completion criteria, assemble the smallest useful form for each phase, and revise downstream work when evidence changes. |

### Independent slices and reviews

并行攻坚 requires slices whose changes do not invalidate one another. Confirm this from real files and state, cover the whole responsibility without gaps, and keep mutable slice work separate. Gather actual artifacts and evidence before integrating. Give an independent verifier the integrated artifact and claims to check, without the Coordinator's reasoning or expected answer. Return concrete failures to the original Worker through `SendMessage` so it can refine its retained work.

In 迭代精修, each fresh Critic receives only the full current artifact and fixed acceptance criteria. It returns `APPROVED` or `NEEDS_REVISION` with locatable issues. Reuse the Actor, pass issues unchanged, and create a new Critic for the next version. Ordinary objective checks remain appropriate when they settle the task without a critique cycle. After the third failed review, report the unresolved issues; a fundamental direction error or contradictory requirement ends the loop earlier.

### 多方会审 preserves real disagreement

Each Panelist judges the whole decision through its own lens, using the same minimal evidence and no preferred answer from the Coordinator. Panelists do not communicate with each other. Each returns a judgment or ranking, key evidence, and the strongest counterargument to its own position. The Lead uses `SendMessage` to resolve missing information with the relevant Panelists, then returns conditional recommendations, consensus, retained disagreements, and important risks. The Lead does not choose the user's values.

### 协同探索 keeps findings visible

Use a shared task directory that all members can access under their actual permissions, outside private isolated worktrees. The Builder writes `charter.md` once with the goal, evidence standard, stall criteria, and initial candidate directions. Each Specialist writes only its own `findings/<peer>/`; only the Keeper writes `board.md`.

Specialists read the board and peer findings, record visible `CLAIM`s before costly work, close claims when finished or abandoned, and change route when a line stalls. Claims are a coordination convention, not atomic locks. Specialists mark findings preliminary or validated and notify the Keeper of changed paths; they do not message one another. The Keeper reads findings and records validated results, dead ends, stalled lines, open claims, and unexplored directions without assigning work. The Builder stops route coordination after setup and leaves synthesis to the Keeper. Setup progress is distinct from completing the task.

### Compose phases from evidence

统筹推进 first asks whether work can be decomposed, how its parts relate, and whether the result is an artifact or a judgment. Each phase records its goal, collaboration form, and completion criterion. The selected prompt makes the Coordinator responsible for diagnosis, assembly, handoffs, and acceptance, with execution and substantive assessments assigned to Workers. That boundary belongs to this selected pattern; the default Coordinator can still do simple work directly.

## Use the actual tool contracts

Patterns do not add tools or role presets. Lead, Keeper, Panelist, Specialist, Actor, and Critic are responsibilities expressed in `name` and `task`. The `role` field remains one of `Explorer`, `Planner`, `Deep Research`, or `General-purpose`. Explorer and Planner have no Bash; file writes, commands, builds, and tests require an appropriate execution role such as General-purpose, with the existing native permissions.

`Task` takes a `tasks` array of up to 20 items. Put each member's own assignment in `tasks[].task`, including boundaries, accessible artifact paths, and reporting instructions. Give it only the context it needs. For a panel, first create its Lead:

```json
{"tasks":[{"name":"Lead","task":"Host the panel and synthesize its evidence and retained disagreements; await the member roster.","role":"General-purpose","workspace":"shared"}]}
```

After obtaining the Lead's actual accepted Agent ID, create Panelists with that ID in `reportTo`, then send the actual roster to the Lead:

```json
{"tasks":[{"name":"Correctness Panelist","task":"Assess the entire decision through correctness; return judgment, evidence, and the strongest counterargument. Do not contact other Panelists.","role":"General-purpose","workspace":"shared","reportTo":"<actual-lead-id>"}]}
```

Use the same ordering for a Keeper and its Specialists. A reporting target must already exist; do not invent an ID while creating all members in one batch. `reportTo` routes final results and does not change the native creator. `QueryAgent` and `KillAgent` manage the caller's direct children; sibling Lead/Panelist or Keeper/Specialist communication uses `SendMessage`. Enable `nested` only when a member must create and manage its own children.

Wait with the actual `QueryAgent` fields:

```json
{"wait":"all","timeout_ms":30000}
```

```json
{"ids":["<actual-worker-id>"],"wait":"selected","timeout_ms":30000}
```

Omitting `wait` makes an immediate query. A native wait can return for completion, eligible incoming input, cancellation, or timeout. A finished Worker turn already delivers its complete final AI message to `reportTo`; do not send a duplicate full-result notification. See the [Tool API](tool-api.md) for history windows, request/reply matching, workspace choices, and Stop semantics.

## Implementation boundary

The catalog in [`shared/orchestration.ts`](../packages/project-mode/src/shared/orchestration.ts) contains local titles, descriptions, and prompt text. [`client/orchestration-input.ts`](../packages/project-mode/src/client/orchestration-input.ts) contributes candidates and editable expansions through the native input-trigger source. [`host/prompts/coordinator.ts`](../packages/project-mode/src/host/prompts/coordinator.ts) supplies the default Adaptive guidance.

The catalog is text, not a workflow engine, Skill, network service, or runtime enforcement layer. The selected instructions guide model behavior; DSH continues to own Agent execution, capacity, inbox admission, delivery, permissions, resource cleanup, and Stop. No separate scheduler or task-specific delegation gate is added. See the [architecture guide](architecture.md) for those ownership boundaries.
