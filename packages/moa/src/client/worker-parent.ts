import type {
  ISessions,
  SessionReference,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { MoAClient } from "./runtime.ts";

declare module "@deepseek-ai/dsh-api-session-controller/client" {
  interface SessionReferenceSourceMap {
    moaParent: unknown;
  }
}

/** Native child input needs its parent Agent; opening the parent restores it without a prompt. */
export function bindWorkerParents(
  client: MoAClient,
  sessions: ISessions,
): () => void {
  const held = new Map<SessionId, { reference?: SessionReference }>();
  const reconcile = () => {
    const { byId } = sessions.list.getSnapshot();
    const needed = new Set<SessionId>();
    for (const project of client.store.all()) {
      if (project.project.mode !== "enabled") continue;
      if (
        project.workers.some(
          (worker) =>
            worker.lifecycle === "active" &&
            Object.entries(byId[worker.workerId]?.retainedBy ?? {}).some(
              ([source, count]) =>
                (source === "mainView" || source === "sidebarChat") &&
                count > 0,
            ),
        )
      )
        needed.add(project.project.coordinatorSessionId);
    }
    for (const [id, lease] of held) {
      if (needed.has(id)) continue;
      held.delete(id);
      lease.reference?.release();
    }
    for (const id of needed) {
      if (held.has(id)) continue;
      // Retaining synchronously publishes reference counts. Claim the seat first.
      const lease: { reference?: SessionReference } = {};
      held.set(id, lease);
      try {
        const reference = sessions.retain(id, { source: "moaParent" });
        if (held.get(id) !== lease) reference.release();
        else lease.reference = reference;
        // Native Session opening owns its error state; do not turn a rejected
        // background acquisition into an unhandled rejection or a retry loop.
        void reference.ready.catch((error) =>
          console.error("MoA+: parent opening failed", error),
        );
      } catch (error) {
        if (held.get(id) === lease) held.delete(id);
        console.error("MoA+: parent acquisition failed", error);
      }
    }
  };
  const unsubscribe = [
    client.store.subscribe(reconcile),
    sessions.list.subscribe(reconcile),
  ];
  reconcile();
  return () => {
    for (const off of unsubscribe) off();
    for (const lease of held.values()) lease.reference?.release();
    held.clear();
  };
}
