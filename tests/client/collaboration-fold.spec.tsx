// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type * as Conversation from "@deepseek-ai/dsh-client-ui-conversation/client";
import type * as Chat from "@deepseek-ai/dsh-client-ui-chat/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { humanBoundaryDefinition, workerTailDefinition } from "../../packages/project-mode/src/client/tail.ts";
import { nativeLoader } from "./native-loader.ts";

const roots: Context[] = [];
afterEach(async () => {
  cleanup();
  for (const root of roots.splice(0)) await root.fiber.dispose();
  delete (window as any).__ModuleLoader__;
});

const event = (type: string, seq: number, data: unknown) => ({
  type: "event", event: { type, seq, time: seq * 1000, surfaceOp: "append", data },
}) as any;
const human = (seq: number) => event("user/message", seq, {
  id: `human-${seq}`, role: "user", source: { kind: "user" }, content: [{ type: "text", text: "Please finish the task" }],
});
const incoming = (seq: number) => event("user/message", seq, {
  id: `worker-${seq}`, role: "user",
  source: { kind: "moa-message", form: "relay", senderId: "child", rootId: "parent", operationId: `message-${seq}` },
  content: [{ type: "text", text: "From: child\nWorker evidence remains available." }],
});
const answer = (seq: number, turn = 1, step = 1, text = "Final answer") => event("assistant/message", seq, {
  turn, step, message: { id: `answer-${seq}`, role: "assistant", source: { kind: "model", provider: "fixture", model: "fixture" },
    content: [{ type: "text", text }] }, stream: [],
});
const initial = () => [
  event("turn/start", 1, { turn: 1 }), event("step/start", 2, { turn: 1, step: 1 }), human(3),
  answer(4, 1, 1, "The team is investigating."), incoming(5),
];
const final = (kind = "completed") => [
  event("step/end", 6, { turn: 1, step: 1 }), event("step/start", 7, { turn: 1, step: 2 }),
  answer(8, 1, 2), event("step/end", 9, { turn: 1, step: 2 }),
  event("turn/end", 10, { turn: 1, reason: { kind,
    ...(kind === "aborted" ? { reason: { kind: "user" } } : {}),
    ...(kind === "error" ? { error: { name: "Error", message: "Native failure" } } : {}),
  } }),
];

// The transform exports native test entry points from the unmodified browser
// factory. All folding decisions and view-store actions remain native code.
function exportSeats(source: string) {
  return source.replace("\t\treturn module.exports;", "\t\texports.__fold = { ChatNodeSeat, createChatStore, presentationPolicyFor };\n\t\treturn module.exports;");
}

async function fixture(modules?: string) {
  const load = nativeLoader();
  const capture = <T,>(name: string, expose = false) => load<T>(name, source => {
    const runtime = modules ? readFileSync(join(modules, name, "lib/client.js"), "utf8") : source;
    return expose ? exportSeats(runtime) : runtime;
  });
  capture("@deepseek-ai/dsh-client-modules");
  const conversation = capture<typeof Conversation>("@deepseek-ai/dsh-client-ui-conversation");
  const chat = capture<typeof Chat & { __fold: any }>("@deepseek-ai/dsh-client-ui-chat", true);
  const ctx = new Context(); roots.push(ctx);
  const service = new conversation.UiConversation(ctx, {} as any), noop = () => () => {};
  ctx.provide("slots", { inject: noop, registerFactory: noop } as any);
  ctx.provide("uiSession", { provide: noop } as any);
  ctx.provide("locale", { register: noop, bind: () => () => "" } as any);
  const settings = createSnapshotStore({ value: {} });
  ctx.provide("configForms", { get: () => ({ ...settings, set: async () => {} }) } as any);
  ctx.provide("connection", { state: createSnapshotStore({ connected: true }) } as any);
  chat.apply(ctx);
  service.events.register(humanBoundaryDefinition);
  service.events.register(workerTailDefinition);
  const assembler = new conversation.ConversationNodeAssembler(service.events, service.views, service.groups);
  assembler.activateTarget("chat");
  const read = () => { assembler.flush(); return assembler.get("chat")!; };
  const message = (id = "worker-5") => read().nodes.values().find(node =>
    node.kind === "project-mode-workers-tail" && node.id === `message:${id}`,
  ) as Chat.ChatNode<"project-mode-workers-tail">;
  const nativeStore = chat.__fold.createChatStore().create();
  const policy = chat.__fold.presentationPolicyFor("standard", "completion", "final");
  const useStore = (select: (value: any) => unknown) => React.useSyncExternalStore(
    nativeStore.store.subscribe, () => select(nativeStore.store.getSnapshot()),
  );
  const seat = (key: string) => React.createElement(chat.__fold.ChatNodeSeat, {
    nodeKey: key, nodeStore: read().nodes,
    useChatNode: () => read().nodes.get(key),
    useChatNodeProcess: () => read().nodes.processSource(key).getSnapshot(),
    useChatNodeBottom: () => true, usePresentation: (select: any) => select(policy),
    useStore, actions: nativeStore.actions, deferCollapse: false,
    useGroupAction: () => React.useRef(null), cwd: "/owned-fixture", openFile: noop, inspectCall: noop,
    forkAt: noop, loadImage: noop, fileMentions: noop, t: (key: string) => key,
    renderSlot: (_name: string, owner: any) => <>
      <span>Worker evidence remains available.</span>
      <button onClick={() => owner.turnProcess?.setOpen(!owner.turnProcess.open)}>Toggle collaboration</button>
    </>,
  });
  return { assembler, read, message, seat };
}

const families = [
  { name: "rc3", modules: undefined },
  { name: "rc2", modules: process.env.MOA_COMPAT_MODULES },
];
for (const family of families) describe(`${family.name} native collaboration folding`, () => {
  const check = family.name === "rc2" && !family.modules ? it.skip : it;

  check("shows live communication, folds it after completion, and restores it through the native disclosure action", async () => {
    const f = await fixture(family.modules);
    f.assembler.replaceWindow(initial(), false);
    const message = f.message();
    expect(message).toBeDefined();
    expect(message.groupTree).toBe("process");
    expect(message.data.turn).toBe(1);
    const running = f.read().nodes.processSource(message.key).getSnapshot()!;
    expect(running.turnClosed).toBe(false);
    expect(running.hasInterleavedInput).toBe(false);
    const ui = render(f.seat(message.key));
    const wrapper = () => ui.container.querySelector("[data-chat-node-key]")!;
    expect(wrapper().hasAttribute("data-turn-process-hidden")).toBe(false);
    for (const entry of final()) f.assembler.append(entry);
    const completed = f.read().nodes.processSource(message.key).getSnapshot()!;
    expect(completed.turnClosed).toBe(true);
    expect(completed.hasExternalProcess).toBe(true);
    expect(completed.hasInterleavedInput).toBe(false);
    ui.rerender(f.seat(message.key));
    expect(wrapper().getAttribute("data-turn-process-member")).toBe("true");
    expect(wrapper().getAttribute("data-turn-process-hidden")).toBe("true");
    const finalAnswer = f.read().nodes.values().find(node => node.kind === "assistant-step" && (node.data as any).step === 2)!;
    const finalUi = render(f.seat(finalAnswer.key));
    expect(finalUi.container.querySelector("[data-turn-process-hidden]")).toBeNull();
    fireEvent.click(ui.container.querySelector("button")!);
    expect(wrapper().hasAttribute("data-turn-process-hidden")).toBe(false);
  });

  check("keeps a genuine human steer visible and exempts its surrounding process from automatic folding", async () => {
    const f = await fixture(family.modules);
    f.assembler.replaceWindow([...initial(), human(5.5), ...final()], false);
    const message = f.message(), facts = f.read().nodes.processSource(message.key).getSnapshot()!;
    expect(facts.hasInterleavedInput).toBe(true);
    const ui = render(f.seat(message.key));
    expect(ui.container.querySelector("[data-turn-process-hidden]")).toBeNull();
    expect(f.read().nodes.values().some(node => node.kind === "user" || node.kind === "steering")).toBe(true);
  });

  check("retains the native Turn owner of communication admitted before its first Step", async () => {
    const f = await fixture(family.modules);
    f.assembler.replaceWindow([
      event("turn/start", 1, { turn: 1 }), human(2), incoming(3),
    ], false);
    const message = f.message("worker-3"), anchor = message.anchorSeq;
    expect(message.location.kind).toBe("turn");
    expect(message.data.turn).toBe(1);
    expect(message.data.step).toBe(0);
    expect(message.data.segmentStartSeq).toBe(2);
    expect(f.read().nodes.processSource(message.key).getSnapshot()?.turnClosed).toBe(false);
    const ui = render(f.seat(message.key));
    expect(ui.container.querySelector("[data-turn-process-hidden]")).toBeNull();
    for (const entry of [event("step/start", 4, { turn: 1, step: 1 }), answer(5),
      event("step/end", 6, { turn: 1, step: 1 }), event("turn/end", 7, { turn: 1, reason: { kind: "completed" } }),
    ]) f.assembler.append(entry);
    const completed = f.message("worker-3");
    expect(completed.anchorSeq).toBe(anchor);
    expect(completed.data.turn).toBe(1);
    expect(completed.data.step).toBe(0);
    ui.rerender(f.seat(message.key));
    expect(ui.container.querySelector("[data-turn-process-hidden]")).not.toBeNull();
  });

  check("retains a between-Step Turn owner without adopting either adjacent Step or moving its human segment", async () => {
    const f = await fixture(family.modules);
    f.assembler.replaceWindow([...initial(), event("step/end", 6, { turn: 1, step: 1 }), incoming(6.5)], false);
    const message = f.message("worker-6.5"), anchor = message.anchorSeq;
    expect(message.location.kind).toBe("turn");
    expect(message.data.turn).toBe(1);
    expect(message.data.step).toBe(0);
    expect(message.data.segmentStartSeq).toBe(3);
    for (const entry of final().slice(1)) f.assembler.append(entry);
    const completed = f.message("worker-6.5");
    expect(completed.anchorSeq).toBe(anchor);
    expect(completed.data.turn).toBe(1);
    expect(completed.data.step).toBe(0);
    expect(completed.data.segmentStartSeq).toBe(3);
    const ui = render(f.seat(completed.key));
    expect(ui.container.querySelector("[data-turn-process-hidden]")).not.toBeNull();
  });

  for (const reason of ["aborted", "interrupted", "error"]) check(`keeps a ${reason} process open instead of presenting it as successful completion`, async () => {
    const f = await fixture(family.modules);
    f.assembler.replaceWindow([...initial(), ...final(reason)], false);
    const message = f.message();
    const ui = render(f.seat(message.key));
    expect(ui.container.querySelector("[data-turn-process-hidden]")).toBeNull();
  });

  check("keeps completed historical communication separate from a later live turn", async () => {
    const f = await fixture(family.modules);
    f.assembler.replaceWindow([...initial(), ...final(),
      event("turn/start", 11, { turn: 2 }), event("step/start", 12, { turn: 2, step: 1 }), human(13),
      answer(14, 2, 1, "A later task"), incoming(15),
    ], false);
    const earlier = f.message(), later = f.message("worker-15");
    expect(earlier.data.turn).toBe(1); expect(later.data.turn).toBe(2);
    expect(earlier.data.segmentStartSeq).toBe(3); expect(later.data.segmentStartSeq).toBe(13);
    const oldUi = render(f.seat(earlier.key)), liveUi = render(f.seat(later.key));
    expect(oldUi.container.querySelector("[data-turn-process-hidden]")).not.toBeNull();
    expect(liveUi.container.querySelector("[data-turn-process-hidden]")).toBeNull();
  });

  check("does not hide a loaded message whose native turn boundary is outside the history window", async () => {
    const f = await fixture(family.modules);
    f.assembler.replaceWindow([incoming(50)], true);
    const message = f.message("worker-50");
    expect(message.data.turn).toBe(0);
    expect(f.read().nodes.processSource(message.key).getSnapshot()).toBeUndefined();
    const ui = render(f.seat(message.key));
    expect(ui.container.querySelector("[data-turn-process-hidden]")).toBeNull();
    expect(ui.getByText("Worker evidence remains available.")).toBeDefined();
  });

  check("does not invent Turn ownership for an unassigned message between two native Turns", async () => {
    const f = await fixture(family.modules);
    f.assembler.replaceWindow([...initial(), ...final(), incoming(11),
      event("turn/start", 12, { turn: 2 }), event("step/start", 13, { turn: 2, step: 1 }), human(14),
      answer(15, 2, 1), event("step/end", 16, { turn: 2, step: 1 }),
      event("turn/end", 17, { turn: 2, reason: { kind: "completed" } }),
    ], false);
    const message = f.message("worker-11");
    expect(message.location.kind).toBe("session");
    expect(message.data.turn).toBe(0);
    expect(message.anchorSeq).toBe(11.2);
    expect(f.read().nodes.processSource(message.key).getSnapshot()).toBeUndefined();
    const ui = render(f.seat(message.key));
    expect(ui.container.querySelector("[data-turn-process-hidden]")).toBeNull();
  });
});
