import { expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import Sessions, { SessionId, SessionLogOffset, SessionSeq, type SessionEvent } from "@deepseek-ai/dsh-session";
import Projections from "@deepseek-ai/dsh-session-projection";
import { createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { snapshotJsonValue } from "@deepseek-ai/dsh-util-values";
import { projection, type Projection } from "../../packages/project-mode/src/host/state.ts";

function fold() {
  let state = projection.init({} as never, SessionLogOffset(0));
  let seq = 0;
  const events: SessionEvent[] = [];
  const apply = (type: string, data: unknown) => {
    const event = { type, data, seq: SessionSeq(seq++), time: seq, ...type === "user/message" ? { surfaceOp: "append" } : {} } as SessionEvent;
    events.push(event);
    state = projection.apply(state, event);
    // The native cache uses this exact lossless snapshot boundary.
    expect(snapshotJsonValue(state), `projection after ${type}`).toEqual(state);
    return state;
  };
  return { apply, events, get state() { return state; } };
}

it.each(["error", "blocked"])("keeps the first %s turn checkpoint JSON-safe without an assistant reply", (kind) => {
  const f = fold();
  f.apply("turn/start", { turn: 1 });
  expect(Object.hasOwn(f.state, "lastAssistant")).toBe(false);
  const input = createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "first task" }] });
  f.apply("user/message", input);
  f.apply("turn/end", { turn: 1, reason: kind === "error" ? { kind, error: { code: "TEST", message: "first-step failure" } } : { kind } });
  expect(f.state.finished[0]).toMatchObject({ turn: 1, reason: kind === "blocked" ? "refusal" : "error", messageIds: [input.id] });
  expect(Object.hasOwn(f.state.finished[0], "lastAssistant")).toBe(false);
});

it("removes the previous reply at the next turn while preserving its finished result", () => {
  const f = fold();
  f.apply("turn/start", { turn: 1 });
  const reply = createAssistantMessage({ source: { kind: "agent" }, content: [{ type: "text", text: "first complete result" }] });
  f.apply("assistant/message", { turn: 1, step: 1, message: reply });
  f.apply("turn/end", { turn: 1, reason: { kind: "completed" } });
  const finished = f.state.finished[0];
  f.apply("turn/start", { turn: 2 });
  expect(Object.hasOwn(f.state, "lastAssistant")).toBe(false);
  expect(f.state.finished[0]).toEqual(finished);
  f.apply("turn/end", { turn: 2, reason: { kind: "aborted", reason: { kind: "user" } } });
  expect(f.state.finished[0].lastAssistant?.messageId).toBe(reply.id);
  expect(Object.hasOwn(f.state.finished[1], "lastAssistant")).toBe(false);
});

it("preserves handoff assignment ids and records an empty new final instead of an earlier reply", () => {
  const f = fold();
  f.apply("turn/start", { turn: 1 });
  const input = createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "work" }] });
  f.apply("user/message", input);
  f.apply("assistant/message", { turn: 1, step: 1, message: createAssistantMessage({ source: { kind: "agent" }, content: [{ type: "text", text: "before handoff" }] }) });
  f.apply("turn/end", { turn: 1, reason: { kind: "handoff", cause: "background-message", calls: [], triggeringMessageIds: [] } });
  f.apply("turn/start", { turn: 2 });
  expect(f.state.messageIds).toEqual([input.id]);
  expect(Object.hasOwn(f.state, "lastAssistant")).toBe(false);
  const final = createAssistantMessage({ source: { kind: "agent" }, content: [] });
  f.apply("assistant/message", { turn: 2, step: 1, message: final });
  f.apply("turn/end", { turn: 2, reason: { kind: "completed" } });
  expect(f.state.finished).toHaveLength(1);
  expect(f.state.finished[0]).toMatchObject({ turn: 2, messageIds: [input.id], lastAssistant: { messageId: final.id, content: [] } });
});

it("uses native checkpoint version invalidation and replays the old non-JSON cell from history", async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(Sessions);
    await ctx.plugin(Projections);
    await ctx.sessionProjections.register(projection);
    const session = ctx.sessions.create(SessionId("json-projection"));
    session.append("turn/start", { turn: 1 });
    session.append("turn/end", { turn: 1, reason: { kind: "blocked" } });
    const checkpoint = ctx.sessionProjections.checkpoint(session);
    expect(snapshotJsonValue(checkpoint)).toEqual(checkpoint);
    const current = checkpoint[projection.key]!;
    const old = { [projection.key]: { ...current, ver: projection.stateVersion - 1, val: { ...current.val as Projection, lastAssistant: undefined } } };
    expect(snapshotJsonValue(old)).toBeUndefined();
    expect(ctx.sessionProjections.restoreFloor(old)).toBe(0);
    const restored = ctx.sessionProjections.restore(old, session.snapshotEvents(), SessionLogOffset(0), session.header, session.inheritedEventCount);
    expect(restored.checkpoint[projection.key]!.ver).toBe(projection.stateVersion);
    expect(restored.checkpoint[projection.key]!.val).toEqual(current.val);
    expect(snapshotJsonValue(restored.checkpoint)).toEqual(restored.checkpoint);
  } finally {
    await ctx.fiber.dispose();
  }
});
