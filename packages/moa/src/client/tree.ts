import type { MoASnapshot } from "../shared/index.ts";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { MoAClient } from "./runtime.ts";
export function moaForSession(
  client: MoAClient,
  id: SessionId,
): MoASnapshot | undefined {
  return (
    client.store.get(id) ??
    client.store.all().find((p) => p.workers.some((w) => w.workerId === id))
  );
}
export function workerReadOnly(
  projects: readonly MoASnapshot[],
  id: SessionId,
): { parent: SessionId; reason: "disabled" | "deleted" } | undefined {
  for (const p of projects) {
    const worker = p.workers.find((w) => w.workerId === id);
    if (
      worker &&
      (worker.lifecycle === "deleted" ||
        worker.lifecycle === "deleting" ||
        p.project.mode === "disabled")
    )
      return {
        parent: p.project.coordinatorSessionId,
        reason:
          worker.lifecycle === "deleted" || worker.lifecycle === "deleting"
            ? "deleted"
            : "disabled",
      };
  }
}

export interface ComposerMatch {
  id: SessionId;
  parent: SessionId;
  reason: "deleted" | "disabled" | "pending" | "unavailable";
}
/** A known continuation must establish ownership before enabling its input. */
export function composerMatch(
  owner: import("@deepseek-ai/dsh-client-ui-conversation/client").ComposerChainProps,
  client: import("./runtime.ts").MoAClient,
): ComposerMatch | null {
  const address = owner.session?.subagent?.address;
  if (!address || address.mode !== "continuable" || !owner.sessionId)
    return null;
  const id = owner.sessionId,
    parent = address.parentSessionId,
    projects = client.store.all();
  const readonly = workerReadOnly(projects, id);
  if (readonly) return { id, ...readonly };
  const project = projects.find((p) =>
    p.workers.some((w) => w.workerId === id),
  );
  if (project) return null;
  const mode = client.mode(id);
  if (mode.value?.role === "ordinary" || mode.value?.role === "coordinator")
    return null;
  return {
    id,
    parent,
    reason:
      mode.error ||
      client.catalogState === "error" ||
      (mode.value?.role === "worker" && client.catalogState === "ready")
        ? "unavailable"
        : "pending",
  };
}
