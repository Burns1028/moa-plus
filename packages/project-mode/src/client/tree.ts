import type { ProjectSnapshot } from "../shared/index.ts";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ProjectClient } from "./runtime.ts";
export function projectForSession(
  client: ProjectClient,
  id: SessionId,
): ProjectSnapshot | undefined {
  return (
    client.store.project(id) ??
    client.store
      .projects()
      .find((p) => p.workers.some((w) => w.workerId === id))
  );
}
export function workerReadOnly(
  projects: readonly ProjectSnapshot[],
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
  reason: "deleted" | "disabled";
}
/** Override native input only for established, inactive Project membership. */
export function composerMatch(
  owner: import("@deepseek-ai/dsh-client-ui-conversation/client").ComposerChainProps,
  client: import("./runtime.ts").ProjectClient,
): ComposerMatch | null {
  const address = owner.session?.subagent?.address;
  if (!address || address.mode !== "continuable" || !owner.sessionId)
    return null;
  const id = owner.sessionId,
    parent = address.parentSessionId,
    projects = client.store.projects();
  const readonly = workerReadOnly(projects, id);
  if (readonly) return { id, ...readonly };
  if (projects.some((p) => p.workers.some((w) => w.workerId === id)))
    return null;
  const mode = client.mode(id).value;
  const project = client.store.project(parent);
  if (
    mode?.role === "worker" &&
    mode.coordinatorSessionId === parent &&
    project
  )
    return {
      id,
      parent,
      reason: project.project.mode === "disabled" ? "disabled" : "deleted",
    };
  return null;
}
