import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import { freezeMessage } from "@deepseek-ai/dsh-llm";
import { projected, waitForTurn } from "./native.ts";
import { bindProjectMemory } from "./project-memory.ts";
import type { HostAccess } from "./host-access.ts";
import type { CompletionOutbox } from "./completion-outbox.ts";
import type { WorkerOperations } from "./worker-operations.ts";

interface AgentEventOptions {
  outbox: CompletionOutbox;
  workers: WorkerOperations;
  progress: Map<SessionId, string>;
  reconcileTools(): void;
  attach(agent: Agent): void;
  disposeAgent(agent: Agent): void;
  recover(id: SessionId): Promise<void>;
  guardTurn(agent: Agent, signal: AbortSignal): Promise<void>;
  freezeTurn(id: SessionId, turn: number, reason: string): Promise<void>;
  refreshWorkersForInput(
    agent: Agent,
    messageIds: string[],
    signal: AbortSignal,
  ): Promise<void>;
}

/** Bind native lifecycle notifications in their original registration order. */
export function bindAgentEvents(
  host: HostAccess,
  options: AgentEventOptions,
): void {
  const { outbox, progress } = options;
  bindProjectMemory(host);
  host.ctx.on("tools/change", options.reconcileTools);
  host.ctx.on("agent/created", async ({ agent }) => {
    options.attach(agent);
    if (host.record(agent.id))
      host.enqueue(agent.id, () => options.recover(agent.id));
    host.notify();
    return undefined;
  });
  host.ctx.on("agent/status", () => host.notify());
  host.ctx.on("agent/assistant-stream", ({ agent, frame }) => {
    if (!host.owner(agent.id)) return;
    if (frame.type === "start") progress.delete(agent.id);
    if (frame.type === "chunk" && frame.chunk.type === "text-delta")
      progress.set(
        agent.id,
        ((progress.get(agent.id) ?? "") + frame.chunk.text).slice(
          -host.config.progressTextMaxChars,
        ),
      );
    host.notify();
  });
  host.ctx.on("agent/inbox/inserted", () => host.notify());
  host.ctx.on("agent/inbox/claimed", ({ agent, message }) => {
    if (
      message.source.kind !== "project-mode-result" ||
      !(host.record(agent.id) ?? host.owner(agent.id))
    )
      return;
    // Native claim precedes asynchronous prompt assembly and pre-step hooks.
    // The result is already in flight even though user/message is not logged.
    const claimed = outbox.claimed.get(agent.id) ?? new Set<string>();
    claimed.add(message.id);
    outbox.claimed.set(agent.id, claimed);
  });
  host.ctx.on("session/event", (session, event) => {
    if (
      event.type === "turn/start" &&
      host.record(session.id)?.project.mode === "enabled"
    )
      host.enqueue(session.id, async () => {
        const r = host.record(session.id);
        if (r?.project.mode === "enabled" && !r.project.modeLocked)
          await host.update(session.id, (current) => ({
            ...current,
            project: { ...current.project, modeLocked: true },
          }));
      });
    if (host.owner(session.id) && event.type === "turn/start")
      progress.delete(session.id);
    if (host.owner(session.id) && event.type === "turn/end") {
      outbox.claimed.delete(session.id);
      outbox.workerCuts.set(session.id, projected(host.ctx, session));
      host.enqueue(
        SessionId(host.owner(session.id)!.project.coordinatorSessionId),
        () => host.ingest(session.id),
      );
    }
    if (
      (host.record(session.id) || host.owner(session.id)) &&
      event.type === "user/message"
    ) {
      outbox.claimed.get(session.id)?.delete(event.data.id);
      host.enqueue(
        SessionId(
          (host.record(session.id) ?? host.owner(session.id))!.project
            .coordinatorSessionId,
        ),
        () => outbox.consume(session.id, event.data.id),
      );
    }
    if (
      host.record(session.id) &&
      event.type === "turn/end"
    ) {
      outbox.claimed.delete(session.id);
      host.enqueue(session.id, () =>
        options.freezeTurn(session.id, event.data.turn, event.data.reason.kind),
      );
    }
    host.notify();
  });
  host.ctx.on("agent/turn-stopping", async ({ agent, signal }) => {
    if (host.record(agent.id)?.project.mode === "enabled")
      await options.guardTurn(agent, signal);
  });
  host.ctx.on("agent/pre-step", ({ agent, signal }, next) =>
    normalizeCoordinatorStep(host, options, agent, signal, next),
  );
  host.ctx.on("agent/disposed", ({ agent }) => options.disposeAgent(agent));
}

/** Replace managed native settlements with canonical persisted Project results. */
async function normalizeCoordinatorStep(
  host: HostAccess,
  options: AgentEventOptions,
  agent: Agent,
  signal: AbortSignal,
  next: () => Promise<PreStepDecision>,
): Promise<PreStepDecision> {
  const { outbox, workers } = options;
  const owner = host.record(agent.id) ?? host.owner(agent.id);
  if (!owner) return next();
  const rootId = SessionId(owner.project.coordinatorSessionId);
  const control = AbortSignal.any([signal, host.closing.signal]);
  control.throwIfAborted();
  outbox.normalizing.add(agent.id);
  try {
    const decision = await next();
    control.throwIfAborted();
    if (
      decision.kind !== "enter" ||
      !(host.record(agent.id) ?? host.owner(agent.id))
    )
      return decision;
    if (
      host.record(agent.id)?.project.mode === "enabled" &&
      decision.messages.some((m) => m.source.kind === "user")
    ) {
      await options.refreshWorkersForInput(
        agent,
        decision.messages
          .filter((m) => m.source.kind === "user")
          .map((m) => m.id),
        control,
      );
    }
    const claimed = outbox.claimed.get(agent.id) ?? new Set<string>();
    outbox.claimed.set(agent.id, claimed);
    for (const message of decision.messages)
      if (message.source.kind === "project-mode-result")
        claimed.add(message.id);
    const managed = decision.messages.filter((m) => {
      const source = m.source;
      return (
        source.kind === "subagent-settled" &&
        (host.record(rootId) ?? owner).workers.some(
          (w) => w.id === source.senderSessionId,
        )
      );
    });

    // A cold worker can settle before the native send receipt is persisted.
    // Await only the already-running admission for that worker, without a
    // worker lock, before replacing its native settlement notice.
    for (const message of managed) {
      if (message.source.kind !== "subagent-settled") continue;
      for (const assignment of host.record(rootId)!.assignments) {
        if (assignment.workerId !== message.source.senderSessionId) continue;
        const admission = workers.operations.get(
          JSON.stringify([rootId, assignment.operationId]),
        );
        if (admission) await waitForTurn(admission, control);
        control.throwIfAborted();
      }
    }
    for (const message of managed) {
      if (message.source.kind === "subagent-settled")
        await waitForTurn(host.ingest(message.source.senderSessionId), control);
      control.throwIfAborted();
    }
    control.throwIfAborted();
    const messages = decision.messages.filter((m) => !managed.includes(m));
    const r = host.record(rootId)!;
    for (const d of r.deliveries) {
      if (
        (d.targetId ?? rootId) === agent.id &&
        d.state !== "consumed" &&
        d.state !== "suppressed" &&
        !messages.some((m) => m.id === d.message.id)
      ) {
        agent.inbox.remove(d.message.id);
        messages.push(freezeMessage(d.message));
        claimed.add(d.message.id);
      }
    }
    // Native tool-result continuation legitimately enters with no new
    // messages. Only reject an empty step caused by removing duplicate
    // managed settlements; otherwise preserve the native enter decision.
    return managed.length > 0 && messages.length === 0
      ? { kind: "reject" }
      : { ...decision, messages };
  } finally {
    outbox.normalizing.delete(agent.id);
  }
}
