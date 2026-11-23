/** Public membership excludes removed Workers and creation-only placeholders. */
export function isVisibleWorker(worker) {
    return (worker.lifecycle !== "deleted" && worker.lifecycle !== "provision-failed");
}
