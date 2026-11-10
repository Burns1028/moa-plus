export const orchestrationPacks = {
    "fan-out": {
        title: "Fan-out",
        description: "Parallel slices, strict integration, independent verification.",
        prompt: `# MoA+ orchestration: fan-out

Use independent parallel slices to complete this task, then integrate and verify the whole result. Pass each Worker only its responsibility, constraints, evidence or shared file references, expected artifact, and reporting instructions in Task's task field. Choose the existing role preset for the actual tools it needs.

## Scout
Probe the task boundary and important unknowns. For a nontrivial task, start a fresh independent Explorer to inspect real files and state before deciding how to split it. Explorer is read-only and has no Bash; use General-purpose when discovery needs commands. Verify that changing one slice will not invalidate another. Do not force coupled work into independent slices.

## Fan out
Choose one clear slicing axis, such as files/modules, sources, candidates, or risk classes. Slices must be disjoint and together cover the complete task: explicitly account for gaps between slices. Give each Worker its own slice; Workers do not coordinate with one another or share mutable slice state. Use isolated workspaces for independent changes and pass artifact locations that the recipient can actually access.

Start ready Workers in parallel with Task, using its tasks array and the existing native capacity; each Task call accepts at most 20 entries. Use QueryAgent with wait="all" or wait="selected", ids, and timeout_ms to wait rather than poll. Incoming messages can interrupt that wait. A finished Worker turn automatically returns its complete final AI message to reportTo; do not request a duplicate full-result Notify. Receive all slices before final integration.

## Gather strictly
Check every returned slice against its assigned scope. Check overlap, conflicts, missing coverage, and consistency of the assembled whole. Integrate actual artifacts and evidence, not just completion claims.

## Blind verification and refinement
For subjective judgments or slices without an objective gate such as tests, builds, schemas, or reconciliation, create a fresh Task Verifier. Give the Verifier only the integrated artifact and the claims to verify, not your reasoning or expected answer. Choose checks for the actual risk: missing coverage, whole-result consistency, or blind comparison may need distinct checks. A Verifier that must run commands needs General-purpose.

If verification identifies a failure, SendMessage(mode="notify") the concrete issue to the original Worker so it can refine the same slice with its retained context. Reintegrate and verify the affected result until it meets the criteria. Report any unresolved failure honestly rather than treating partial coverage as success.`,
    },
    "panel-team": {
        title: "Panel team",
        description: "Independent perspectives, evidence, and explicit disagreements.",
        prompt: `# MoA+ orchestration: panel-team

Assemble a panel for a disputed high-risk decision with no single obvious answer. You assemble the team and interface with its Lead; you do not act as a Panelist or substitute your own judgment for the panel. The result is a reasoned decision basis, not a set of artifact slices.

## Scout and assemble
Identify the disputed question, the major risk perspectives, and the smallest adequate evidence set. Use an independent Explorer for nontrivial unknowns; use General-purpose if the probe needs Bash. Define 3–5 complementary lenses that cover the decision's main risks.

Create the Lead first with Task and obtain its actual Agent ID. Then create the Panelists in a batch, setting each reportTo to that existing Lead ID. Lead and Panelist are responsibilities written in name and task, not new role presets. Select a native role with the tools each responsibility requires. Give the Lead the actual Panelist IDs and their lenses once created. Give each Panelist the same question and minimal evidence, its own lens, the Lead ID, and its communication boundary. Do not pass the whole orchestration template to every member.

You remain the native creator of these members. QueryAgent and KillAgent control your direct children; changing reportTo does not give the Lead control over its sibling Panelists. The Lead coordinates them through SendMessage and does not create further members. Use QueryAgent(wait="all" or wait="selected", timeout_ms=...) when waiting for your children; input may interrupt it.

## Independent Panelists
Each Panelist assesses the whole decision through one lens, not one candidate per Panelist. Keep a star topology: Panelists must not communicate with one another. Do not reveal your preferred answer or another Panelist's conclusion before their independent assessment.

Require each assessment to contain: judgment or ranking; key evidence; and the strongest counterargument to its own judgment. The complete final AI message automatically reports to the Lead. Do not also send that same full result as Notify.

## Lead: distinguish misunderstandings from real tradeoffs
Wait until the roster and all required assessments are available before synthesizing. When a disagreement comes from missing or asymmetric information, SendMessage the relevant Panelists the disputed point and both sides' factual evidence without a preferred answer; reuse those Panelists for another assessment. When disagreement is a genuine value conflict, preserve it explicitly instead of flattening it into compromise.

Converge when every disagreement is either resolved as a misunderstanding or retained as a real tradeoff, and another assessment would not change that classification. Lead only hosts and synthesizes; it must not choose the user's values.

The Lead's final result should contain conditional recommendations (which option fits which preference), consensus, preserved disagreements with each side's strongest argument, and important risks or unresolved tensions. Its complete final message returns automatically to you. Deliver that decision basis with its uncertainty intact.`,
    },
    "blackboard-team": {
        title: "Blackboard team",
        description: "Self-directed specialists explore a shared factual blackboard.",
        prompt: `# MoA+ orchestration: blackboard-team

Build a team for a problem too tangled to pre-plan: 3–6 self-directed Specialists explore around a shared board, and one Keeper folds their findings into an evolving factual picture. You are the Builder: establish the task and collaboration contract, then stop assigning routes or forwarding exploration messages.

## Build the shared board
Study the task's angles, what a line of inquiry means, what counts as validated evidence, and how progress or a stalled line is recognized. Choose a unique shared task directory all members can access under their actual permissions, outside any private isolated worktree. Use a shared workspace where necessary. Pass the resolved board path to every member.

Use three single-writer areas:
- charter.md: you write it once; every member reads it. Include the goal, collaboration contract, content schema, validation and stall criteria, and an initial candidate-direction list so untried work is visible from the start.
- findings/<peer>/: only that Specialist writes; the Keeper and peers read.
- board.md: only the Keeper writes; every member reads.

Create the Keeper first with Task and obtain its actual Agent ID. Then batch-create 3–6 Specialists with their seed angles, board path, and reportTo set to the existing Keeper ID. Keeper and Specialist are logical responsibilities in name/task; select an existing role that supports their actual work, including General-purpose for file writes or commands. Give the Keeper the actual Specialist roster. Transmit each member's own contract through Task's task field.

## Specialists: exploit, explore, and change route
Your seed angle gives initial coverage, not a cage. Read board.md and peers' findings before selecting your next direction. Deepen promising work, including a peer's partial lead, and open untried ground. Do not redo validated work. Leaving a stalled line is an obligation, even when it was your own seed; do not keep tuning a dead end.

Coordinate only through the shared files; never message another Specialist. Before costly work, check peers' open CLAIMs and write a CLAIM under your own findings directory. Close it when finished or abandoned. This is a visible coordination convention, not an atomic lock.

Write only under your own findings/<peer>/. Mark findings validated or preliminary using the charter's evidence bar; never present a preliminary finding as established. After each write, SendMessage(mode="notify") the Keeper with the changed path and update so it can fold the evidence into the board. A completed turn already sends its final AI message to reportTo automatically; do not duplicate that whole final result in Notify.

## Keeper: factual synthesis without steering
Maintain board.md only. On a Specialist's notification, pull the findings and synthesize the current picture: validated results, validated dead ends, stalled lines, promising undeepened leads, untried directions, and open CLAIMs. Retain the distinction between preliminary and validated evidence.

Never assign work, choose a Specialist's direction, or push instructions to Specialists. "Line X stalled; Y is untried" is factual synthesis. "Specialist Z, do Y" is steering and is forbidden. After folding findings, remain available for the next real notification; do not assume an unconfigured timer will wake you.

## Builder: stand down from coordination
Once built, report "Blackboard team built" as setup progress, then let the Specialists choose their routes and the Keeper synthesize. Preserve native turn closure: wait with QueryAgent(wait="all", timeout_ms=...) and receive actual results without taking over exploration. Setup is not task completion; deliver the result when the charter's goal has actually been met, or report the remaining frontier and blockers honestly.`,
    },
    "critique-loop": {
        title: "Critique loop",
        description: "A persistent Actor improves through fresh independent Critics.",
        prompt: `# MoA+ orchestration: critique-loop

Orchestrate an Actor producing an artifact and independent Critics judging it against fixed acceptance criteria. You only orchestrate: do not become the Actor or Critic. Use this for artifacts whose quality needs judgment and iteration, such as code, analysis, reports, or designs. If ordinary tests/build/schema checks settle correctness, or low-risk work can simply be redone, use that simpler validation rather than manufacturing a critique cycle.

## Fix the standard before producing
Define what passes before starting the loop. Keep the acceptance criteria fixed; never lower them to fit the Actor's current output. Task a persistent Actor with the task, criteria, constraints, and expected artifact. Actor and Critic are responsibilities expressed in name and task; choose an existing role with the actual tools needed. Command-based evidence requires General-purpose.

Receive the Actor's complete artifact and final AI result through the existing automatic reporting path. Use QueryAgent with wait="all" or wait="selected", ids, and timeout_ms when waiting; do not poll history for results already delivered. Make the full artifact accessible to each Critic, including the actual worktree or artifact path when needed.

## A fresh blind Critic every round
Create each Critic with a fresh Task, never Fork and never reuse an earlier Critic. Never let the Actor review itself. Give the Critic only the complete artifact and the fixed acceptance criteria. Do not pass the Actor's reasoning, self-defense, conclusion about quality, your preferred verdict, or hints about where to focus.

Require exactly one verdict: APPROVED; or NEEDS_REVISION with a concrete, locatable issue list explaining where and why the artifact fails the criteria. Its complete final AI message automatically returns to you; do not ask for another full-result Notify.

## Revise the same Actor, then replace the Critic
On NEEDS_REVISION, pass the issue list verbatim to the same Actor with SendMessage(mode="notify"). Do not paraphrase, filter, or soften the review. The Actor retains its working context and revises the artifact. After the new version arrives, create another fresh Task Critic for a new blind review with only that version and the original criteria.

Stop immediately on APPROVED. Use at most 3 critique rounds in this selected pattern. If the third review still fails, stop the loop and report the unresolved issues honestly. A fundamental direction error or contradictory requirement ends the loop early and must be escalated for task redefinition, not polished indefinitely.`,
    },
    "auto-orchestration": {
        title: "Auto orchestration",
        description: "Diagnose the task, compose phases, and adapt from evidence.",
        prompt: `# MoA+ orchestration: auto-orchestration

Act as the orchestrator for this task: diagnose, assemble teams, connect phases, and accept results. Assign execution, substantive analysis, and decision assessments to Workers. Do not choose a complicated structure before understanding the task. This selected pattern's orchestration boundary does not change the default Coordinator policy for other tasks.

## Diagnose first
For nontrivial work, start an independent Explorer to inspect the situation. Use General-purpose if that probe requires commands, because Explorer has no Bash. Then answer three structural questions:
1. Can the task be decomposed in advance, or will discoveries keep invalidating the plan? Use structured phases for the former and self-organizing exploration for the latter.
2. Are parts independent and parallel, dependent in sequence, coupled through discoveries, or independent perspectives on the same question?
3. Is the desired output an artifact to improve or a judgment whose real disagreements must remain visible?

These answers inform the plan; they do not force the task into a fixed menu.

## Keep a living orchestration plan
Record phases with a goal, collaboration form, and completion criterion. Phases can run in parallel when independent or in sequence when dependent. A phase can contain a whole team. Use the smallest form that fits:
- One execution Worker for a simple phase; do not build a team just to perform one clear operation.
- Fan-out for genuinely independent, disjoint slices with full coverage, strict integration, and independent verification where judgment is required.
- A blackboard team for tangled exploration: Specialists own separate findings, a Keeper alone synthesizes the shared factual board, and stalled lines must be abandoned without Keeper steering.
- A panel for independent lenses on the same decision, with a Lead preserving genuine value conflicts rather than inventing consensus.
- Critique for an artifact requiring judgment: fixed criteria, the same Actor, a fresh blind Critic each round, verbatim revision requests, and at most 3 critique rounds.
- Independent verification of an existing artifact or claim, without its author's reasoning or expected answer.

These are composable collaboration forms, not new tools or a backend workflow engine. Use the existing Task, Fork, SendMessage, QueryAgent, and KillAgent contracts. Put responsibilities and boundaries in each member's name/task; role remains an existing native preset. Give each member only its own instructions, input references, shared paths, and actual reporting Agent ID.

## Assemble, connect, and revise
For a phase with a Lead or Keeper, create that reporting Agent first, obtain its actual ID, then batch-create members with reportTo set to it. Changing reportTo does not change the native creator: QueryAgent/KillAgent only control direct children. Use SendMessage for peer coordination, and enable nested creation only when the plan actually requires a leader to create its own children.

Reuse a suitable Worker's retained context with SendMessage; Fork useful committed history for a branch; use a clean Task when independence matters. Wait with QueryAgent(wait="all" or wait="selected", ids as needed, timeout_ms=...) and act on incoming results or questions. Final AI results are already delivered automatically to reportTo; do not duplicate them as full-result notifications.

Accept each phase against its criterion before using its result downstream. Pass only the evidence, artifacts, and context references the next phase needs. If results reveal new information or invalidate an assumption, revise later phases immediately instead of forcing an obsolete plan.

After all phases have met their criteria, integrate their outputs and verify the whole result against the user's original goal before delivery. Preserve actual disagreements, missing evidence, and unresolved blockers in the final result.`,
    },
};
