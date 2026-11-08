import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { HostAccess } from "../host-access.ts";
import { observeForTurn, resolveOrdinaryAgent } from "../native.ts";

const residentChild = Symbol.for("dsh.subagent.withResidentChild");
interface ResidentChildHost {
  [residentChild]<T>(
    parent: Agent,
    id: SessionId,
    signal: AbortSignal,
    use: (agent: Agent) => Promise<T>,
  ): Promise<T>;
}

/** Borrow the actual native parent chain without sending intermediate work. */
export async function withManagedAgent<T>(
  host: HostAccess,
  id: SessionId,
  signal: AbortSignal,
  use: (agent: Agent) => Promise<T>,
): Promise<T> {
  const record = host.record(id) ?? host.owner(id);
  if (record?.project.mode !== "enabled") throw new Error("moa/not-member");
  const rootId = SessionId(record.project.coordinatorSessionId);
  const member = (target: SessionId) => {
    const current = host.record(rootId);
    return current?.project.mode === "enabled" && (target === rootId || current.workers.some(
      (worker) => worker.id === target &&
        (worker.lifecycle === "active" || worker.lifecycle === "provisioning"),
    ));
  };
  const control = AbortSignal.any([signal, host.closing.signal]);
  async function borrow<R>(target: SessionId, visited: Set<SessionId>, callback: (agent: Agent) => Promise<R>): Promise<R> {
    control.throwIfAborted();
    if (!member(target)) throw new Error("moa/not-member");
    if (visited.has(target)) throw new Error("moa/invalid-parent-cycle");
    const next = new Set(visited).add(target);
    if (target === rootId) {
      const root = host.ctx.agents.get(target) ?? await resolveOrdinaryAgent(host.ctx, target);
      if (!root) throw new Error("moa/root-unavailable");
      return callback(root);
    }
    let parentId: SessionId;
    {
      using observed = await observeForTurn(host.ctx, target, control);
      if (!observed.header.parentSession) throw new Error("moa/invalid-parent");
      parentId = observed.header.parentSession;
    }
    return borrow(parentId, next, async (parent) => {
      const runtime = host.ctx.subagents as unknown as ResidentChildHost;
      if (typeof runtime[residentChild] !== "function")
        throw new Error("moa/native-residency-compatibility-required");
      return runtime[residentChild](parent, target, control, async (agent) => {
        control.throwIfAborted();
        if ([...next].some((memberId) => !member(memberId))) throw new Error("moa/not-member");
        return callback(agent);
      });
    });
  }
  return borrow(id, new Set(), async (agent) => {
    const result = await use(agent);
    await host.ctx.sessions.flush(agent.session);
    return result;
  });
}
