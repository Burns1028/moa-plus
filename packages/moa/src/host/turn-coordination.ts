import { messageSchema } from "./state.ts";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { abortableChange, waitForTurn, observeForTurn } from "./native.ts";
import type { HostAccess } from "./host-access.ts";
/** Event-driven native turn closure. No worker lock is held while waiting. */
export class TurnCoordination {
  readonly waiting = new Set<string>();
  constructor(private host: HostAccess) {}
  async guardTurn(agent: Agent, turn: number, signal: AbortSignal) {
    const lifetime = AbortSignal.any([signal, this.host.closing.signal]);
    const inputReady = new AbortController();
    const control = AbortSignal.any([lifetime, inputReady.signal]);
    // Native steer must reach its next safe step even while unrelated shared
    // work or an observation is pending. Only this guard's local waits stop;
    // ordinary worker/projection notifications do not bypass strict closure.
    const wakeForInput = () => {
      if (agent.inbox.nextStep.length) inputReady.abort();
    };
    this.host.listeners.add(wakeForInput);
    this.waiting.add(agent.id);
    try {
      wakeForInput();
      for (;;) {
        control.throwIfAborted();
        const iteration = new AbortController();
        const change = abortableChange(
          this.host.listeners,
          AbortSignal.any([control, iteration.signal]),
        );
        try {
          void change.catch(() => {});
          await waitForTurn(this.host.settledJobs(), control);
          control.throwIfAborted();
          if (agent.inbox.nextStep.length) return;
          const r = this.host.record(agent.id)!,
            views = await waitForTurn(
              Promise.all(
                r.workers
                  .filter(
                    (w) =>
                      w.lifecycle !== "deleted" &&
                      w.lifecycle !== "provision-failed",
                  )
                  .map((w) => this.host.view(w, control)),
              ),
              control,
            );
          control.throwIfAborted();
          if (
            this.host.record(agent.id)!.project.revision !== r.project.revision
          )
            continue;
          if (views.some((v) => v.status === null))
            throw new Error("project-mode/worker-activity-unavailable");
          const pending = r.assignments.filter(
            (a) =>
              a.admission !== "rejected" &&
              !r.completions.some((c) => c.assignmentIds.includes(a.id)) &&
              r.workers.some(
                (w) => w.id === a.workerId && w.lifecycle !== "deleted",
              ),
          );
          const uncertain = r.assignments.find(
            (a) => a.admission === "unknown",
          );
          if (uncertain)
            throw new Error(
              `project-mode/admission-uncertain: ${uncertain.operationId}`,
            );
          const failed = r.deliveries.find(
            (d) =>
              d.lastError && d.attempts > this.host.config.retryMaxAttempts,
          );
          if (failed)
            throw new Error(
              `project-mode/result-admission-failed: ${failed.completionId}: ${failed.lastError}`,
            );
          const results = r.deliveries.filter(
            (d) => d.state !== "consumed" && d.state !== "suppressed",
          );
          if (
            !pending.length &&
            !results.length &&
            !views.some(
              (v) =>
                v.status === "busy" || v.queueLength || v.pendingSteerCount,
            ) &&
            !this.host.pendingOperations(agent.id)
          )
            return;
          const parked = views.find(
            (v) =>
              v.status === "idle" && (v.queueLength || v.pendingSteerCount),
          );
          if (parked) {
            const worker = this.host.ctx.agents.get(parked.workerId);
            let ids: string[];
            if (worker)
              ids = [...worker.inbox.nextStep, ...worker.inbox.nextTurn].map(
                (m) => m.id,
              );
            else {
              using observed = await observeForTurn(
                this.host.ctx,
                parked.workerId,
                control,
              );
              const inbox = observed.projections?.values.inbox;
              if (!inbox)
                throw new Error("project-mode/worker-activity-unavailable");
              ids = [...inbox["next-step"], ...inbox["next-turn"]].map(
                (m) => messageSchema.parse(m).id,
              );
            }
            control.throwIfAborted();
            const identity = JSON.stringify([parked.workerId, ...ids]);
            if (r.reminders[identity])
              throw new Error(
                `project-mode/parked-worker-input: ${parked.workerId}; continue, delete, or ask the user`,
              );
            await waitForTurn(
              this.host.update(agent.id, (record) => {
                control.throwIfAborted();
                return {
                  ...record,
                  reminders: { ...record.reminders, [identity]: true },
                };
              }),
              control,
            );
            control.throwIfAborted();
            agent.steer(
              createUserMessage({
                source: {
                  kind: "project-mode-notice",
                  form: "notice",
                  summary: "parked worker input",
                },
                content: [
                  {
                    type: "text",
                    text: `MoA has parked worker input: ${parked.name} (${parked.workerId}) is stopped with ${ids.length} pending inputs. Continue the worker, delete it, or ask the user how to proceed.`,
                  },
                ],
              }),
            );
            return;
          }
          await change;
        } finally {
          iteration.abort();
        }
      }
    } catch (error) {
      // A pending input returns normally to native preStep. Native Stop/unload
      // remains authoritative if it arrives at the same boundary.
      lifetime.throwIfAborted();
      if (inputReady.signal.aborted && error === inputReady.signal.reason)
        return;
      throw error;
    } finally {
      this.host.listeners.delete(wakeForInput);
      this.waiting.delete(agent.id);
    }
  }
  async freezeTurn(parentId: SessionId, turn: number, parentReason: string) {
    await this.host.update(parentId, (r) => ({
      ...r,
      outcomes: [
        ...r.outcomes,
        ...r.memberships
          .filter(
            (m) =>
              m.coordinatorTurn === turn &&
              !r.outcomes.some(
                (o) =>
                  o.coordinatorTurn === turn &&
                  o.workerId === m.workerId &&
                  o.segmentStartSeq === m.segmentStartSeq,
              ),
          )
          .map((m) => {
            const worker = this.host.worker(r, SessionId(m.workerId)),
              completed = r.completions.filter(
                (c) =>
                  c.workerId === m.workerId &&
                  (m.completionIds?.includes(c.id) ||
                    c.assignmentIds.some((id) =>
                      r.assignments.some(
                        (a) =>
                          a.id === id &&
                          a.coordinatorTurn === turn &&
                          a.segmentStartSeq === m.segmentStartSeq,
                      ),
                    )),
              ),
              last = completed.at(-1);
            const pending = r.assignments.some(
              (a) =>
                a.workerId === m.workerId &&
                a.coordinatorTurn === turn &&
                a.segmentStartSeq === m.segmentStartSeq &&
                a.admission !== "rejected" &&
                !completed.some((c) => c.assignmentIds.includes(a.id)),
            );
            const interrupted = parentReason !== "completed" || pending;
            return {
              coordinatorSessionId: parentId,
              coordinatorTurn: turn,
              ...(m.segmentStartSeq === undefined
                ? {}
                : { segmentStartSeq: m.segmentStartSeq }),
              workerId: m.workerId,
              status:
                worker.lifecycle === "deleted"
                  ? ("deleted" as const)
                  : interrupted
                    ? ("stopped" as const)
                    : last?.outcome === "completed"
                      ? ("completed" as const)
                      : last?.outcome === "aborted"
                        ? ("stopped" as const)
                        : ("failed" as const),
              completionIds: completed.map((c) => c.id),
              ...(interrupted
                ? {
                    summary:
                      "Coordinator turn interrupted; worker work may continue.",
                  }
                : {}),
              ...(last?.lastAssistant
                ? {
                    lastResultMessageId: last.lastAssistant.messageId,
                    lastResultSeq: last.lastAssistant.seq,
                  }
                : {}),
            };
          }),
      ],
    }));
  }
}
