import type { WorkerView } from "./index.ts";

/** Public membership excludes removed Workers and creation-only placeholders. */
export function isVisibleWorker(
  worker: Pick<WorkerView, "lifecycle">,
): boolean {
  return (
    worker.lifecycle !== "deleted" && worker.lifecycle !== "provision-failed"
  );
}
