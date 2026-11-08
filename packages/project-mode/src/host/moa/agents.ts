import {
  buildForkSeed,
  SessionId,
  type SessionEvent,
  type SessionSeq,
} from "@deepseek-ai/dsh-session";
import type { SubagentProvider } from "@deepseek-ai/dsh-subagent";

/** Native continuation manager reserves the child and owns activation. */
export function createForkProvider(
  seeds: Map<SessionId, readonly SessionEvent[]>,
): SubagentProvider {
  return {
    name: "moa-fork",
    capabilities: {
      agentOptions: true,
      agentPreset: false,
      outputSchema: true,
      depthLimit: true,
    },
    inheritsParentContext: true,
    async prepareContinuable({ sessionId, signal }) {
      signal.throwIfAborted();
      const seed = seeds.get(sessionId);
      if (!seed) throw new Error("moa/fork-seed-unavailable");
      seeds.delete(sessionId);
      return seed.length ? { seed } : {};
    },
  };
}

/** The inclusive committed watermark is selected by the caller observing the source. */
export function prepareForkSeed(
  events: readonly SessionEvent[],
  watermark: SessionSeq,
): SessionEvent[] {
  if (!events.some((event) => event.seq === watermark))
    throw new Error("moa/fork-watermark-unavailable");
  return buildForkSeed(events, watermark);
}

import type { Agent } from "@deepseek-ai/dsh-agent";
import type { HostAccess } from "../host-access.ts";
import type { WorkerOperations } from "../worker-operations.ts";

export interface QueryAgentsInput {
  ids?: string[];
  wait?: "all" | "selected";
  timeoutMs?: number;
  history?: { offset: number; limit: number };
}

/** Views are derived from native Agents and Project membership; no agent loop is duplicated. */
export class MoAAgents {
  private waiting = new Set<string>();
  constructor(
    private host: HostAccess,
    private workers: WorkerOperations,
  ) {}
  lifecycle(agent: Agent): "Waiting" | "Running" | "Zombie" {
    if (this.waiting.has(agent.id)) return "Waiting";
    return agent.status === "running" ? "Running" : "Zombie";
  }
  async kill(agent: Agent, childId: SessionId, signal: AbortSignal) {
    const record = this.host.record(agent.id) ?? this.host.owner(agent.id);
    if (
      !record ||
      record.project.mode !== "enabled" ||
      this.host.ctx.agents.get(agent.id) !== agent ||
      !record.workers.some((w) => w.id === childId && w.lifecycle === "active")
    )
      throw new Error("moa/not-member");
    const direct = await this.host.ctx.subagents.listChildren(agent.id, signal);
    if (!direct.some((child) => child.id === childId))
      throw new Error("moa/not-direct-child");
    this.host.ctx.subagents.interrupt(childId, { kind: "ancestor", agent });
    return { workerId: childId, accepted: true, stop: "requested" as const };
  }
  async query(agent: Agent, input: QueryAgentsInput, signal: AbortSignal) {
    const record = this.host.record(agent.id) ?? this.host.owner(agent.id);
    if (
      !record ||
      record.project.mode !== "enabled" ||
      this.host.ctx.agents.get(agent.id) !== agent
    )
      throw new Error("moa/not-member");
    if (input.wait === "selected" && !input.ids?.length)
      throw new Error("moa/selection-required");
    if (
      input.history &&
      (!Number.isInteger(input.history.offset) ||
        input.history.offset < 0 ||
        !Number.isInteger(input.history.limit) ||
        input.history.limit < 0)
    )
      throw new Error("moa/invalid-history-window");
    if (input.wait) this.waiting.add(agent.id);
    const deadline = Date.now() + (input.timeoutMs ?? 30000);
    try {
      for (;;) {
        signal.throwIfAborted();
        let wake!: () => void;
        const changed = new Promise<void>((resolve) => {
          wake = resolve;
        });
        this.host.listeners.add(wake);
        try {
          const direct = await this.host.ctx.subagents.listChildren(
            agent.id,
            signal,
          );
          const ids = new Set(direct.map((child) => child.id));
          const current =
            this.host.record(SessionId(record.project.coordinatorSessionId)) ??
            record;
          const selected = current.workers.filter(
            (worker) =>
              ids.has(SessionId(worker.id)) &&
              worker.lifecycle !== "deleted" &&
              (!input.ids || input.ids.includes(worker.id)),
          );
          if (
            input.ids &&
            input.ids.some((id) => !selected.some((worker) => worker.id === id))
          )
            throw new Error("moa/not-direct-child");
          const children = await Promise.all(
            selected.map((worker) => this.host.inspect(worker, signal)),
          );
          const history = input.history
            ? await Promise.all(
                selected.map((worker) =>
                  this.host.readHistory(
                    SessionId(record.project.coordinatorSessionId),
                    SessionId(worker.id),
                    input.history!.offset,
                    input.history!.limit,
                    signal,
                  ),
                ),
              )
            : undefined;
          if (!input.wait) return { children, ...(history ? { history } : {}) };
          if (agent.inbox.nextStep.length || agent.inbox.nextTurn.length)
            return { children, reason: "interrupted" as const };
          if (children.every((child) => child.status === "idle"))
            return { children, reason: "done" as const };
          const remaining = deadline - Date.now();
          if (remaining <= 0) return { children, reason: "timeout" as const };
          let timer: ReturnType<typeof setTimeout> | undefined;
          const abort = new AbortController();
          try {
            await Promise.race([
              changed,
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, remaining);
              }),
              new Promise<never>((_, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                  signal: abort.signal,
                }),
              ),
            ]);
          } finally {
            abort.abort();
            if (timer) clearTimeout(timer);
          }
        } finally {
          this.host.listeners.delete(wake);
        }
      }
    } finally {
      if (input.wait) this.waiting.delete(agent.id);
    }
  }
}
