import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { freezeMessage } from "@deepseek-ai/dsh-llm";
import { projected, waitForTurn } from "./native.ts";
import { ensureContextIndex } from "./moa-memory.ts";
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
  guardTurn(agent: Agent, turn: number, signal: AbortSignal): Promise<void>;
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
  const { outbox, workers, progress } = options;
  host.ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
    const decision = await next();
    const project = host.record(agent.id) ?? host.owner(agent.id);
    if (
      decision.kind !== "enter" ||
      project?.project.mode !== "enabled" ||
      !decision.messages.some((m) =>
        [
          "user",
          "project-mode-assignment",
          "project-mode-result",
          "subagent-settled",
          "agent-message",
        ].includes(m.source.kind),
      )
    )
      return decision;
    const control = AbortSignal.any([signal, host.closing.signal]);
    try {
      await ensureContextIndex(host.ctx, agent, project.project, control);
    } catch (error) {
      control.throwIfAborted();
      // Context migration is best effort; a native permission denial must
      // not prevent clarification or other otherwise-available work.
      host.ctx.logger.warn(`project-mode: context index: ${String(error)}`);
    }
    return decision;
  });
  host.ctx.on("tools/change", options.reconcileTools);
  host.ctx.on("agent/created", async ({ agent }) => {
    options.attach(agent);
    if (host.record(agent.id)) host.enqueue(() => options.recover(agent.id));
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
  host.ctx.on("session/event", (session, event) => {
    if (
      event.type === "turn/start" &&
      host.record(session.id)?.project.mode === "enabled"
    )
      host.enqueue(async () => {
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
      outbox.workerCuts.set(session.id, projected(host.ctx, session));
      host.enqueue(() => host.ingest(session.id));
    }
    if (host.record(session.id) && event.type === "user/message") {
      outbox.claimed.get(session.id)?.delete(event.data.id);
      host.enqueue(() => outbox.consume(session.id, event.data.id));
    }
    if (host.record(session.id) && event.type === "turn/end") {
      outbox.claimed.delete(session.id);
      host.enqueue(() =>
        options.freezeTurn(session.id, event.data.turn, event.data.reason.kind),
      );
    }
    host.notify();
  });
  host.ctx.on("agent/turn-stopping", async ({ agent, turn, signal }) => {
    if (host.record(agent.id)?.project.mode === "enabled")
      await options.guardTurn(agent, turn, signal);
  });
  host.ctx.on("agent/pre-step", ({ agent, signal }, next) =>
    normalizeCoordinatorStep(host, options, agent, signal, next),
  );
  host.ctx.on("agent/disposed", ({ agent }) => options.disposeAgent(agent));
}

/** Replace managed native settlements with canonical persisted MoA results. */
async function normalizeCoordinatorStep(
  host: HostAccess,
  options: AgentEventOptions,
  agent: Agent,
  signal: AbortSignal,
  next: () => Promise<PreStepDecision>,
): Promise<PreStepDecision> {
  const { outbox, workers } = options;
  if (!host.record(agent.id)) return next();
  const control = AbortSignal.any([signal, host.closing.signal]);
  control.throwIfAborted();
  outbox.normalizing.add(agent.id);
  try {
    const decision = await next();
    control.throwIfAborted();
    if (decision.kind !== "enter" || !host.record(agent.id)) return decision;
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
        host
          .record(agent.id)!
          .workers.some((w) => w.id === source.senderSessionId)
      );
    });

    // A cold worker can settle before the native send receipt is persisted.
    // Await only the already-running admission for that worker, without a
    // worker lock, before replacing its native settlement notice.
    for (const message of managed) {
      if (message.source.kind !== "subagent-settled") continue;
      for (const assignment of host.record(agent.id)!.assignments) {
        if (assignment.workerId !== message.source.senderSessionId) continue;
        const admission = workers.operations.get(
          JSON.stringify([agent.id, assignment.operationId]),
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
    const r = host.record(agent.id)!;
    for (const d of r.deliveries) {
      if (
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
