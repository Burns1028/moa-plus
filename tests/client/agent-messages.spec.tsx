// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
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
  const draw = (node: Chat.ChatNode<"project-mode-workers-tail">, sessionId = "parent") => render(React.createElement(entry.component as React.ComponentType<any>, {
    ...entry.inject?.(), sessionId: sid(sessionId), node, t,
    useChat: (select: any) => select(read()),
    useSession: (select: any) => select({ openState: "open", loadingOlder: false }),
  }));
  return { assembler, read, draw, client };
}

it("shows each MoA input once with its sender and original Markdown, preserving ordinary native contexts", async () => {
  const b = await bench();
  b.assembler.replaceWindow([
    event("turn/start", 1, { turn: 1 }), event("step/start", 2, { turn: 1, step: 1 }),
    input(3, { kind: "moa-message", form: "relay", senderId: "child", rootId: "parent", operationId: "peer-1" }, "From: child\n**Ready**\n\n- evidence"),
    input(4, { kind: "agent-message", form: "relay", senderSessionId: "ordinary-agent" }, "ordinary native message"),
  ], false);
  const nodes = [...b.read().nodes.values()];
  expect(nodes.filter(n => n.anchorSeq >= 3 && n.anchorSeq < 4)).toHaveLength(1);
  const incoming = nodes.find(n => n.kind === "project-mode-workers-tail") as Chat.ChatNode<"project-mode-workers-tail">;
  expect(incoming).toBeDefined();
  const ui = b.draw(incoming, "another-worker");
  expect(screen.getByText("From Builder")).toBeDefined();
  expect(ui.container.querySelector("strong")?.textContent).toBe("Ready");
  expect(screen.getByText("evidence")).toBeDefined();
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
  expect(b.read().nodes.processSource(first.key).getSnapshot()?.hasInterleavedInput).toBe(true);
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
  expect(screen.getByRole("heading", { name: "Exact result" })).toBeDefined();
  expect(ui.container.textContent).not.toContain("Completion done");
  expect(ui.container.querySelectorAll(".pm-capsule")).toHaveLength(1);
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
