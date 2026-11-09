// @vitest-environment jsdom
import { it, expect } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type * as Conversation from "@deepseek-ai/dsh-client-ui-conversation/client";
import type * as Chat from "@deepseek-ai/dsh-client-ui-chat/client";
import {
  workerTailDefinition,
  humanBoundaryDefinition,
  segmentTail,
  segmentHistoryTarget,
} from "../../packages/moa/src/client/tail.ts";
import type {
  SessionEvent,
  SessionEventType,
  SessionEventMap,
  SessionSeq,
} from "@deepseek-ai/dsh-session/types";
import type { SessionTransientEventEntry } from "@deepseek-ai/dsh-api-session-controller/client";
import {
  ToolCallId,
  MessageId,
  LlmAttemptId,
} from "@deepseek-ai/dsh-llm/brand";
import { nativeLoader } from "./native-loader.ts";
import { MoAStore } from "../../packages/moa/src/client/store.ts";
import { snapshot, sid } from "./fixture.ts";
const event = <K extends SessionEventType>(
  type: K,
  seq: number,
  data: SessionEventMap[K],
): { type: "event"; event: SessionEvent<K> } => ({
  type: "event",
  event: {
    type,
    seq: seq as SessionSeq,
    time: seq * 1000,
    data,
    ...(type === "tool/result" ||
    type === "assistant/message" ||
    type === "user/message"
      ? { surfaceOp: "append" }
      : {}),
  } as SessionEvent<K>,
});

it("keeps a previous segment tail above human steer in the same native turn and reconstructs both segments from history", async () => {
  const capture = nativeLoader();
  capture("@deepseek-ai/dsh-client-modules");
  const conv = capture<typeof Conversation>(
    "@deepseek-ai/dsh-client-ui-conversation",
  );
  const chat = capture<typeof Chat>("@deepseek-ai/dsh-client-ui-chat");
  const ctx = new Context();
  try {
    const service = new conv.UiConversation(ctx, {} as any),
      noop = () => () => {};
    ctx.provide("slots", { inject: noop, registerFactory: noop } as any);
    ctx.provide("uiSession", { provide: noop } as any);
    ctx.provide("locale", { register: noop, bind: () => () => "" } as any);
    const setting = createSnapshotStore({ value: {} });
    ctx.provide("configForms", {
      get: () => ({ ...setting, set: async () => {} }),
    } as any);
    chat.apply(ctx);
    if (humanBoundaryDefinition)
      service.events.register(humanBoundaryDefinition);
    service.events.register(workerTailDefinition);
    const a = new conv.ConversationNodeAssembler(
      service.events,
      service.views,
      service.groups,
    );
    const input = (seq: number, text: string) =>
      event("user/message", seq, {
        id: MessageId("human-" + seq),
        role: "user",
        source: { kind: "user" },
        content: [{ type: "text", text }],
      });
    const entries = [
      event("turn/start", 1, { turn: 1 }),
      event("step/start", 2, { turn: 1, step: 1 }),
      input(3, "work"),
      chunk(3.1, "first"),
      event("step/end", 4, { turn: 1, step: 1 }),
    ];
    a.replaceWindow(entries, false);
    a.activateTarget("chat");
    const read = () => {
      a.flush();
      return a.get("chat")!;
    };
    const seats = () =>
      read()
        .nodes.values()
        .filter(
          (n) => n.kind === "project-mode-workers-tail",
        ) as Chat.ChatNode<"project-mode-workers-tail">[];
    const before = seats()[0];
    expect(before.data.segmentStartSeq).toBe(3);
    const later = [
      event("step/start", 5, { turn: 1, step: 2 }),
      input(6, "可以"),
      chunk(6.1, "continued", 2),
    ];
    for (const e of later) a.append(e);
    const second = seats().find((n) => n.data.segmentStartSeq === 6)!;
    expect(second).toBeDefined();
    expect(read().nodes.get(before.key)?.anchorSeq).toBe(before.anchorSeq);
    const human = read()
      .nodes.values()
      .find((n) => n.kind === "user" && (n.data as any).seq === 6)!;
    expect(read().order.indexOf(before.key)).toBeLessThan(
      read().order.indexOf(human.key),
    );
    expect(read().order.indexOf(before.key)).toBeLessThan(
      read().order.indexOf(second.key),
    );
    expect(segmentTail(read(), before)?.segmentStartSeq).toBe(3);
    expect(segmentTail(read(), second)?.segmentStartSeq).toBe(6);
    a.append(event("step/end", 7, { turn: 1, step: 2 }));
    a.append(event("step/start", 8, { turn: 1, step: 3 }));
    a.append(chunk(8.1, "more", 3));
    const third = seats().find((n) => n.data.step === 3)!;
    expect(segmentTail(read(), second)).toBeNull();
    expect(segmentTail(read(), third)?.segmentStartSeq).toBe(6);
    const end = event("turn/end", 9, {
      turn: 1,
      reason: { kind: "completed" },
    });
    a.append(end);
    expect(read().nodes.get(before.key)?.visibility).toBe("visible");
    expect(segmentTail(read(), before)?.closed).toBe(true);
    a.replaceWindow(
      [
        ...entries,
        ...later,
        event("step/end", 7, { turn: 1, step: 2 }),
        event("step/start", 8, { turn: 1, step: 3 }),
        chunk(8.1, "more", 3),
        end,
      ],
      false,
    );
    const restored = seats();
    expect(restored.find((n) => n.key === before.key)?.anchorSeq).toBe(
      before.anchorSeq,
    );
    expect(
      restored
        .filter((n) => segmentTail(read(), n))
        .map((n) => n.data.segmentStartSeq),
    ).toEqual([3, 6]);
  } finally {
    await ctx.fiber.dispose();
    delete (window as any).__ModuleLoader__;
  }
});
const chunk = (
  seq: number,
  text: string,
  step = 1,
): SessionTransientEventEntry => ({
  type: "transient",
  event: {
    type: "assistant/live-chunk",
    seq,
    time: seq * 1000,
    data: {
      turn: 1,
      step,
      attemptId: LlmAttemptId("a" + step),
      chunk: { type: "text-delta", index: 0, text },
    },
  },
});

it("loads the canonical native boundary for a partial turn without moving its worker onto an unloaded passive human segment", async () => {
  const capture = nativeLoader();
  capture("@deepseek-ai/dsh-client-modules");
  const conv = capture<typeof Conversation>(
    "@deepseek-ai/dsh-client-ui-conversation",
  );
  const chat = capture<typeof Chat>("@deepseek-ai/dsh-client-ui-chat");
  const ctx = new Context();
  const store = new MoAStore();
  try {
    const service = new conv.UiConversation(ctx, {} as any),
      noop = () => () => {};
    ctx.provide("slots", { inject: noop, registerFactory: noop } as any);
    ctx.provide("uiSession", { provide: noop } as any);
    ctx.provide("locale", { register: noop, bind: () => () => "" } as any);
    const setting = createSnapshotStore({ value: {} });
    ctx.provide("configForms", {
      get: () => ({ ...setting, set: async () => {} }),
    } as any);
    chat.apply(ctx);
    service.events.register(humanBoundaryDefinition);
    service.events.register(workerTailDefinition);
    const a = new conv.ConversationNodeAssembler(
      service.events,
      service.views,
      service.groups,
    );
    const assistant = (seq: number, step: number) =>
      event("assistant/message", seq, {
        turn: 1,
        step,
        message: {
          id: MessageId("assistant-" + seq),
          source: { kind: "model", provider: "fixture", model: "fixture" },
          role: "assistant",
          content: [{ type: "text", text: "still working" }],
        },
        stream: [],
      });
    const human = (seq: number, text: string) =>
      event("user/message", seq, {
        id: MessageId("human-" + seq),
        role: "user",
        source: { kind: "user" },
        content: [{ type: "text", text }],
      });
    const project = snapshot();
    project.turnMemberships = [
      {
        ...project.turnMemberships[0],
        coordinatorTurn: 1,
        segmentStartSeq: 3,
        participationSeq: 5,
      },
    ];
    store.accept(project);
    a.replaceWindow([assistant(101, 3)], true);
    a.activateTarget("chat");
    const read = () => {
      a.flush();
      return a.get("chat")!;
    };
    const tails = () =>
      read()
        .nodes.values()
        .filter(
          (node) => node.kind === "project-mode-workers-tail",
        ) as Chat.ChatNode<"project-mode-workers-tail">[];
    const unknown = tails()[0];
    expect(unknown.data.segmentStartSeq).toBe(0);
    expect(store.turn(sid("parent"), 1, false, 0)).toHaveLength(0);
    expect(segmentHistoryTarget(read(), unknown, [])).toBeUndefined();
    expect(
      segmentHistoryTarget(read(), unknown, [
        {
          ...project.turnMemberships[0],
          coordinatorTurn: 2,
        },
      ]),
    ).toBeUndefined();
    expect(
      segmentHistoryTarget(read(), unknown, [
        {
          ...project.turnMemberships[0],
          participationSeq: 102,
        },
      ]),
    ).toBeUndefined();
    expect(segmentHistoryTarget(read(), unknown, project.turnMemberships)).toBe(
      3,
    );
    a.append(event("step/start", 102, { turn: 1, step: 4 }));
    a.append(assistant(103, 4));
    expect(
      segmentHistoryTarget(read(), unknown, project.turnMemberships),
    ).toBeUndefined();
    expect(
      tails().filter(
        (node) =>
          segmentHistoryTarget(read(), node, project.turnMemberships) !==
          undefined,
      ),
    ).toHaveLength(1);

    // Native loadThrough(3) prepends the full intervening window, including the
    // passive human at seq90. Mapping the unknown seat to the latest membership
    // without this history would incorrectly put its capsule below that human.
    a.prepend(
      [
        event("turn/start", 1, { turn: 1 }),
        event("step/start", 2, { turn: 1, step: 1 }),
        human(3, "delegate work"),
        event("tool/call", 5, {
          turn: 1,
          step: 1,
          callId: ToolCallId("dispatch"),
          name: "control_workers",
          arguments: "{}",
        }),
        assistant(10, 1),
        event("step/end", 11, { turn: 1, step: 1 }),
        event("step/start", 12, { turn: 1, step: 2 }),
        human(90, "可以"),
        assistant(95, 2),
        event("step/end", 96, { turn: 1, step: 2 }),
        event("step/start", 100, { turn: 1, step: 3 }),
      ],
      false,
    );
    const selected = tails()
      .filter((node) => segmentTail(read(), node))
      .sort(
        (a, b) => read().order.indexOf(a.key) - read().order.indexOf(b.key),
      );
    expect(selected.map((node) => node.data.segmentStartSeq)).toEqual([3, 90]);
    expect(
      selected.map(
        (node) =>
          store.turn(sid("parent"), 1, false, node.data.segmentStartSeq).length,
      ),
    ).toEqual([1, 0]);
    expect(
      selected.map((node) =>
        segmentHistoryTarget(read(), node, project.turnMemberships),
      ),
    ).toEqual([undefined, undefined]);

    // Result notifications lack explicit turn/step, but the native contextual
    // location still supplies a valid seat before the missing boundary loads.
    a.replaceWindow(
      [
        event("step/start", 100, { turn: 1, step: 3 }),
        event("user/message", 101, {
          id: MessageId("result-only"),
          role: "user",
          source: { kind: "project-mode-result" } as any,
          content: [{ type: "text", text: "canonical final" }],
        }),
      ],
      true,
    );
    const resultSeat = tails()[0];
    expect(resultSeat.data.segmentStartSeq).toBe(0);
    expect(
      segmentHistoryTarget(read(), resultSeat, project.turnMemberships),
    ).toBe(3);
    a.prepend(
      [
        event("turn/start", 1, { turn: 1 }),
        event("step/start", 2, { turn: 1, step: 1 }),
        human(3, "delegate work"),
      ],
      false,
    );
    expect(tails()[0].data.segmentStartSeq).toBe(3);
    expect(store.turn(sid("parent"), 1, false, 3)).toHaveLength(1);
  } finally {
    store.dispose();
    await ctx.fiber.dispose();
    delete (window as any).__ModuleLoader__;
  }
});
it("real published chat grouping selects one segment tail through streaming, steps, tools and native closure/prepend", async () => {
  const capture = nativeLoader();
  capture("@deepseek-ai/dsh-client-modules");
  const conv = capture<typeof Conversation>(
    "@deepseek-ai/dsh-client-ui-conversation",
  );
  const chat = capture<typeof Chat>("@deepseek-ai/dsh-client-ui-chat");
  const ctx = new Context();
  try {
    const service = new conv.UiConversation(ctx, {} as any);
    const noop = () => () => {};
    ctx.provide("slots", { inject: noop, registerFactory: noop } as any);
    ctx.provide("uiSession", { provide: noop } as any);
    ctx.provide("locale", { register: noop, bind: () => () => "" } as any);
    const setting = createSnapshotStore({ value: {} });
    ctx.provide("configForms", {
      get: () => ({ ...setting, set: async () => {} }),
    } as any);
    chat.apply(ctx);
    const dispose = service.events.register(workerTailDefinition);
    const a = new conv.ConversationNodeAssembler(
      service.events,
      service.views,
      service.groups,
    );
    a.replaceWindow(
      [
        event("turn/start", 1, { turn: 1 }),
        event("step/start", 2, { turn: 1, step: 1 }),
      ],
      false,
    );
    a.activateTarget("chat");
    const read = () => {
      a.flush();
      return a.get("chat")!;
    };
    let s = read();
    const tails = () =>
      [...s.nodes.values()].filter(
        (n) => n.kind === "project-mode-workers-tail",
      );
    a.append(chunk(2.1, "hello"));
    s = read();
    const key = tails()[0]?.key;
    expect(key).toBeDefined();
    const assertLast = () => {
      s = read();
      const selected = tails().filter((n) =>
        segmentTail(s, n as Chat.ChatNode<"project-mode-workers-tail">),
      );
      expect(selected).toHaveLength(1);
      expect(selected[0].groupTree).toBe("turn");
      const keys = s.locations.getTurn(1) ?? [];
      expect(keys.at(-1)).toBe(selected[0].key);
    };
    assertLast();
    a.append(chunk(2.2, " world"));
    assertLast();
    expect(
      [...s.nodes.values()].find((n) => n.kind === "assistant-step")?.data,
    ).toMatchObject({ blocks: [{ kind: "text", text: "hello world" }] });
    a.append(event("step/end", 3, { turn: 1, step: 1 }));
    a.append(event("step/start", 4, { turn: 1, step: 2 }));
    a.append(
      event("tool/call", 5, {
        turn: 1,
        step: 2,
        callId: ToolCallId("tool"),
        name: "read_file",
        arguments: '{"path":"a"}',
      }),
    );
    assertLast();
    a.append(
      event("tool/result", 6, {
        turn: 1,
        step: 2,
        message: {
          id: MessageId("tool-result"),
          source: { kind: "tool", callId: ToolCallId("tool") },
          role: "tool",
          toolCallId: ToolCallId("tool"),
          content: [{ type: "text", text: "ok" }],
        },
      }),
    );
    assertLast();
    a.append(chunk(6.1, "after tools", 2));
    assertLast();
    a.settleAssistant(
      LlmAttemptId("a2"),
      event("assistant/message", 7, {
        turn: 1,
        step: 2,
        message: {
          id: MessageId("message"),
          source: { kind: "model", provider: "fixture", model: "fixture" },
          role: "assistant",
          content: [{ type: "text", text: "after tools" }],
        },
        stream: [],
      }),
    );
    assertLast();
    expect(
      [...s.nodes.values()].find((n) => n.kind === "tool-call")?.data,
    ).toMatchObject({ root: { callId: "tool", kind: "tool-result" } });
    expect(
      [...s.nodes.values()].filter((n) => n.kind === "assistant-step").length,
    ).toBeGreaterThan(0);
    a.append(event("turn/end", 8, { turn: 1, reason: { kind: "completed" } }));
    s = read();
    expect(tails()[0].visibility).toBe("visible");
    expect(s.locations.getTurn(1)).toContain(key);
    expect(
      [...s.nodes.values()].filter((n) => n.kind === "turn-tail"),
    ).toHaveLength(1);
    a.replaceWindow([chunk(2.1, "hello"), chunk(2.2, " world")], true);
    assertLast();
    a.prepend(
      [
        event("turn/start", 1, { turn: 1 }),
        event("step/start", 2, { turn: 1, step: 1 }),
      ],
      false,
    );
    assertLast();
    a.settleAssistant(LlmAttemptId("a1"));
    s = read();
    expect(
      tails().filter((n) =>
        segmentTail(s, n as Chat.ChatNode<"project-mode-workers-tail">),
      ),
    ).toHaveLength(0);
    dispose();
    expect(
      service.events
        .entries()
        .some((e) => e.kind === "project-mode-workers-tail"),
    ).toBe(false);
  } finally {
    await ctx.fiber.dispose();
    delete (window as any).__ModuleLoader__;
  }
});
