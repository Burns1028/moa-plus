import { afterEach, expect, it, vi } from "vitest";
import type { InputTriggerSource } from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { SessionModeView } from "../../packages/project-mode/src/shared/index.ts";
import { ProjectClient } from "../../packages/project-mode/src/client/runtime.ts";
import { bindOrchestrationInput } from "../../packages/project-mode/src/client/orchestration-input.ts";
import { orchestrationPacks } from "../../packages/project-mode/src/shared/orchestration.ts";
import { sid, snapshot } from "./fixture.ts";

const cleanups: (() => void)[] = [];
const titles = ["并行攻坚", "多方会审", "协同探索", "迭代精修", "统筹推进"];
const oldVisibleNames =
  /fan[- ]out|panel[- ]team|blackboard[- ]team|critique[- ]loop|auto[- ]orchestration/i;
afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();
});

function bench() {
  let source!: InputTriggerSource;
  const modes = new Map<string, SessionModeView>();
  const client = new ProjectClient({
    mode: vi.fn(async (id: string) => ({ ok: true, value: modes.get(id)! })),
  } as any);
  const remove = vi.fn();
  const registerSource = vi.fn((registered: InputTriggerSource) => {
    source = registered;
    return remove;
  });
  const dispose = bindOrchestrationInput(client, { registerSource });
  cleanups.push(() => client.dispose(), dispose);
  const session = (id = "parent") => ({ sessionId: sid(id) });
  const candidates = (id = "parent", query = "", extra = {}) =>
    source.candidates(session(id), {
      query,
      position: "leading",
      drilled: false,
      signal: new AbortController().signal,
      ...extra,
    });
  const pick = (name: string, id = "parent") =>
    source.onPick({
      candidate: { name },
      session: session(id),
      position: "leading",
      via: "menu",
      action: "pick",
      span: { start: 0, end: name.length + 1, draftRev: 1 },
    });
  return {
    client,
    modes,
    source,
    registerSource,
    remove,
    dispose,
    session,
    candidates,
    pick,
  };
}

it("offers the five text shortcuts only to acknowledged MoA+ coordinators, including a first-message draft", async () => {
  const b = bench();
  expect(b.registerSource).toHaveBeenCalledOnce();
  expect(b.source.trigger).toBe("@");
  expect(await b.candidates()).toEqual([]);
  b.modes.set("parent", {
    sessionId: sid("parent"),
    role: "coordinator",
    enabled: true,
    revision: 2,
    canToggle: true,
  });
  await b.client.refreshMode(sid("parent"));
  expect((await b.candidates()).map((candidate) => candidate.name)).toEqual(
    titles,
  );
  expect((await b.candidates()).map((candidate) => candidate.label)).toEqual(
    titles,
  );
  expect(JSON.stringify(await b.candidates())).not.toMatch(oldVisibleNames);
  expect(await b.candidates("ordinary")).toEqual([]);
  expect(await b.candidates("child")).toEqual([]);
  b.modes.set("child", {
    sessionId: sid("child"),
    role: "worker",
    enabled: true,
    revision: 2,
    canToggle: false,
  });
  await b.client.refreshMode(sid("child"));
  expect(await b.candidates("child")).toEqual([]);
});

it("expands a selected template through native ordinary text insertion without taking over submission", async () => {
  const b = bench();
  b.client.store.accept(snapshot());
  for (const pack of Object.values(orchestrationPacks)) {
    const expanded = await b.pick(pack.title);
    expect(expanded).toEqual({ text: `${pack.prompt}\n\n` });
    expect(expanded?.text).not.toMatch(oldVisibleNames);
  }
  expect(b.source.matchSpace).toBeUndefined();
  expect(b.pick("not-a-pack")).toBeUndefined();
  expect(b.pick("并行攻坚", "ordinary")).toBeUndefined();
  expect(b.source.matchEnter).toBeUndefined();
  expect(b.source.matchClaim).toBeUndefined();
  expect(b.source.codec).toBeUndefined();
});

it("invalidates the subscribed session only when its effective pack eligibility changes", async () => {
  const b = bench();
  const changed = vi.fn();
  cleanups.push(b.source.subscribeLexicon!(b.session(), changed));
  b.client.store.accept({
    ...snapshot(),
    project: { ...snapshot().project, coordinatorSessionId: sid("other") },
  });
  expect(changed).not.toHaveBeenCalled();
  b.client.store.accept(snapshot());
  expect(changed).toHaveBeenCalledTimes(1);
  b.client.store.accept({
    ...snapshot(),
    workers: [{ ...snapshot().workers[0]!, progressText: "New live progress" }],
  });
  b.modes.set("other", {
    sessionId: sid("other"),
    role: "coordinator",
    enabled: false,
    revision: 2,
    canToggle: true,
  });
  await b.client.refreshMode(sid("other"));
  b.modes.set("parent", {
    sessionId: sid("parent"),
    role: "coordinator",
    enabled: true,
    revision: 2,
    canToggle: true,
  });
  await b.client.refreshMode(sid("parent"));
  expect(changed).toHaveBeenCalledTimes(1);
  b.modes.set("parent", {
    ...b.modes.get("parent")!,
    enabled: false,
    revision: 3,
  });
  await b.client.refreshMode(sid("parent"));
  expect(changed).toHaveBeenCalledTimes(2);
  b.client.store.accept({
    ...snapshot(),
    project: { ...snapshot().project, revision: 4 },
    revision: 4,
  });
  expect(changed).toHaveBeenCalledTimes(3);
});

it("searches Chinese names and descriptions, rejects old English shortcuts and keeps file lookups separate", async () => {
  const b = bench();
  b.client.store.accept(snapshot());
  expect(
    (await b.candidates("parent", "精修")).map((candidate) => candidate.name),
  ).toEqual(["迭代精修"]);
  for (const pack of Object.values(orchestrationPacks))
    expect(
      (await b.candidates("parent", pack.description)).map(
        (candidate) => candidate.name,
      ),
    ).toEqual([pack.title]);
  for (const oldName of Object.keys(orchestrationPacks)) {
    expect(await b.candidates("parent", oldName)).toEqual([]);
    expect(b.pick(oldName)).toBeUndefined();
  }
  expect(await b.candidates("parent", "src/file.ts")).toEqual([]);
  expect(await b.candidates("parent", "并行", { quoted: true })).toEqual([]);
  expect(await b.candidates("parent", "并行", { drilled: true })).toEqual([]);
});

it("refreshes native candidates after mode changes and rejects a stale enabled selection", async () => {
  const b = bench();
  b.client.store.accept(snapshot());
  const changed = vi.fn();
  const unsubscribe = b.source.subscribeLexicon!(b.session(), changed);
  cleanups.push(unsubscribe);
  expect(b.source.lexicon?.(b.session())).toEqual(titles);
  b.modes.set("parent", {
    sessionId: sid("parent"),
    role: "coordinator",
    enabled: false,
    revision: 2,
    canToggle: true,
  });
  await b.client.refreshMode(sid("parent"));
  expect(changed).toHaveBeenCalled();
  expect(await b.candidates()).toEqual([]);
  expect(b.pick("并行攻坚")).toBeUndefined();
  expect(b.source.lexicon?.(b.session())).toEqual([]);
  b.client.store.accept(snapshot());
  expect(await b.candidates()).toEqual([]);
  unsubscribe();
  changed.mockClear();
  b.client.store.accept({
    ...snapshot(),
    project: { ...snapshot().project, revision: 3 },
    revision: 3,
  });
  expect(changed).not.toHaveBeenCalled();
  expect((await b.candidates()).length).toBe(5);
  b.dispose();
  expect(b.remove).toHaveBeenCalledOnce();
});
