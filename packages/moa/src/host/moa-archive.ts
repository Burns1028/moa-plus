import type { Context } from "@deepseek-ai/cordis";
import type { Domain } from "@deepseek-ai/dsh-storage-domain";
import type { WorkspaceDomainState } from "@deepseek-ai/dsh-workspace";
import { SessionId } from "@deepseek-ai/dsh-session";
import { domainSpec, type RecordState } from "./state.ts";

/** Mirror MoA archival through the native registry, including native Undo. */
export function bindMoAArchives(
  ctx: Context,
  domain: Domain<typeof domainSpec>,
  update: (
    id: SessionId,
    change: (record: RecordState) => RecordState,
  ) => Promise<void>,
) {
  return ctx.inject(["workspaceRegistry"], (ctx) => {
    const registry = ctx.workspaceRegistry;
    let archived = new Set<string>(registry.archivedSessionIds);
    let stopped = false;
    let scheduled = false;
    let tail = Promise.resolve();

    const mark = (parent: SessionId, child: string, value: boolean) =>
      update(parent, (record) => ({
        ...record,
        workers: record.workers.map((worker) =>
          worker.id === child
            ? { ...worker, archivedByCoordinator: value || undefined }
            : worker,
        ),
      }));

    const reconcile = async () => {
      for (const [id, record] of domain.table("projects").entries()) {
        const parent = SessionId(id);
        for (const worker of record.workers) {
          if (stopped) return;
          const child = SessionId(worker.id);
          try {
            if (archived.has(parent)) {
              if (archived.has(child)) continue;
              // Persist ownership first so an interrupted archive/restore can
              // resume without unarchiving independently archived children.
              if (!worker.archivedByCoordinator)
                await mark(parent, child, true);
              if (!stopped && archived.has(parent))
                await registry.archiveSession(child, { stopActivity: true });
            } else if (worker.archivedByCoordinator) {
              if (archived.has(child)) await registry.unarchiveSession(child);
              if (!stopped && !archived.has(parent))
                await mark(parent, child, false);
            }
          } catch (error) {
            // One missing/unavailable child must not strand its siblings or
            // poison coordinator execution. A later native change retries it.
            ctx.logger.warn(
              `project-mode: archive sync ${parent}/${child}: ${String(error)}`,
            );
          }
        }
      }
    };

    const schedule = () => {
      if (stopped || scheduled) return;
      scheduled = true;
      tail = tail.then(async () => {
        scheduled = false;
        if (!stopped) await reconcile();
      });
    };
    ctx.on("domain/changed", (change) => {
      if (
        change.domain === "workspace" &&
        change.table === "" &&
        change.operation === "put"
      ) {
        // The event is durable but precedes the registry's cache assignment.
        // Use its native snapshot rather than reading the previous cache.
        archived = new Set(
          (change.value as WorkspaceDomainState).archivedSessionIds,
        );
        schedule();
      } else if (
        change.domain === domainSpec.name &&
        change.table === "projects"
      ) {
        schedule();
      }
    });
    ctx.effect(() => async () => {
      stopped = true;
      await tail;
    });
    schedule(); // Repair children of parents archived before this version loaded.
  });
}
