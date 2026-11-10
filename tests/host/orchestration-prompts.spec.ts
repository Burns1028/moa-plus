import { expect, it } from "vitest";
import { orchestrationPacks } from "../../packages/project-mode/src/shared/orchestration.ts";

it("ships exactly five plain prompt packs for native input expansion", () => {
  expect(Object.keys(orchestrationPacks)).toEqual([
    "fan-out",
    "panel-team",
    "blackboard-team",
    "critique-loop",
    "auto-orchestration",
  ]);
  for (const [id, pack] of Object.entries(orchestrationPacks)) {
    expect(Object.keys(pack).sort()).toEqual([
      "description",
      "prompt",
      "title",
    ]);
    expect(pack.title.trim()).not.toBe("");
    expect(pack.description.trim()).not.toBe("");
    expect(pack.description).not.toContain("\n");
    expect(pack.prompt).toContain(`# MoA+ orchestration: ${id}`);
    expect(pack.prompt).toContain("timeout_ms");
    expect(pack.prompt).not.toMatch(
      /wait_timeout|Task\.prompt|\/home\/tiger|~\/\.maso|\/cowork\/api|O48|GPT5\.6/,
    );
  }
});

it("requires real independent slices and blind verification before fan-out delivery", () => {
  const { prompt } = orchestrationPacks["fan-out"];
  expect(prompt).toMatch(/Do not force coupled work/);
  expect(prompt).toMatch(/disjoint.*complete task/);
  expect(prompt).toMatch(/do not coordinate with one another/);
  expect(prompt).toMatch(/fresh Task Verifier/);
  expect(prompt).toMatch(/not your reasoning or expected answer/);
  expect(prompt).toMatch(/original Worker.*refine the same slice/);
});

it("keeps panel lenses independent and separates reporting from child management", () => {
  const { prompt } = orchestrationPacks["panel-team"];
  expect(prompt.indexOf("Create the Lead first")).toBeLessThan(
    prompt.indexOf("Then create the Panelists"),
  );
  expect(prompt).toMatch(/reportTo to that existing Lead ID/);
  expect(prompt).toMatch(/whole decision through one lens, not one candidate/);
  expect(prompt).toMatch(/must not communicate with one another/);
  expect(prompt).toMatch(/strongest counterargument to its own judgment/);
  expect(prompt).toMatch(/does not give the Lead control over its sibling/);
  expect(prompt).toMatch(/missing or asymmetric information/);
  expect(prompt).toMatch(/genuine value conflict, preserve it explicitly/);
});

it("gives the blackboard one writer per area and self-directed route changes", () => {
  const { prompt } = orchestrationPacks["blackboard-team"];
  expect(prompt.indexOf("Create the Keeper first")).toBeLessThan(
    prompt.indexOf("Then batch-create"),
  );
  expect(prompt).toMatch(/charter\.md: you write it once/);
  expect(prompt).toMatch(/findings\/<peer>\/: only that Specialist writes/);
  expect(prompt).toMatch(/board\.md: only the Keeper writes/);
  expect(prompt).toMatch(/Leaving a stalled line is an obligation/);
  expect(prompt).toMatch(/never message another Specialist/);
  expect(prompt).toMatch(/not an atomic lock/);
  expect(prompt).toMatch(/Never assign work, choose a Specialist's direction/);
  expect(prompt).toMatch(/do not assume an unconfigured timer/);
  expect(prompt).toMatch(/Setup is not task completion/);
});

it("reuses the Actor but creates an unprimed Critic for every bounded review", () => {
  const { prompt } = orchestrationPacks["critique-loop"];
  expect(prompt).toMatch(/never lower them to fit/);
  expect(prompt).toMatch(/fresh Task, never Fork and never reuse/);
  expect(prompt).toMatch(
    /only the complete artifact and the fixed acceptance criteria/,
  );
  expect(prompt).toMatch(/Do not pass the Actor's reasoning/);
  expect(prompt).toMatch(/pass the issue list verbatim to the same Actor/);
  expect(prompt).toMatch(/at most 3 critique rounds in this selected pattern/);
  expect(prompt).toMatch(
    /third review still fails.*report the unresolved issues/,
  );
});

it("lets auto-orchestration choose a simple phase and revise a plan from evidence", () => {
  const { prompt } = orchestrationPacks["auto-orchestration"];
  expect(prompt).toMatch(/One execution Worker for a simple phase/);
  expect(prompt).toMatch(/goal, collaboration form, and completion criterion/);
  expect(prompt).toMatch(/does not change the default Coordinator policy/);
  expect(prompt).toMatch(/revise later phases immediately/);
  expect(prompt).toMatch(/user's original goal/);
});

it("retains automatic ended-turn reporting instead of duplicate full-result notifications", () => {
  for (const { prompt } of Object.values(orchestrationPacks)) {
    expect(prompt).toMatch(/automatically/);
    expect(prompt).toMatch(/do not (?:request|ask for|duplicate|also send)/i);
  }
});
