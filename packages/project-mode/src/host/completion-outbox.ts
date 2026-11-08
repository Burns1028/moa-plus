import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage, freezeMessage } from "@deepseek-ai/dsh-llm";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { withManagedAgent } from "./moa/residency.ts";
import { projected } from "./native.ts";
import { projection, type Projection } from "./state.ts";
import type { HostAccess } from "./host-access.ts";
import { participatingMemberships, settleContinuedOutcomes } from "./capsule-participation.ts";
import type { AgentDescriptor } from "./moa/agents.ts";
import { consumedNativeReceipts } from "./native-receipt.ts";
/** Serializes result collection and durable native inbox admission. */
export class CompletionOutbox {
  readonly normalizing = new Set<SessionId>();
  readonly workerCuts = new Map<SessionId, Projection>();
  readonly claimed = new Map<SessionId, Set<string>>();
  private ingestions = new Map<SessionId, Promise<void>>();
  private admissions = new Map<SessionId, Promise<void>>();
  private retries = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private host: HostAccess) {}
  dispose() {
    for (const timer of this.retries.values()) clearTimeout(timer);
  }
  ingest(workerId: SessionId): Promise<void> {
    const pending = this.ingestions.get(workerId) ?? Promise.resolve();
    const work = pending
      .then(() => this.ingestCompletion(workerId))
      .finally(() => {
        if (this.ingestions.get(workerId) === work)
          this.ingestions.delete(workerId);
      });
    this.ingestions.set(workerId, work);
    return work;
  }
  private async ingestCompletion(workerId: SessionId) {
    let r = this.host.owner(workerId);
    if (!r) return;
    const parentId = SessionId(r.project.coordinatorSessionId),
      agent = this.host.ctx.agents.get(workerId);
    let state: Projection;
    if (agent) state = projected(this.host.ctx, agent.session);
    else if (this.workerCuts.has(workerId))
      state = this.workerCuts.get(workerId)!;
    else {
      using observed =
        await this.host.ctx.sessionQuery.observeSession(workerId);
      state = observed.events.reduce(
        projection.apply,
        projection.init(observed.header, observed.inheritedEventCount),
      );
    }
    // Fast completion can precede the spawn/send receipt. Wait for accepted assignments.
    if (
      r.assignments.some(
        (a) =>
          a.workerId === workerId &&
          (a.admission === "prepared" || a.admission === "unknown"),
      )
    )
      return;
    for (const finished of state.finished) {
      const id = `${r.project.id}:${workerId}:${finished.seq}`;
      if (this.host.record(parentId)!.completions.some((c) => c.id === id))
        continue;
      const completion = {
        id,
        workerId,
        workerTurn: finished.turn,
        turnEndSeq: finished.seq,
        assignmentIds: r.assignments
          .filter(
            (a) => a.messageId && finished.messageIds.includes(a.messageId),
          )
          .map((a) => a.id),
        outcome: finished.reason,
        ...(finished.lastAssistant
          ? { lastAssistant: finished.lastAssistant }
          : {}),
        settledAt: finished.time,
      };
      const message = createUserMessage({
        source: {
          kind: "project-mode-result",
          form: "relay",
          completionId: id,
          workerId,
          workerTurn: finished.turn,
        },
        content: [
          {
            type: "text",
            text: `Worker ${this.host.worker(r, workerId).name} (${workerId}), turn ${finished.turn}, outcome ${finished.reason}. Completion ${id}. ${finished.lastAssistant ? `Final assistant ${finished.lastAssistant.messageId} at seq ${finished.lastAssistant.seq}:` : "No final assistant message in this turn."}`,
          },
          ...(finished.lastAssistant?.content ?? []),
        ],
      });
      await this.host.update(parentId, (r) => settleContinuedOutcomes({
        ...r,
        completions: [...r.completions, completion],
        deliveries: [
          ...r.deliveries,
          {
            completionId: id,
            targetId:
              (
                r.operations[`moa:agent:${workerId}`] as unknown as
                  | AgentDescriptor
                  | undefined
              )?.reportTo ?? parentId,
            message,
            state:
              (this.host.worker(r, workerId).lifecycle === "deleting" ||
                this.host.worker(r, workerId).lifecycle === "deleted") &&
              completion.outcome === "aborted"
                ? "suppressed"
                : "pending",
            attempts: 0,
          },
        ],
      }));
    }
    await this.deliver(parentId);
  }
  async consume(targetId: SessionId, messageId: string) {
    const r = this.host.record(targetId) ?? this.host.owner(targetId);
    const parentId = r ? SessionId(r.project.coordinatorSessionId) : targetId;
    if (
      !r ||
      !r.deliveries.some(
        (d) =>
          d.message.id === messageId &&
          (d.targetId ?? parentId) === targetId &&
          d.state !== "consumed",
      )
    )
      return;
    const agent = this.host.ctx.agents.get(targetId);
    // Captured by the native projection at the exact user/message receipt;
    // asynchronous persistence must not borrow a later human input's anchor.
    let anchor = agent
      ? projected(this.host.ctx, agent.session).resultAnchors[messageId]
      : undefined;
    if (!anchor) {
      using observed =
        await this.host.ctx.sessionQuery.observeSession(targetId);
      anchor = observed.events.reduce(
        projection.apply,
        projection.init(observed.header, observed.inheritedEventCount),
      ).resultAnchors[messageId];
    }
    await this.host.update(parentId, (r) => ({
      ...r,
      deliveries: r.deliveries.map((d) =>
        d.message.id === messageId ? { ...d, state: "consumed" } : d,
      ),
      memberships: (() => {
        const delivery = r.deliveries.find((d) => d.message.id === messageId),
          completion = r.completions.find(
            (c) => c.id === delivery?.completionId,
          );
        return targetId === parentId && anchor && completion
          ? participatingMemberships(
              r,
              completion.workerId,
              anchor,
              "result",
              `result:${completion.id}`,
              completion.id,
            )
          : r.memberships;
      })(),
    }));
  }
  deliver(parentId: SessionId): Promise<void> {
    const pending = this.admissions.get(parentId) ?? Promise.resolve();
    const work = pending
      .then(() => this.admitDeliveries(parentId))
      .finally(() => {
        if (this.admissions.get(parentId) === work)
          this.admissions.delete(parentId);
      });
    this.admissions.set(parentId, work);
    return work;
  }
  private async admitDeliveries(parentId: SessionId) {
    const record = this.host.record(parentId);
    if (!record) return;
    const targets = new Set(
      record.deliveries
        .filter((d) => d.state !== "consumed" && d.state !== "suppressed")
        .map((d) => SessionId(d.targetId ?? parentId)),
    );
    for (const targetId of targets) await this.admitTarget(parentId, targetId);
  }
  private async admitTarget(
    parentId: SessionId,
    targetId: SessionId,
    resident?: Agent,
  ): Promise<void> {
    const target =
      targetId === parentId
        ? undefined
        : this.host.record(parentId)?.workers.find((w) => w.id === targetId);
    if (target?.lifecycle === "deleted") {
      await this.host.update(parentId, (r) => ({
        ...r,
        deliveries: r.deliveries.map((d) =>
          d.targetId === targetId && d.state !== "consumed"
            ? { ...d, state: "suppressed" }
            : d,
        ),
      }));
      return;
    }
    if (target?.lifecycle === "deleting" || this.normalizing.has(targetId))
      return;
    // A legacy/native parent delivery may have been consumed while this plugin
    // was absent. Reconcile BEFORE resolving/waking the cold coordinator.
    let agent = resident ?? this.host.ctx.agents.get(targetId);
    const events = agent
      ? agent.session.snapshotEvents()
      : await (async () => {
          using observed =
            await this.host.ctx.sessionQuery.observeSession(targetId);
          return observed.events;
        })();
    const receipts = consumedNativeReceipts(
      this.host
        .record(parentId)!
        .completions.filter((c) =>
          this.host
            .record(parentId)!
            .deliveries.some(
              (d) =>
                d.completionId === c.id &&
                (d.targetId ?? parentId) === targetId,
            ),
        ),
      events,
    );
    const adopted = this.host
      .record(parentId)!
      .deliveries.filter(
        (d) =>
          d.state !== "consumed" &&
          d.state !== "suppressed" &&
          receipts.has(d.completionId) &&
          (d.targetId ?? parentId) === targetId &&
          !this.claimed.get(targetId)?.has(d.message.id),
      );
    if (adopted.length) {
      await this.host.update(parentId, (r) => ({
        ...r,
        deliveries: r.deliveries.map((d) =>
          adopted.some((a) => a.message.id === d.message.id)
            ? {
                ...d,
                state: "consumed",
                nativeReceipt: receipts.get(d.completionId),
                lastError: undefined,
              }
            : d,
        ),
      }));
      for (const delivery of adopted) agent?.inbox.remove(delivery.message.id);
    }
    if (
      !this.host
        .record(parentId)!
        .deliveries.some(
          (d) =>
            (d.targetId ?? parentId) === targetId &&
            d.state !== "consumed" &&
            d.state !== "suppressed",
        )
    )
      return;
    if (!resident)
      return withManagedAgent(
        this.host,
        targetId,
        this.host.closing.signal,
        async (resolved) => this.admitTarget(parentId, targetId, resolved),
      );
    agent = resident;
    for (const d of this.host.record(parentId)!.deliveries) {
      if (this.normalizing.has(targetId)) return;
      if ((d.targetId ?? parentId) !== targetId) continue;
      if (d.state === "consumed" || d.state === "suppressed") continue;
      if (
        projected(this.host.ctx, agent.session).consumed.includes(d.message.id)
      ) {
        await this.consume(targetId, d.message.id);
        continue;
      }
      if (this.claimed.get(targetId)?.has(d.message.id)) continue;
      if (
        [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(
          (m) => m.id === d.message.id,
        )
      )
        continue;
      try {
        // Identity is durable before this admission. Replays reuse the exact message.
        if (agent.status === "running") agent.steer(freezeMessage(d.message));
        else agent.followup(freezeMessage(d.message));
        await this.host.ctx.sessions.flush(agent.session);
        await this.host.update(parentId, (r) => ({
          ...r,
          deliveries: r.deliveries.map((x) =>
            x.completionId === d.completionId && x.state !== "consumed"
              ? {
                  ...x,
                  state: "admitted",
                  attempts: x.attempts + 1,
                  lastError: undefined,
                }
              : x,
          ),
        }));
      } catch (error) {
        await this.host.update(parentId, (r) => ({
          ...r,
          deliveries: r.deliveries.map((x) =>
            x.completionId === d.completionId
              ? { ...x, attempts: x.attempts + 1, lastError: String(error) }
              : x,
          ),
        }));
        if (
          d.attempts < this.host.config.retryMaxAttempts &&
          !this.host.closing.signal.aborted &&
          !this.retries.has(parentId)
        )
          this.retries.set(
            parentId,
            setTimeout(
              () => {
                this.retries.delete(parentId);
                this.host.enqueue(parentId, () => this.deliver(parentId));
              },
              Math.min(
                this.host.config.retryMaxDelayMs,
                this.host.config.retryInitialDelayMs * 2 ** d.attempts,
              ),
            ),
          );
        this.host.notify();
      }
    }
  }
}
