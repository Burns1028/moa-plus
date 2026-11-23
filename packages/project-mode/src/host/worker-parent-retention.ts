import type { SessionId } from "@deepseek-ai/dsh-session";
import type { WorkerParentReady } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
import { observeForTurn } from "./native.ts";
import { withManagedAgent } from "./moa/residency.ts";

/** A visible nested conversation borrows its real native parent until the view closes. */
export async function* followWorkerParent(
  host: HostAccess,
  rootId: SessionId,
  workerId: SessionId,
  signal: AbortSignal,
): AsyncGenerator<WorkerParentReady> {
  const record = host.record(rootId);
  if (!record?.workers.some(worker => worker.id === workerId)) throw new Error("project-mode/not-owned");
  const released = new AbortController();
  const control = AbortSignal.any([signal, host.closing.signal, released.signal]);
  let parentId: SessionId | undefined;
  const current = () => {
    const state = host.record(rootId);
    return state?.project.mode === "enabled" &&
      state.workers.some(worker => worker.id === workerId && worker.lifecycle === "active") &&
      (!parentId || parentId === rootId || state.workers.some(worker => worker.id === parentId && worker.lifecycle === "active"));
  };
  if (!current()) throw new Error("project-mode/worker-inactive");
  const check = () => { if (!current()) released.abort(); };
  host.listeners.add(check);
  const ready = Promise.withResolvers<WorkerParentReady>();
  const held = (async () => {
    {
      using observed = await observeForTurn(host.ctx, workerId, control);
      parentId = observed.header.parentSession;
    }
    if (!parentId) throw new Error("moa/invalid-parent");
    check();
    control.throwIfAborted();
    // Keep the addressed child in the same native residency as its parents.
    // Human prompt delivery then retains the managed caller-result policy;
    // cold-resuming it independently would emit a second parent settlement.
    await withManagedAgent(host, workerId, control, async worker => {
      check();
      control.throwIfAborted();
      ready.resolve({ workerId, parentSessionId: worker.session.header.parentSession! });
      await new Promise<void>(resolve => {
        if (control.aborted) resolve();
        else control.addEventListener("abort", () => resolve(), { once: true });
      });
    });
  })();
  void held.catch(error => ready.reject(error));
  try {
    yield await ready.promise;
    await held;
  } catch (error) {
    if (!control.aborted) throw error;
  } finally {
    released.abort();
    host.listeners.delete(check);
    await held.catch(() => {});
  }
}
