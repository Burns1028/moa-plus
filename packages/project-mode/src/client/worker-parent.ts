import type {
  ISessions,
  SessionReference,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ProjectClient } from "./runtime.ts";

declare module "@deepseek-ai/dsh-api-session-controller/client" {
  interface SessionReferenceSourceMap {
    projectModeParent: unknown;
  }
}

/** Visible Worker input retains its exact native Session and real parent chain. */
export function bindWorkerParents(
  client: ProjectClient,
  sessions: ISessions,
): () => void {
  const held = new Map<SessionId, { reference?: SessionReference }>();
  const resident = new Map<
    SessionId,
    {
      abort: AbortController;
      stream?: ReturnType<ProjectClient["followWorkerParent"]>;
      version: number;
    }
  >();
  const releaseResident = (slot: {
    abort: AbortController;
    stream?: ReturnType<ProjectClient["followWorkerParent"]>;
  }) => {
    slot.abort.abort();
    slot.stream?.dispose();
  };
  const reconcile = () => {
    const { byId } = sessions.list.getSnapshot();
    const needed = new Set<SessionId>();
    const neededWorkers = new Set<SessionId>();
    for (const project of client.store.projects()) {
      if (project.project.mode !== "enabled") continue;
      for (const worker of project.workers) {
        if (
          worker.lifecycle !== "active" ||
          !Object.entries(byId[worker.workerId]?.retainedBy ?? {}).some(
            ([source, count]) =>
              (source === "mainView" || source === "sidebarChat") && count > 0,
          )
        )
          continue;
        needed.add(project.project.coordinatorSessionId);
        neededWorkers.add(worker.workerId);
      }
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
        const reference = sessions.retain(id, { source: "projectModeParent" });
        if (held.get(id) !== lease) reference.release();
        else lease.reference = reference;
        // Native Session opening owns its error state; do not turn a rejected
        // background acquisition into an unhandled rejection or a retry loop.
        void reference.ready.catch((error) =>
          console.error("Project Mode: parent opening failed", error),
        );
      } catch (error) {
        if (held.get(id) === lease) held.delete(id);
        console.error("Project Mode: parent acquisition failed", error);
      }
    }
    for (const [id, slot] of resident) {
      if (neededWorkers.has(id) && slot.version === client.connectionVersion)
        continue;
      resident.delete(id);
      releaseResident(slot);
    }
    for (const id of neededWorkers) {
      if (resident.has(id)) continue;
      const slot: {
        abort: AbortController;
        stream?: ReturnType<ProjectClient["followWorkerParent"]>;
        version: number;
      } = { abort: new AbortController(), version: client.connectionVersion };
      resident.set(id, slot);
      void (async () => {
        try {
          slot.stream = client.followWorkerParent(id, slot.abort.signal);
          for await (const _ready of slot.stream) {
            if (slot.abort.signal.aborted) return;
          }
        } catch (error) {
          if (!slot.abort.signal.aborted)
            console.error("MoA+: Worker residency failed", error);
        }
      })();
    }
  };
  const unsubscribe = [
    client.store.subscribe(reconcile),
    sessions.list.subscribe(reconcile),
    client.subscribeModes(reconcile),
  ];
  reconcile();
  return () => {
    for (const off of unsubscribe) off();
    for (const lease of held.values()) lease.reference?.release();
    held.clear();
    for (const slot of resident.values()) releaseResident(slot);
    resident.clear();
  };
}
