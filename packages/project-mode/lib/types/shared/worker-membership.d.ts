import type { WorkerView } from "./index.ts";
/** Public membership excludes removed Workers and creation-only placeholders. */
export declare function isVisibleWorker(worker: Pick<WorkerView, "lifecycle">): boolean;
