// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type * as Renderer from "@deepseek-ai/dsh-client-ui-renderer/client";
import type * as Conversation from "@deepseek-ai/dsh-client-ui-conversation/client";
import type * as Chat from "@deepseek-ai/dsh-client-ui-chat/client";
import { apply, inject } from "../../packages/project-mode/src/client/index.tsx";
import { segmentTail } from "../../packages/project-mode/src/client/tail.ts";
import { nativeLoader } from "./native-loader.ts";
import { snapshot, sid } from "./fixture.ts";
import { submissionFixture } from "./submission-fixture.ts";
import { en } from "../../packages/project-mode/src/client/locales.ts";

const roots: Context[] = [];
afterEach(async () => {
  cleanup();
  for (const root of roots.splice(0).reverse()) await root.fiber.dispose();
  delete (window as any).__ModuleLoader__;
});
const event = (type: string, seq: number, data: unknown) => ({
  type: "event", event: { type, seq, time: seq * 1000, surfaceOp: "append", data },
}) as any;
const input = (seq: number, source: Record<string, unknown>, text: string) =>
  event("user/message", seq, { id: `input-${seq}`, role: "user", source, content: [{ type: "text", text }] });

async function bench() {
  const capture = nativeLoader();
  capture("@deepseek-ai/dsh-client-modules");
  const renderer = capture<typeof Renderer>("@deepseek-ai/dsh-client-ui-renderer");
  const conv = capture<typeof Conversation>("@deepseek-ai/dsh-client-ui-conversation");
  const chat = capture<typeof Chat>("@deepseek-ai/dsh-client-ui-chat");
  const model = new Context(); roots.push(model);
  const conversation = new conv.UiConversation(model, {} as any), noop = () => () => {};
  model.provide("slots", { inject: noop, registerFactory: noop } as any);
  model.provide("uiSession", { provide: noop } as any);
  model.provide("locale", { register: noop, bind: () => () => "" } as any);
  const setting = createSnapshotStore({ value: {} });
  model.provide("configForms", { get: () => ({ ...setting, set: async () => {} }) } as any);
  chat.apply(model);
  const root = new Context(); roots.push(root);
  const slots = new renderer.SlotRegistry(root);
  root.provide("uiConversation", conversation); submissionFixture(root);
  const remote = { catalog: async () => ({ ok: true, value: [] }) };
  root.provide("remote", { $mount: async () => () => {}, projectMode: remote } as any);
  root.provide("remote.projectMode", remote);
  root.provide("uiWorkspace", {} as any);
  root.provide("workspaces", {} as any);
  root.provide("locale", { register: noop } as any);
  root.provide("sessions", { list: createSnapshotStore({ ids: [], byId: {} }) } as any);
  slots.register({ name: "root", children: { "conversation.chat.node": { kind: "keyed", scope: "session" } } } as any, (() => null) as any);
  await root.plugin({ inject, apply });
  const entry = slots.entries("conversation.chat.node").find(e => e.options.key === "project-mode-workers-tail")!;
  const client = (entry.inject?.() as any).client;
  client.store.accept(snapshot());
  const assembler = new conv.ConversationNodeAssembler(conversation.events, conversation.views, conversation.groups);
  assembler.activateTarget("chat");
  const read = () => { assembler.flush(); return assembler.get("chat")!; };
  const t = (key: keyof typeof en, args?: Record<string, string>) => Object.entries(args ?? {}).reduce((text, [k, v]) => text.replace(`{${k}}`, v), en[key] as string);
  const draw = (node: Chat.ChatNode<"project-mode-workers-tail">, sessionId = "parent") => {
    const element = () => React.createElement(entry.component as React.ComponentType<any>, {
    ...entry.inject?.(), sessionId: sid(sessionId), node, t,
    useChat: (select: any) => select(read()),
    useSession: (select: any) => select({ openState: "open", loadingOlder: false }),
    });
    const ui = render(element());
    return { ...ui, refresh: () => ui.rerender(element()) };
  };
  return { assembler, read, draw, client };
}

it.each(["parent", "another-worker"])("shows a worker message in %s as a compact process card that opens its original Markdown, preserving ordinary native contexts", async recipient => {
  const b = await bench();
  const body = "**Ready**\n\n- evidence\n\n" + "Complete reusable evidence. ".repeat(30) + "\n\n### Final evidence\n\nOriginal final paragraph.";
  b.assembler.replaceWindow([
    event("turn/start", 1, { turn: 1 }), event("step/start", 2, { turn: 1, step: 1 }),
    input(3, { kind: "moa-message", form: "relay", senderId: "child", rootId: "parent", operationId: "peer-1" }, `From: child\n${body}`),
    input(4, { kind: "agent-message", form: "relay", senderSessionId: "ordinary-agent" }, "ordinary native message"),
  ], false);
  const nodes = [...b.read().nodes.values()];
  expect(nodes.filter(n => n.anchorSeq >= 3 && n.anchorSeq < 4)).toHaveLength(1);
  const incoming = nodes.find(n => n.kind === "project-mode-workers-tail") as Chat.ChatNode<"project-mode-workers-tail">;
  expect(incoming).toBeDefined();
  const ui = b.draw(incoming, recipient);
  expect(screen.getByText("From Builder")).toBeDefined();
  const message = ui.container.querySelector<HTMLElement>("[data-moa-message]")!;
  expect(getComputedStyle(message).marginLeft).toBe("0px");
  expect(getComputedStyle(message).marginRight).toBe("0px");
  const disclosure = ui.container.querySelector("details")!;
  expect(disclosure).not.toBeNull();
  expect(disclosure.open).toBe(false);
  expect(disclosure.querySelector("summary")?.textContent?.replace(/\s+/g, " ")).toContain("Ready evidence");
  expect(ui.container.querySelector("strong")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Final evidence" })).toBeNull();
  fireEvent.click(disclosure.querySelector("summary")!);
  expect(await screen.findByRole("heading", { name: "Final evidence" })).toBeDefined();
  expect(disclosure.open).toBe(true);
  expect(ui.container.querySelector("strong")?.textContent).toBe("Ready");
  expect(screen.getByText("evidence")).toBeDefined();
  expect(screen.getByText("Original final paragraph.")).toBeDefined();
  expect(ui.container.textContent).not.toContain("From: child");
  expect(nodes.some(n => (n.data as any).source?.senderSessionId === "ordinary-agent" && n.kind !== "project-mode-workers-tail")).toBe(true);
});

it("keeps an incoming message readable after later output takes the capsule seat", async () => {
  const b = await bench();
  b.assembler.replaceWindow([
    event("turn/start", 1, { turn: 1 }), event("step/start", 2, { turn: 1, step: 1 }),
    input(3, { kind: "user" }, "delegate"),
    event("tool/call", 4, { turn: 1, step: 1, callId: "first-call", name: "read", arguments: "{}" }),
    input(6, { kind: "moa-message", form: "relay", senderId: "child", rootId: "parent", operationId: "peer-2" }, "From: child\nEarlier progress"),
  ], false);
  const first = [...b.read().nodes.values()].find(n => n.kind === "project-mode-workers-tail" && n.anchorSeq > 6) as Chat.ChatNode<"project-mode-workers-tail">;
  expect(first).toBeDefined();
  const anchor = first.anchorSeq;
  b.assembler.append(event("tool/call", 7, { turn: 1, step: 1, callId: "call-1", name: "read", arguments: "{}" }));
  const later = [...b.read().nodes.values()].filter(n => n.kind === "project-mode-workers-tail") as Chat.ChatNode<"project-mode-workers-tail">[];
  expect(b.read().nodes.get(first.key)?.anchorSeq).toBe(anchor);
  expect(segmentTail(b.read(), first)).toBeNull();
  expect(later.filter(n => segmentTail(b.read(), n))).toHaveLength(1);
  expect(b.read().nodes.processSource(first.key).getSnapshot()?.hasInterleavedInput).toBe(false);
  const ui = b.draw(first);
  expect(screen.getByText("Earlier progress")).toBeDefined();
  expect(ui.container.querySelector(".pm-capsules")).toBeNull();
});

it("retains a result-only capsule seat and original final content without its routing header", async () => {
  const b = await bench();
  const project = snapshot();
  project.turnMemberships = [{ ...project.turnMemberships[0], coordinatorTurn: 1, segmentStartSeq: 3, participationSeq: 4 }];
  b.client.store.accept({ ...project, revision: 2, project: { ...project.project, revision: 2 } });
  b.assembler.replaceWindow([
    event("turn/start", 1, { turn: 1 }), event("step/start", 2, { turn: 1, step: 1 }), input(3, { kind: "user" }, "delegate"),
    event("user/message", 4, { id: "result", role: "user", source: { kind: "project-mode-result", form: "relay", workerId: "child", workerTurn: 1, completionId: "done" }, content: [
      { type: "text", text: "Worker Builder (child), turn 1, outcome completed. Completion done. Final assistant answer at seq 11:" },
      { type: "text", text: "### Exact result\n\nKeep the complete answer." },
    ] }),
  ], false);
  const nodes = [...b.read().nodes.values()];
  expect(nodes.filter(n => n.anchorSeq >= 4 && n.anchorSeq < 5)).toHaveLength(1);
  const result = nodes.find(n => n.kind === "project-mode-workers-tail") as Chat.ChatNode<"project-mode-workers-tail">;
  expect(segmentTail(b.read(), result)?.segmentStartSeq).toBe(3);
  const ui = b.draw(result);
  expect(screen.getByText("From Builder")).toBeDefined();
  expect(getComputedStyle(ui.container.querySelector("[data-moa-message]")!).marginLeft).toBe("0px");
  const disclosure = ui.container.querySelector("details")!;
  expect(disclosure.open).toBe(false);
  fireEvent.click(disclosure.querySelector("summary")!);
  expect(await screen.findByRole("heading", { name: "Exact result" })).toBeDefined();
  expect(ui.container.textContent).not.toContain("Completion done");
  expect(ui.container.querySelectorAll(".pm-capsule")).toHaveLength(1);
});

it("previews the actual final answer and keeps reasoning separate from the message disclosure", async () => {
  const b = await bench();
  b.assembler.replaceWindow([
    event("turn/start", 1, { turn: 1 }), event("step/start", 2, { turn: 1, step: 1 }),
    event("user/message", 4, { id: "reasoned-result", role: "user", source: {
      kind: "project-mode-result", form: "relay", workerId: "child", workerTurn: 1, completionId: "reasoned-done",
    }, content: [
      { type: "text", text: "Worker Builder (child), turn 1, outcome completed. Completion reasoned-done. Final assistant answer at seq 11:" },
      { type: "reasoning", text: "Internal comparison of the two approaches." },
      { type: "text", text: "### Deliverable\n\n**Ready**. [View artifact](https://example.invalid/artifact)." },
    ] }),
  ], false);
  const node = [...b.read().nodes.values()].find(n => n.kind === "project-mode-workers-tail") as Chat.ChatNode<"project-mode-workers-tail">;
  const ui = b.draw(node);
  const message = ui.container.querySelector<HTMLDetailsElement>("[data-moa-message]")!;
  expect(message.querySelector("summary")?.textContent).toContain("Deliverable Ready");
  expect(ui.container.textContent).not.toContain("Internal comparison");
  expect(ui.container.textContent).not.toContain("Message content");
  expect(screen.getByText("Report")).toBeDefined();
  fireEvent.click(message.querySelector("summary")!);
  expect(await screen.findByRole("heading", { name: "Deliverable" })).toBeDefined();
  expect(message.querySelector("summary .pm-agent-preview")).toBeNull();
  expect(message.querySelector("summary h3")).toBeNull();
  const reasoning = message.querySelector<HTMLDetailsElement>(".pm-agent-reasoning")!;
  expect(reasoning.open).toBe(false);
  expect(ui.container.textContent).not.toContain("Internal comparison");
  fireEvent.click(screen.getByRole("link", { name: "View artifact" }));
  expect(message.open).toBe(true);
  fireEvent.click(reasoning.querySelector("summary")!);
  expect(await screen.findByText("Internal comparison of the two approaches.")).toBeDefined();
  expect(message.open).toBe(true);
});

it("shows a loaded MoA message even when its turn boundary is outside the history window", async () => {
  const b = await bench();
  b.assembler.replaceWindow([
    input(50, { kind: "moa-message", form: "relay", senderId: "parent", rootId: "parent", operationId: "partial" }, "From: parent\nContinue the investigation."),
  ], true);
  const node = [...b.read().nodes.values()].find(n => n.kind === "project-mode-workers-tail") as Chat.ChatNode<"project-mode-workers-tail">;
  expect(node).toBeDefined();
  expect(segmentTail(b.read(), node)).toBeNull();
  b.draw(node, "child");
  expect(screen.getByText("From Coordinator")).toBeDefined();
  expect(screen.getByText("Continue the investigation.")).toBeDefined();
});

it.each([
  { kind: "project-mode-assignment", reason: "completed" },
  { kind: "moa-message", reason: "handoff" },
])("keeps the opening $kind task expanded after $reason through the registered client slot", async ({ kind, reason }) => {
  const b = await bench();
  const source = kind === "moa-message"
    ? { kind, form: "relay", senderId: "parent", rootId: "parent", operationId: "opening" }
    : { kind, form: "relay", coordinatorSessionId: "parent", operationId: "opening" };
  b.assembler.replaceWindow([
    event("turn/start", 1, { turn: 1 }), event("step/start", 2, { turn: 1, step: 1 }),
    input(3, source, `${kind === "moa-message" ? "From: parent\n" : ""}### Assigned task\n\n**Keep this request visible.**`),
    event("assistant/message", 4, { turn: 1, step: 1, message: {
      id: "answer", role: "assistant", source: { kind: "model", provider: "fixture", model: "fixture" },
      content: [{ type: "text", text: "Task completed." }],
    }, stream: [] }),
    event("step/end", 5, { turn: 1, step: 1 }), event("turn/end", 6, { turn: 1, reason: { kind: reason } }),
  ], false);
  const node = [...b.read().nodes.values()].find(n => n.kind === "project-mode-workers-tail" && n.data.incoming) as Chat.ChatNode<"project-mode-workers-tail">;
  const ui = b.draw(node, "child");
  const card = ui.container.querySelector<HTMLDetailsElement>("[data-moa-message]")!;
  expect(card.open).toBe(true);
  expect(card.hasAttribute("data-settled")).toBe(false);
  expect(ui.getByRole("heading", { name: "Assigned task" })).toBeDefined();
  expect(ui.container.querySelector("strong")?.textContent).toBe("Keep this request visible.");
  fireEvent.click(card.querySelector("summary")!);
  ui.refresh();
  expect(card.open).toBe(false);
  await waitFor(() => expect(card.querySelector(".pm-agent-preview")?.textContent).toContain("Keep this request visible."));
});

it.each(["completed", "handoff", "aborted"])("settles a message after %s while retaining manual access and visible failed work", async reason => {
  const b = await bench();
  b.assembler.replaceWindow([
    event("turn/start", 1, { turn: 1 }), event("step/start", 2, { turn: 1, step: 1 }),
    input(3, { kind: "moa-message", form: "relay", senderId: "child", rootId: "parent", operationId: "settle" },
      "From: child\n### Evidence\n\nFull original report."),
  ], false);
  const node = [...b.read().nodes.values()].find(n => n.kind === "project-mode-workers-tail") as Chat.ChatNode<"project-mode-workers-tail">;
  const ui = b.draw(node);
  const card = ui.container.querySelector<HTMLDetailsElement>("[data-moa-message]")!;
  expect(card.querySelector(".pm-agent-preview")).not.toBeNull();
  fireEvent.click(card.querySelector("summary")!);
  expect(await screen.findByRole("heading", { name: "Evidence" })).toBeDefined();
  b.assembler.append(event("turn/end", 5, { turn: 1, reason: { kind: reason,
    ...(reason === "aborted" ? { reason: { kind: "user" } } : {}),
  } }));
  ui.refresh();
  if (reason === "aborted") {
    expect(card.open).toBe(true);
    expect(screen.getByRole("heading", { name: "Evidence" })).toBeDefined();
  } else {
    expect(card.open).toBe(false);
    expect(card.querySelector(".pm-agent-preview")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Evidence" })).toBeNull();
    fireEvent.click(card.querySelector("summary")!);
    expect(await screen.findByRole("heading", { name: "Evidence" })).toBeDefined();
    ui.refresh();
    expect(card.open).toBe(true);
  }
});
