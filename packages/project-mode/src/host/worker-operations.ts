import { isVisibleWorker } from "../shared/worker-membership.ts";
import { SubagentError } from "@deepseek-ai/dsh-subagent";
import { randomUUID } from "node:crypto";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
  ControlResult,
  ControlReceipt,
  ControlWorkersRequest,
  WorkerView,
} from "../shared/index.ts";
import { controlSchema } from "./control.ts";
import { messageSchema } from "./state.ts";
import {
  nativeAdmissionRejection,
  queueHostSubagentPrompt,
  steerHostSubagentPrompt,
  projected,
} from "./native.ts";
import {
  nativeOperationSeq,
  participatingMemberships,
} from "./capsule-participation.ts";
import type { HostAccess } from "./host-access.ts";
/** Native worker operations with durable operation identities. */
export class WorkerOperations {
  readonly operations = new Map<string, Promise<ControlResult>>();
  private workerQueues = new Map<SessionId, Promise<ControlResult>>();
  constructor(private host: HostAccess) {}
  listWorkers(agent: Agent, signal: AbortSignal): Promise<WorkerView[]> {
    const r = this.host.requireCoordinator(agent);
    return Promise.all(
      r.workers
        .filter(isVisibleWorker)
        .map((w) => this.host.inspect(w, signal)),
    );
  }
  async controlForAgent(
    agent: Agent,
    request: ControlWorkersRequest,
    operationId: string,
    signal: AbortSignal,
  ): Promise<ControlResult> {
    const req = controlSchema.parse(request),
      r = this.host.requireCoordinator(agent);
    if (!operationId) throw new Error("operationId required");
    if (req.action === "list") return this.listWorkers(agent, signal);
    if (req.action === "get") {
      const worker = this.host.worker(r, req.worker_id);
      if (worker.lifecycle === "deleted")
        throw new Error("project-mode/worker-inactive");
      return this.host.inspect(worker, signal, true);
    }
    if (req.action === "history")
      return this.host.readHistory(
        agent.id,
        req.worker_id,
        req.offset,
        req.limit,
        signal,
      );
    if (r.operations[operationId])
      return r.operations[operationId] as unknown as ControlResult;
    const key = JSON.stringify([agent.id, operationId]),
      pending = this.operations.get(key);
    if (pending) return pending;
    // Serialize dispatch/delete for each native child; never hold this queue
    // while the coordinator waits for worker completion.
    const before =
      req.action === "spawn"
        ? Promise.resolve()
        : (this.workerQueues.get(req.worker_id) ?? Promise.resolve());
    const work = before
      .catch(() => {})
      .then(() =>
        this.dispatch(
          agent,
          req,
          operationId,
          AbortSignal.any([signal, this.host.closing.signal]),
        ),
      )
      .finally(() => {
        this.operations.delete(key);
        if (
          req.action !== "spawn" &&
          this.workerQueues.get(req.worker_id) === work
        )
          this.workerQueues.delete(req.worker_id);
        this.host.notify();
      });
    this.operations.set(key, work);
    if (req.action !== "spawn") this.workerQueues.set(req.worker_id, work);
    this.host.notify();
    return work;
  }
  private async dispatch(
    agent: Agent,
    req: Exclude<ControlWorkersRequest, { action: "list" | "get" | "history" }>,
    operationId: string,
    signal: AbortSignal,
  ): Promise<ControlResult> {
    signal.throwIfAborted();
    let r = this.host.requireCoordinator(agent);
    const placement = projected(this.host.ctx, agent.session);
    const turn = this.host.ctx.sessionProjections.stateOf(
      agent.session,
      "turnBoundary",
    )!.lastTurn;
    if (req.action === "interrupt" || req.action === "delete")
      return this.interruptOrDelete(agent, req, operationId);
    let assignment = r.assignments.find((a) => a.operationId === operationId);
    const workerId =
      req.action === "spawn"
        ? SessionId(assignment?.workerId ?? randomUUID())
        : req.worker_id;
    if (
      req.action === "send" &&
      this.host.worker(r, workerId).lifecycle !== "active"
    )
      throw new Error("project-mode/worker-inactive");
    if (assignment) {
      if (assignment.admission === "rejected")
        throw new SubagentError(
          assignment.rejection?.message ?? "Project operation was not admitted",
          assignment.rejection?.code ?? "PROJECT_OPERATION_REJECTED",
        );
      // An uncertain native call must be reconciled before another admission.
      await this.reconcileAssignment(agent, assignment.id);
      r = this.host.record(agent.id)!;
      assignment = r.assignments.find((a) => a.operationId === operationId)!;
      if (assignment.admission === "accepted")
        return this.acceptReceipt(
          agent,
          operationId,
          workerId,
          assignment.id,
          assignment.messageId!,
          assignment.coordinatorTurn,
          req.action === "spawn" ? undefined : req.delivery,
        );
      throw new Error(
        "project-mode/admission-uncertain: reconcile before retry",
      );
    }
    const assignmentId = randomUUID();
    await this.prepareAssignment(
      agent,
      req,
      operationId,
      workerId,
      assignmentId,
      turn,
      placement,
    );
    let accepted = false;
    try {
      const messageId = await this.admitWorkerInput(
        agent,
        req,
        operationId,
        workerId,
        signal,
      );
      accepted = true;
      const receipt = await this.acceptReceipt(
        agent,
        operationId,
        workerId,
        assignmentId,
        messageId,
        turn,
        req.action === "spawn" ? undefined : req.delivery,
      );
      this.host.enqueue(agent.id, () => this.host.ingest(workerId));
      return receipt;
    } catch (error) {
      const rejection = accepted ? undefined : nativeAdmissionRejection(error);
      await this.host.update(agent.id, (r) => ({
        ...r,
        workers:
          rejection && req.action === "spawn"
            ? r.workers.map((w) =>
                w.id === workerId && w.lifecycle === "provisioning"
                  ? { ...w, lifecycle: "provision-failed" }
                  : w,
              )
            : r.workers,
        assignments: r.assignments.map((a) =>
          a.id === assignmentId
            ? {
                ...a,
                admission: rejection ? "rejected" : "unknown",
                ...(rejection ? { rejection } : {}),
              }
            : a,
        ),
      }));
      throw error;
    }
  }
  /** Stop/removal is independent from assigning another turn of work. */
  private async interruptOrDelete(
    agent: Agent,
    req: Extract<ControlWorkersRequest, { action: "interrupt" | "delete" }>,
    operationId: string,
  ): Promise<ControlReceipt> {
    const r = this.host.requireCoordinator(agent);
    const worker = this.host.worker(r, req.worker_id);
    if (req.action === "interrupt" && worker.lifecycle === "deleted")
      throw new Error("project-mode/worker-inactive");
    if (req.action === "interrupt")
      this.host.ctx.subagents.interrupt(req.worker_id, {
        kind: "ancestor",
        agent,
      });
    else if (worker.lifecycle !== "deleted") {
      await this.host.update(agent.id, (r) => ({
        ...r,
        workers: r.workers.map((w) =>
          w.id === worker.id ? { ...w, lifecycle: "deleting" } : w,
        ),
      }));
      await this.host.ctx.subagents.drainChildren(agent, [req.worker_id]);
      await this.host.update(agent.id, (r) => ({
        ...r,
        workers: r.workers.map((w) =>
          w.id === worker.id
            ? { ...w, lifecycle: "deleted", deletedAt: Date.now() }
            : w,
        ),
      }));
    }
    const receipt: ControlReceipt = {
      operationId,
      workerId: req.worker_id,
      accepted: true,
      ...(req.action === "delete"
        ? { lifecycle: "deleted", historyRetained: true }
        : { queuedWorkPolicy: "native-preserve" }),
    };
    await this.host.update(agent.id, (r) => ({
      ...r,
      operations: {
        ...r.operations,
        [operationId]: JSON.parse(JSON.stringify(receipt)),
      },
    }));
    return receipt;
  }

  /** Record operation intent before crossing native inbox admission. */
  private async prepareAssignment(
    agent: Agent,
    req: Extract<ControlWorkersRequest, { action: "spawn" | "send" }>,
    operationId: string,
    workerId: SessionId,
    assignmentId: string,
    turn: number,
    placement: ReturnType<typeof projected>,
  ): Promise<void> {
    await this.host.update(agent.id, (r) => ({
      ...r,
      workers:
        req.action === "spawn"
          ? [
              ...r.workers,
              {
                id: workerId,
                name: req.name,
                description: req.task,
                creationOperationId: operationId,
                lifecycle: "provisioning",
                createdAt: Date.now(),
              },
            ]
          : r.workers,
      assignments: [
        ...r.assignments,
        {
          id: assignmentId,
          operationId,
          workerId,
          coordinatorTurn: turn,
          segmentStartSeq: placement.segmentStartSeq,
          participationSeq:
            nativeOperationSeq(operationId, agent.id) ?? placement.lastSeq,
          participationKind: req.action === "spawn" ? "spawn" : "send",
          delivery: req.action === "spawn" ? "steer" : req.delivery,
          admission: "prepared",
          ...(req.task_ref ? { taskRef: req.task_ref } : {}),
        },
      ],
    }));
  }

  private async admitWorkerInput(
    agent: Agent,
    req: Extract<ControlWorkersRequest, { action: "spawn" | "send" }>,
    operationId: string,
    workerId: SessionId,
    signal: AbortSignal,
  ): Promise<string> {
    if (req.action === "spawn") {
      const activation = await this.host.ctx.subagents.startActivation({
        provider: "spawn",
        label: req.name,
        childId: workerId,
        delivery: "caller",
        signal,
        request: {
          parent: agent,
          prompt: [{ type: "text", text: req.task }],
          cwd: this.host.ctx.workingDirectory.get(agent.session),
        },
      });
      void activation.result.catch((error) => {
        this.host.ctx.logger.warn(
          `project-mode: worker ${workerId}: ${String(error)}`,
        );
        this.host.notify();
      });
      return activation.messageId;
    } else {
      const deliver =
        req.delivery === "queue"
          ? queueHostSubagentPrompt
          : steerHostSubagentPrompt;
      return deliver(
        this.host.ctx.subagents,
        agent,
        workerId,
        [{ type: "text", text: req.message }],
        {
          kind: "project-mode-assignment",
          form: "relay",
          operationId,
          coordinatorSessionId: agent.id,
        },
        signal,
      );
    }
  }

  private async acceptReceipt(
    agent: Agent,
    operationId: string,
    workerId: SessionId,
    assignmentId: string,
    messageId: string,
    turn: number,
    delivery?: "steer" | "queue",
  ): Promise<ControlReceipt> {
    const receipt: ControlReceipt = {
      operationId,
      workerId,
      assignmentId,
      messageId,
      coordinatorTurn: turn,
      accepted: true,
      ...(delivery ? { delivery } : {}),
    };
    await this.host.update(agent.id, (r) => ({
      ...r,
      workers: r.workers.map((w) =>
        w.id === workerId && w.lifecycle === "provisioning"
          ? { ...w, lifecycle: "active" }
          : w,
      ),
      assignments: r.assignments.map((a) =>
        a.id === assignmentId ? { ...a, messageId, admission: "accepted" } : a,
      ),
      operations: {
        ...r.operations,
        [operationId]: JSON.parse(JSON.stringify(receipt)),
      },
      memberships: participatingMemberships(
        r,
        workerId,
        {
          coordinatorTurn: turn,
          segmentStartSeq:
            r.assignments.find((a) => a.id === assignmentId)?.segmentStartSeq ??
            0,
          participationSeq:
            r.assignments.find((a) => a.id === assignmentId)
              ?.participationSeq ?? 0,
        },
        r.assignments.find((a) => a.id === assignmentId)?.participationKind ??
          "send",
        operationId,
      ),
    }));
    return receipt;
  }
  async reconcileAssignment(agent: Agent, assignmentId: string) {
    const r = this.host.record(agent.id)!,
      assignment = r.assignments.find((a) => a.id === assignmentId)!;
    if (assignment.admission === "accepted") return;
    const catalog = await this.host.ctx.subagents.listChildren(agent.id);
    if (!catalog.some((c) => c.id === assignment.workerId)) return;
    using observed = await this.host.ctx.sessionQuery.observeSession(
      SessionId(assignment.workerId),
    );
    const first =
      r.workers.find((w) => w.id === assignment.workerId)
        ?.creationOperationId === assignment.operationId;
    const message = observed.events.find(
      (e) =>
        e.type === "user/message" &&
        (first ||
          (e.data.source.kind === "project-mode-assignment" &&
            e.data.source.operationId === assignment.operationId)),
    );
    const inbox = observed.projections?.values.inbox;
    const pending = [
      ...(inbox?.["next-step"] ?? []),
      ...(inbox?.["next-turn"] ?? []),
    ]
      .map((m) => messageSchema.parse(m))
      .find(
        (m) =>
          first ||
          (m.source.kind === "project-mode-assignment" &&
            m.source.operationId === assignment.operationId),
      );
    const id = message?.type === "user/message" ? message.data.id : pending?.id;
    if (id)
      await this.acceptReceipt(
        agent,
        assignment.operationId,
        SessionId(assignment.workerId),
        assignment.id,
        id,
        assignment.coordinatorTurn,
        assignment.delivery,
      );
  }
}
