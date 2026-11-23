import { expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { HostAccess } from "../../packages/project-mode/src/host/host-access.ts";
import type { MoAAgents } from "../../packages/project-mode/src/host/moa/agents.ts";
import { fixture, response } from "./fixture.ts";

async function heldWorker() {
  const f = await fixture();
  const keeperRelease = Promise.withResolvers<void>();
  const workerRelease = Promise.withResolvers<void>();
  const keeperStarted = Promise.withResolvers<void>();
  const workStarted = Promise.withResolvers<void>();
  try {
    const { agent: root } = await f.ctx.agents.create({
      sessionId: SessionId("observe-history-root"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
    const controls: MoAAgents = (f.ctx.projectMode as any).moa;
    const host: HostAccess = (controls as any).host;
    f.ctx.tools.register(defineTool({
      name: "held_history_work",
      description: "Hold a native tool while its visible progress is observable",
      parameters: {},
      output: { schema: { type: "string" }, render: (_args, value: string) => [{ type: "text", text: value }] },
      async execute() {
        workStarted.resolve();
        await workerRelease.promise;
        return "Native work released.";
      },
    }));
    let keeperId: string | undefined, workerSteps = 0;
    f.adapter.handler = async request => {
      if (request.sessionId === root.id) return response("Coordinator received the result.");
      if (!keeperId || request.sessionId === keeperId) {
        keeperId = request.sessionId;
        keeperStarted.resolve();
        await keeperRelease.promise;
        return response("Keeper received the result.");
      }
      if (++workerSteps > 1) return response("Fresh worker reply.");
      return [
        ...response("Progress before waiting.").slice(0, -1),
        { type: "block-start", index: 1, blockType: "tool-call" },
        { type: "block-end", index: 1, block: { type: "tool-call", id: "held-work", name: "held_history_work", arguments: "{}" } },
        { type: "finish", reason: { kind: "tool-calls" } },
      ];
    };
    // Keep reports off the waiting parent's inbox, so a native completed
    // child can exercise "done" independently of next-step interruption.
    const [keeper] = await controls.dispatch(root, [{
      name: "keeper", task: "Receive the worker's result.", role: "General-purpose", workspace: "shared",
    }], "keeper", new AbortController().signal);
    await keeperStarted.promise;
    const [worker] = await controls.dispatch(root, [{
      name: "worker", task: "Produce a report after the held work.", role: "General-purpose", workspace: "shared", reportTo: keeper.workerId,
    }], "worker", new AbortController().signal);
    await workStarted.promise;
    return {
      f, root, controls, host, workerId: SessionId(worker.workerId), release: () => workerRelease.resolve(),
      async dispose() {
        workerRelease.resolve();
        keeperRelease.resolve();
        await f.dispose();
      },
    };
  } catch (error) {
    workerRelease.resolve();
    keeperRelease.resolve();
    await f.dispose();
    throw error;
  }
}

it.each(["done", "timeout", "interrupted"] as const)(
  "returns the current native history window when moa_observe wait ends with %s",
  async reason => {
    const h = await heldWorker();
    const read = vi.spyOn(h.host, "readHistory");
    const controller = new AbortController();
    let waiting: ReturnType<typeof h.controls.observe> | undefined;
    try {
      const initial = await h.controls.observe(h.root, {
        ids: [h.workerId], history: { offset: 0, limit: 2 },
      }, new AbortController().signal);
      expect(initial.history![0].messages[0]).toMatchObject({ role: "assistant", text: "Progress before waiting." });
      const initialWindow = initial.history![0];
      const window = reason === "done" ? { offset: 0, limit: 2 } :
        reason === "timeout" ? { offset: 1, limit: 1 } : { offset: 0, limit: 0 };
      read.mockClear();
      waiting = h.controls.observe(h.root, {
        ids: [h.workerId], wait: "selected", timeoutMs: reason === "timeout" ? 1 : 5000, history: window,
      }, controller.signal);
      void waiting.catch(() => {});
      // Observe the real first history read completing, then change native
      // child/inbox state. No startup-duration assumption or synthetic result.
      await vi.waitFor(() => expect(read).toHaveBeenCalled());
      await read.mock.results[0].value;
      if (reason === "done") h.release();
      if (reason === "interrupted") h.root.send(createUserMessage({
        source: { kind: "user" }, content: [{ type: "text", text: "A real next-step update." }],
      }), "next-step", false);
      const result = await waiting;
      expect(result.reason).toBe(reason);
      expect(result.history).toHaveLength(1);
      const page = result.history![0];
      expect(page).toMatchObject({ workerId: h.workerId, offset: window.offset, limit: window.limit });
      expect(result.children).toHaveLength(1);
      if (reason === "done") {
        expect(result.children[0].status).toBe("idle");
        expect(page.status).toBe("idle");
        expect(page.messages.map(message => message.text)).toEqual(["Fresh worker reply.", "Progress before waiting."]);
        expect(page.observedThroughSeq).toBeGreaterThan(initialWindow.observedThroughSeq);
      } else {
        expect(result.children[0].status).toBe("busy");
        expect(page.status).toBe("busy");
        if (reason === "timeout") expect(page.messages.map(message => message.id)).toEqual([initialWindow.messages[1].id]);
        else {
          expect(page.total).toBeGreaterThan(0);
          expect(page.messages).toEqual([]);
          expect(h.root.inbox.nextStep).toHaveLength(1);
        }
      }
      // Omitting a window must omit the field on the same wait-return path.
      const withoutHistory = await h.controls.observe(h.root, {
        ids: [h.workerId], wait: "selected", timeoutMs: 1,
      }, new AbortController().signal);
      expect(withoutHistory.reason).toBe(reason);
      expect(withoutHistory).not.toHaveProperty("history");
      expect(h.controls.waiting.has(h.root.id)).toBe(false);
    } finally {
      controller.abort();
      await waiting?.catch(() => {});
      read.mockRestore();
      await h.dispose();
    }
  },
);

it("cleans the native observe listener and waiting state when Abort interrupts a history wait", async () => {
  const h = await heldWorker();
  const read = vi.spyOn(h.host, "readHistory");
  const controller = new AbortController();
  const listenersBefore = new Set(h.host.listeners);
  const abortListenersBefore = getEventListeners(controller.signal, "abort").length;
  try {
    const waiting = h.controls.observe(h.root, {
      ids: [h.workerId], wait: "selected", timeoutMs: 30000, history: { offset: 0, limit: 1 },
    }, controller.signal);
    void waiting.catch(() => {});
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    await read.mock.results[0].value;
    expect(h.controls.waiting.has(h.root.id)).toBe(true);
    expect([...h.host.listeners].some(listener => !listenersBefore.has(listener))).toBe(true);
    await vi.waitFor(() => expect(getEventListeners(controller.signal, "abort").length).toBeGreaterThan(abortListenersBefore));
    const reason = new Error("Cancel this native observation.");
    const rejected = expect(waiting).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    expect(h.controls.waiting.has(h.root.id)).toBe(false);
    expect(new Set(h.host.listeners)).toEqual(listenersBefore);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(abortListenersBefore);
    expect((await h.controls.observe(h.root, {}, new AbortController().signal))).not.toHaveProperty("history");
  } finally {
    controller.abort();
    read.mockRestore();
    await h.dispose();
  }
});
