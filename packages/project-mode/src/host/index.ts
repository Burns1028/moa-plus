import { bindAgentEvents } from "./agent-events.ts";
import { judgeInterrupt } from "./moa/judge.ts";
import { bindBackground } from "./moa/background.ts";
import { bindCompletion } from "./moa/completion.ts";
import { MoAAgents, type AgentDescriptor } from "./moa/agents.ts";
import {
  createTaskTool,
  createForkTool,
  createQueryAgentTool,
  createKillAgentTool,
  createProjectContextTool,
  createSendMessageTool,
} from "./moa/tools.ts";
import { applyRoleRestrictions } from "./moa/roles.ts";
import { bindWorkerMemoryPolicy, type WorkerMemoryPolicyBinding } from "./moa/worker-memory-policy.ts";
import { withManagedAgent } from "./moa/residency.ts";
import { followWorkerParent } from "./worker-parent-retention.ts";
import {
  createNativeMessageBroker,
  type MoAMessageBroker,
} from "./moa/messages.ts";
import { buildProjectSnapshot } from "./project-views.ts";
import { ProjectLifecycle, hasOwnTurn } from "./project-lifecycle.ts";
import { isVisibleWorker } from "../shared/worker-membership.ts";
import type {} from "@deepseek-ai/dsh-agent-preset-registry";
import { CompletionOutbox } from "./completion-outbox.ts";
import { WorkerOperations } from "./worker-operations.ts";
import { TurnCoordination } from "./turn-coordination.ts";
import { readHistory } from "./history.ts";
import { followWorkerTimeline } from "./worker-timeline.ts";
import { bindProjectArchives } from "./project-archive.ts";
import { repairCapsuleOwnership } from "./capsule-participation.ts";
import type { HostAccess } from "./host-access.ts";
import { Context, Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { SessionId } from "@deepseek-ai/dsh-session";
import { historySchema } from "./control.ts";
import {
  resolveOrdinaryAgent,
  registerProjection,
  abortableChange,
  observeForTurn,
} from "./native.ts";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import { assembleContextFor, type Agent } from "@deepseek-ai/dsh-agent";
import type { Domain } from "@deepseek-ai/dsh-storage-domain";
import type {} from "@deepseek-ai/dsh-fs";
import type {} from "@deepseek-ai/dsh-api-remote-access";
import type {} from "@deepseek-ai/dsh-working-directory";
import type {} from "@deepseek-ai/dsh-sandbox-policy";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { randomUUID } from "node:crypto";
import { Config } from "./config.ts";
import { coordinatorPrompt } from "./prompts/coordinator.ts";
import { workerPrompt } from "./prompts/worker.ts";
import { contextIndexPath } from "./project-memory.ts";
import { readWorkerActivity } from "./worker-activity.ts";
import {
  domainSpec,
  recordSchema,
  type RecordState,
  type Worker,
} from "./state.ts";
import type {
  ControlWorkersRequest,
  ControlResult,
  ControlReceipt,
  ProjectSnapshot,
  ProjectFrame,
  WorkerView,
  WorkerHistoryPage,
  WorkerTimelinePage,
  WorkerParentReady,
  SessionModeView,
} from "../shared/index.ts";
export { Config } from "./config.ts";
export * from "../shared/index.ts";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "project-mode-result": {
      kind: "project-mode-result";
      form: "relay";
      completionId: string;
      workerId: SessionId;
      workerTurn: number;
      senderSessionId?: string;
      senderName?: string;
    };
    "project-mode-assignment": {
      kind: "project-mode-assignment";
      form: "relay";
      operationId: string;
      coordinatorSessionId: SessionId;
      senderSessionId?: string;
      senderName?: string;
    };
    "project-mode-notice": {
      kind: "project-mode-notice";
      form: "notice";
      summary: string;
    };
  }
}
declare module "@deepseek-ai/cordis" {
  interface Context {
    projectMode: ProjectMode;
  }
}
/** Native Project coordination; no alternative Agent driver. */
export default class ProjectMode extends TypertRemoteService {
  static Config = Config;
  static inject = [
    "agents",
    "tools",
    "systemPrompt",
    "sessionProjections",
    "sessions",
    "subagents",
    "jobs",
    "sessionQuery",
    "storage",
    "storageDomain",
    "workingDirectory",
    "fs",
  ];
  private domain!: Domain<typeof domainSpec>;
  private outbox!: CompletionOutbox;
  private workers!: WorkerOperations;
  private turns!: TurnCoordination;
  private messages!: MoAMessageBroker;
  private moa!: MoAAgents;
  private moaTools!: ReturnType<typeof defineTool>[];
  private contextTool!: ReturnType<typeof createProjectContextTool>;
  private completionAttach?: (agent: Agent) => void;
  private messageTool!: ReturnType<typeof createSendMessageTool>;
  private lifecycle!: ProjectLifecycle;
  private get access(): HostAccess {
    return {
      ctx: this.ctx,
      config: this.config,
      closing: this.closing,
      listeners: this.listeners,
      record: (id) => this.record(id),
      owner: (id) => this.owner(id),
      worker: (r, id) => this.worker(r, id),
      update: (id, fn) => this.update(id, fn),
      requireCoordinator: (agent) => this.requireCoordinator(agent),
      view: (worker, signal) => this.view(worker, signal),
      inspect: (worker, signal, details) =>
        this.inspect(worker, signal, details),
      readHistory: (...args) => this.readHistory(...args),
      enqueue: (id, work) => this.enqueue(id, work),
      notify: () => this.notify(),
      ingest: (id) => this.ingest(id),
      settledJobs: (id) => this.projectJobs.get(id) ?? Promise.resolve(),
      admitWorkerMessage: (agent, request, operationId, signal, admit) =>
        this.workers.controlForAgent(agent, request, operationId, signal, admit),
      stopManagedWorker: (agent, request, operationId, signal) =>
        this.stopManagedWorker(agent, request, operationId, signal),
      // Worker views can become idle after a new result was queued for ingestion.
      pendingOperations: (id) =>
        [...this.workers.operations.keys()].filter(
          (key) => JSON.parse(key)[0] === id,
        ).length + Number(this.projectJobs.has(id)),
    };
  }

  private mounted = new Map<Agent, { key: string; dispose: () => void }>();
  private memoryBindings = new Map<Agent, WorkerMemoryPolicyBinding>();
  private reconcilingTools = false;
  private toolsChangedDuringReconciliation = false;
  private backgroundBindings = new Map<Agent, Promise<() => Promise<void>>>();
  private projectJobs = new Map<SessionId, Promise<void>>();
  private get jobs(): Promise<void> {
    return Promise.all([...this.projectJobs.values()]).then(() => {});
  }
  private listeners = new Set<() => void>();
  private progress = new Map<SessionId, string>();
  private workerInputSnapshots = new Map<SessionId, string>();
  private coordinatorContextPolicy = new WeakSet<Agent>();
  private epoch = randomUUID();
  private available = false;
  private closing = new AbortController();
  constructor(
    ctx: Context,
    private config: Config,
  ) {
    super(ctx, "projectMode");
  }
  protected async [Service.init]() {
    if (typeof this.ctx.tools.suppress !== "function")
      throw new Error(
        "project-mode/native-compatibility-required: install the rc.3 Project Mode tool-suppression compatibility patch",
      );
    this.domain = await this.ctx.storage.domain.open(domainSpec);
    const archives = bindProjectArchives(this.ctx, this.domain, (id, fn) =>
      this.update(id, fn),
    );
    this.outbox = new CompletionOutbox(this.access);
    this.workers = new WorkerOperations(this.access);
    this.moa = new MoAAgents(this.access, this.workers);
    this.moaTools = [
      createTaskTool(this.moa),
      createForkTool(this.moa),
      createQueryAgentTool(this.moa),
      createKillAgentTool(this.moa),
    ];
    this.contextTool = createProjectContextTool(this.moa);
    this.turns = new TurnCoordination(this.access);
    this.messages = createNativeMessageBroker(
      this.access,
      (agent, messages, description, signal) =>
        judgeInterrupt(
          this.ctx,
          agent,
          messages,
          { kind: "request", description },
          signal,
        ),
    );
    this.messageTool = createSendMessageTool(this.messages);
    this.lifecycle = new ProjectLifecycle(this.access, {
      put: (id, record) => this.domain.table("projects").put(id, record),
      attach: (agent) => this.prepareAgent(agent),
      recover: (id) => this.recover(id),
    });
    await registerProjection(this.ctx);
    // Tool guidance uses named sections. Preserve other providers' text and
    // native complete-prompt ownership; never rewrite arbitrary prompt strings.
    const hiddenToolSections = new Set(
      this.config.coordinatorHiddenTools.map((name) => `tool:${name}`),
    );
    this.ctx.on(
      "system-prompt/assemble",
      async (_assembly, { agent }, next) => {
        const prompt = await next();
        if (!agent || !this.participant(agent))
          return prompt;
        return {
          ...prompt,
          sections: prompt.sections.filter(
            (s) => !hiddenToolSections.has(s.name),
          ),
        };
      },
    );
    this.ctx.systemPrompt.context({
      name: "project-mode:role",
      order: 650,
      required: true,
      interpolate: false,
      text: ({ agent }) => (agent ? this.roleText(agent) : ""),
    });
    this.ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
      if (this.record(agent.id)?.project.mode === "enabled") {
        // Native complete-prompt ownership is enforced after the assembly
        // waterfall. Inspect its final named sections before admission refresh
        // chooses whether the required context needs the policy fallback.
        const systemPrompt =
          this.ctx.get("agentPresets")?.serviceFor(agent, "systemPrompt") ??
          agent.ctx.systemPrompt;
        const assembly = await systemPrompt.assemble(
          assembleContextFor(agent, signal),
        );
        if (
          assembly.sections.some(
            (section) => section.name === "project-mode:coordination",
          )
        )
          this.coordinatorContextPolicy.delete(agent);
        else this.coordinatorContextPolicy.add(agent);
      }
      return next();
    });
    this.ctx.systemPrompt.context({
      name: "project-mode:worker-state",
      order: 660,
      required: true,
      interpolate: false,
      text: ({ agent }) =>
        agent && this.record(agent.id)?.project.mode === "enabled"
          ? (this.workerInputSnapshots.get(agent.id) ?? "")
          : "",
    });
    // Keep fixed policy in the system message; required runtime context carries
    // live paths and supplies policy only when a complete preset replaces it.
    this.ctx.systemPrompt.section({
      name: "project-mode:coordination",
      order: 11000,
      interpolate: false,
      text: ({ agent }) =>
        agent && this.record(agent.id)?.project.mode === "enabled"
          ? coordinatorPrompt
          : "",
    });
    bindAgentEvents(this.access, {
      outbox: this.outbox,
      workers: this.workers,
      progress: this.progress,
      reconcileTools: () => this.reconcileTools(),
      attach: (agent) => this.attach(agent),
      disposeAgent: (agent) => {
        this.workerInputSnapshots.delete(agent.id);
        this.mounted.get(agent)?.dispose();
        this.mounted.delete(agent);
      },
      recover: (id) => this.recover(id),
      guardTurn: (agent, signal) => this.guardTurn(agent, signal),
      freezeTurn: (id, turn, reason) => this.freezeTurn(id, turn, reason),
      refreshWorkersForInput: (agent, ids, signal) =>
        this.refreshWorkersForInput(agent, ids, signal),
    });
    // Native creation awaits serial listeners before admitting a first prompt.
    // Background tools must exist before the loop assembles its tool schema.
    this.ctx.on("agent/created", async ({ agent }) => {
      await this.prepareAgent(agent);
      return undefined;
    });
    this.ctx.on("agent/disposed", async ({ agent }) => {
      await this.releaseBackground(agent);
      this.memoryBindings.get(agent)?.dispose();
      this.memoryBindings.delete(agent);
      return undefined;
    });
    if (this.config.completionVerification) this.completionAttach = bindCompletion(this.access);
    this.ctx.effect(
      () => async () => {
        this.available = false;
        this.closing.abort();
        this.notify();
        this.outbox.dispose();
        this.messages.dispose();
        await Promise.all(
          [...this.backgroundBindings.keys()].map((agent) =>
            this.releaseBackground(agent),
          ),
        );
        // The coordinator survives this plugin. drainDescendants permanently
        // closes its native admission scope until Agent disposal, so release
        // only our selected children after local in-flight admissions settle.
        await Promise.allSettled([...this.workers.operations.values()]);
        await Promise.all(
          this.ctx.agents.list().map(async (parent) => {
            const record = this.record(parent.id);
            if (record)
              await this.ctx.subagents.drainChildren(
                parent,
                record.workers
                  .filter((worker) =>
                    (this.moa.descriptor(SessionId(worker.id))?.creatorId ?? parent.id) === parent.id,
                  )
                  .map((worker) => SessionId(worker.id)),
              );
          }),
        );
        while (this.projectJobs.size) await this.jobs;
        for (const value of this.memoryBindings.values()) value.dispose();
        this.memoryBindings.clear();
        for (const value of this.mounted.values()) value.dispose();
        this.mounted.clear();
        this.moa.dispose();
        await archives.dispose();
        await this.domain.close();
      },
      "project-mode.lifecycle",
    );
    this.available = true;
    for (const agent of this.ctx.agents.list()) await this.prepareAgent(agent);
    for (const [id] of this.domain.table("projects").entries())
      this.enqueue(SessionId(id), () => this.recover(SessionId(id)));
  }
  private async recover(parentId: SessionId) {
    {
      using observed = await this.ctx.sessionQuery.observeSession(parentId);
      const before = this.record(parentId)!;
      const modeLocked =
        before.project.modeLocked === true ||
        (before.project.mode === "enabled" &&
          hasOwnTurn(observed.events, observed.inheritedEventCount));
      if (before.project.modeLocked !== modeLocked)
        await this.update(parentId, (current) => ({
          ...current,
          project: { ...current.project, modeLocked },
        }));
      if (repairCapsuleOwnership(before, observed.events) !== before)
        await this.update(parentId, (current) =>
          repairCapsuleOwnership(current, observed.events),
        );
    }
    let parent = this.ctx.agents.get(parentId);
    const r = this.record(parentId)!;
    if (
      !parent &&
      (r.assignments.some(
        (a) => a.admission === "prepared" || a.admission === "unknown",
      ) || r.workers.some((worker) => worker.lifecycle === "deleting") || this.moa.needsRecovery(r))
    ) {
      parent = await resolveOrdinaryAgent(this.ctx, parentId);
    }
    if (parent) {
      for (const a of r.assignments)
        if (a.admission === "prepared" || a.admission === "unknown")
          await this.reconcileAssignment(parent, a.id);
      for (const w of r.workers)
        if (w.lifecycle === "deleting") {
          const descriptor = this.moa.descriptor(SessionId(w.id));
          const creatorId = SessionId(descriptor?.creatorId ?? parentId);
          const creator = this.ctx.agents.get(creatorId);
          if (creator) await this.ctx.subagents.drainChildren(creator, [SessionId(w.id)]);
          else if (creatorId === parentId || !this.record(parentId)!.workers.some((member) => member.id === creatorId && member.lifecycle === "deleted"))
            await withManagedAgent(this.access, creatorId, this.closing.signal, (active) => this.ctx.subagents.drainChildren(active, [SessionId(w.id)]));
          await this.update(parentId, (state) => ({
            ...state,
            workers: state.workers.map((worker) =>
              worker.id === w.id
                ? { ...worker, lifecycle: "deleted", deletedAt: Date.now() }
                : worker,
            ),
          }));
        }
      await this.moa.recover(parent, this.closing.signal);
    }
    await this.messages.recover(parentId);
    for (const w of this.record(parentId)!.workers)
      if (w.lifecycle === "active" || w.lifecycle === "deleted")
        await this.ingest(SessionId(w.id));
    await this.deliver(parentId);
  }
  private record(id: SessionId): RecordState | undefined {
    return this.domain.table("projects").get(id);
  }
  private owner(id: SessionId): RecordState | undefined {
    return [...this.domain.table("projects").entries()]
      .map(([, r]) => r)
      .find((r) => r.workers.some((w) => w.id === id));
  }
  private authorize(id: SessionId) {
    if (!this.available) throw new Error("project-mode/runtime-unavailable");
    if (
      this.ctx.invocation &&
      !this.ctx.get("remoteAccess")?.allows({ kind: "session", id })
    )
      throw new Error("project-mode/unauthorized: Session access denied");
  }
  private reconcileTools() {
    if (this.closing.signal.aborted) return;
    if (this.reconcilingTools) {
      this.toolsChangedDuringReconciliation = true;
      return;
    }
    for (const agent of this.ctx.agents.list()) this.attach(agent);
  }
  private participant(agent: Agent): boolean {
    const owner = this.owner(agent.id);
    return (
      this.record(agent.id)?.project.mode === "enabled" ||
      (owner?.project.mode === "enabled" &&
        owner.workers.some(
          (worker) =>
            worker.id === agent.id &&
            (worker.lifecycle === "active" || worker.lifecycle === "provisioning"),
        ))
    );
  }
  private async prepareAgent(agent: Agent): Promise<void> {
    this.attach(agent);
    this.completionAttach?.(agent);
    if (!this.participant(agent)) {
      await this.releaseBackground(agent);
      return;
    }
    let binding = this.backgroundBindings.get(agent);
    if (!binding) {
      binding = bindBackground(this.ctx, agent, this.config);
      this.backgroundBindings.set(agent, binding);
    }
    try {
      await binding;
    } catch (error) {
      if (this.backgroundBindings.get(agent) === binding)
        this.backgroundBindings.delete(agent);
      throw error;
    }
  }
  private async releaseBackground(agent: Agent): Promise<void> {
    const binding = this.backgroundBindings.get(agent);
    this.backgroundBindings.delete(agent);
    if (binding) await (await binding)();
  }
  private attach(agent: Agent) {
    const enabled = this.record(agent.id)?.project.mode === "enabled";
    const participant = this.participant(agent);
    const descriptor = this.owner(agent.id)?.operations[
      `moa:agent:${agent.id}`
    ] as unknown as AgentDescriptor | undefined;
    const controls = enabled || descriptor?.nested === true;
    if (this.reconcilingTools || this.closing.signal.aborted) return;
    const owner = this.owner(agent.id);
    if (participant && !enabled && owner?.project.mode === "enabled")
      this.memoryBindings.set(agent, bindWorkerMemoryPolicy(this.ctx, agent, owner.project.paths, this.memoryBindings.get(agent)));
    const deny = participant
      ? [
          ...new Set([
            ...this.config.coordinatorHiddenTools,
            "send_message",
            "control_workers",
          ]),
        ].sort()
      : [];
    const key = JSON.stringify([enabled, participant, controls, descriptor?.role, deny]);
    const old = this.mounted.get(agent);
    if (old?.key === key) return;
    this.reconcilingTools = true;
    try {
      this.mounted.delete(agent);
      old?.dispose();
      if (participant) {
        const restrictions = deny.length
          ? agent.ctx.tools.suppress({ deny })
          : () => {};
        const tools: (() => void)[] = [];
        try {
          if (controls)
            for (const tool of this.moaTools)
              tools.push(agent.ctx.tools.register(tool));
          tools.push(agent.ctx.tools.register(this.messageTool));
          tools.push(agent.ctx.tools.register(this.contextTool));
          if (descriptor)
            tools.push(applyRoleRestrictions(this.ctx, agent, descriptor.role));
          this.mounted.set(agent, {
            key,
            dispose: () => {
              for (const off of tools.reverse()) off();
              restrictions();
            },
          });
        } catch (error) {
          for (const off of tools.reverse()) off();
          restrictions();
          throw error;
        }
      }
    } finally {
      this.reconcilingTools = false;
    }
    // Other listeners may register tools synchronously during our own change
    // notifications. Revisit their final state; an unchanged deny key is inert.
    if (this.toolsChangedDuringReconciliation) {
      this.toolsChangedDuringReconciliation = false;
      for (const subject of this.ctx.agents.list()) this.attach(subject);
    }
  }

  private roleText(agent: Agent): string {
    const own = this.record(agent.id);
    if (own?.project.mode === "enabled")
      return `${this.coordinatorContextPolicy.has(agent) ? `${coordinatorPrompt}\n` : ""}Paths: ${JSON.stringify({ ...own.project.paths, contextIndex: contextIndexPath(own.project.paths) })}`;
    const parent = this.owner(agent.id);
    return parent
      ? parent.operations[`moa:agent:${agent.id}`]
        ? workerPrompt
        : `${workerPrompt}\nPaths: ${JSON.stringify({ ...parent.project.paths, contextIndex: contextIndexPath(parent.project.paths) })}`
      : "";
  }
  private notify() {
    for (const fn of [...this.listeners]) fn();
  }
  private enqueue(id: SessionId, work: () => Promise<void>) {
    const job = (this.projectJobs.get(id) ?? Promise.resolve())
      .then(work)
      .catch((error) => {
        this.ctx.logger.warn(String(error));
      })
      .then(() => {
        if (this.projectJobs.get(id) === job) this.projectJobs.delete(id);
        this.notify();
      });
    this.projectJobs.set(id, job);
  }
  private async update(id: SessionId, fn: (r: RecordState) => RecordState) {
    await this.domain.table("projects").update(id, (r) => {
      const next = fn(r);
      return recordSchema.parse({
        ...next,
        project: {
          ...next.project,
          revision: r.project.revision + 1,
          updatedAt: Date.now(),
        },
      });
    });
    this.notify();
  }
  private worker(r: RecordState, id: SessionId) {
    const w = r.workers.find((w) => w.id === id);
    if (!w) throw new Error("project-mode/not-owned");
    return w;
  }
  private requireCoordinator(agent: Agent) {
    if (
      !this.available ||
      this.ctx.agents.get(agent.id) !== agent ||
      this.record(agent.id)?.project.mode !== "enabled"
    )
      throw new Error("project-mode/not-coordinator");
    return this.record(agent.id)!;
  }
  async controlForAgent(
    agent: Agent,
    request: ControlWorkersRequest,
    operationId: string,
    signal: AbortSignal,
  ): Promise<ControlResult> {
    return this.workers.controlForAgent(agent, request, operationId, signal);
  }
  /** Legacy delete keeps its receipt/serialization while cleaning MoA-owned resources. */
  private async stopManagedWorker(
    agent: Agent,
    request: Extract<ControlWorkersRequest, { action: "delete" }>,
    operationId: string,
    signal: AbortSignal,
  ): Promise<ControlReceipt> {
    const record = this.requireCoordinator(agent);
    const saved = record.operations[operationId];
    if (saved) return saved as unknown as ControlReceipt;
    const worker = this.worker(record, request.worker_id);
    if (worker.lifecycle !== "deleted") {
      const descriptor = this.moa.descriptor(request.worker_id)!;
      const creatorId = SessionId(descriptor.creatorId);
      const destroy = (creator: Agent) => this.moa.kill(creator, request.worker_id, signal, { destroy: true, operationId });
      if (creatorId === agent.id) await destroy(agent);
      else await withManagedAgent(this.access, creatorId, signal, destroy);
    }
    const receipt = { operationId, workerId: request.worker_id, accepted: true, lifecycle: "deleted", historyRetained: true } as const;
    await this.update(agent.id, (current) => ({ ...current, operations: { ...current.operations, [operationId]: receipt } }));
    return receipt;
  }
  private reconcileAssignment(agent: Agent, assignmentId: string) {
    return this.workers.reconcileAssignment(agent, assignmentId);
  }
  private async refreshWorkersForInput(
    agent: Agent,
    inputMessageIds: string[],
    signal: AbortSignal,
  ) {
    const superseded = new AbortController();
    const wake = () => {
      if (
        agent.inbox.nextStep.some((message) => message.source.kind === "user")
      )
        superseded.abort(new Error("project-mode/worker-refresh-superseded"));
    };
    this.listeners.add(wake);
    try {
      wake();
      let workers: WorkerView[] | null;
      try {
        workers = await this.workers.listWorkers(
          agent,
          AbortSignal.any([signal, superseded.signal]),
        );
      } catch (error) {
        signal.throwIfAborted();
        if (!superseded.signal.aborted) throw error;
        workers = null;
      }
      signal.throwIfAborted();
      this.workerInputSnapshots.set(
        agent.id,
        `Worker state sampled for this user input (null means unavailable).\n${JSON.stringify({ sampledAt: Date.now(), inputMessageIds, workers })}`,
      );
    } finally {
      this.listeners.delete(wake);
    }
  }
  private async inspect(
    worker: Worker,
    signal?: AbortSignal,
    details = false,
  ): Promise<WorkerView> {
    const view = await this.view(worker, signal);
    try {
      return {
        ...view,
        activity: await readWorkerActivity(
          this.access,
          SessionId(worker.id),
          signal,
          details ? Number.MAX_SAFE_INTEGER : this.config.progressTextMaxChars,
        ),
      };
    } catch {
      signal?.throwIfAborted();
      return { ...view, activity: null };
    }
  }
  private async view(
    worker: Worker,
    signal?: AbortSignal,
  ): Promise<WorkerView> {
    const id = SessionId(worker.id),
      agent = this.ctx.agents.get(id);
    let status: WorkerView["status"] = null,
      availability: WorkerView["availability"] = "unavailable",
      queueLength: number | null = null,
      pendingSteerCount: number | null = null,
      parentSessionId = agent?.session.header.parentSession;
    try {
      if (agent) {
        status = agent.status === "running" || agent.moaHasPendingBackground ? "busy" : "idle";
        availability = "live";
        queueLength = agent.inbox.nextTurn.length;
        pendingSteerCount = agent.inbox.nextStep.length;
      } else {
        using observed = await observeForTurn(this.ctx, id, signal);
        parentSessionId = observed.header.parentSession;
        const inbox = observed.projections?.values.inbox;
        if (!inbox) throw new Error("inbox unavailable");
        status = "idle";
        availability = "cold";
        queueLength = inbox["next-turn"].length;
        pendingSteerCount = inbox["next-step"].length;
      }
    } catch {
      signal?.throwIfAborted();
      /* Unavailable stays unknown, never fabricated idle. */
    }
    const last = this.owner(id)
      ?.completions.filter((c) => c.workerId === id)
      .at(-1);
    const text =
      this.progress.get(id) ??
      (status !== "busy"
        ? last?.lastAssistant?.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("")
        : undefined);
    const execution = agent ? this.moa.lifecycle(agent) : undefined;
    return {
      workerId: id,
      ...(parentSessionId ? { parentSessionId } : {}),
      name: worker.name,
      lifecycle: worker.lifecycle,
      status,
      availability,
      queueLength,
      pendingSteerCount,
      phase:
        worker.lifecycle === "provision-failed"
          ? "failed"
          : worker.lifecycle === "provisioning"
            ? "starting"
            : execution === "Aborting"
              ? "stopping"
              : execution === "Waiting"
                ? "waiting-user"
            : availability === "unavailable"
              ? "disconnected"
              : status === "busy"
                ? "working"
                : last?.outcome === "aborted"
                  ? "stopped"
                  : last?.outcome === "error"
                    ? "failed"
                    : "idle",
      ...(text
        ? { progressText: text.slice(0, this.config.progressTextMaxChars) }
        : {}),
      updatedAt: Date.now(),
    };
  }
  private ingest(id: SessionId) {
    return this.outbox.ingest(id);
  }
  private deliver(id: SessionId) {
    return this.outbox.deliver(id);
  }
  private guardTurn(agent: Agent, signal: AbortSignal) {
    return this.turns.guardTurn(agent, signal);
  }
  private freezeTurn(id: SessionId, turn: number, reason: string) {
    return this.turns.freezeTurn(id, turn, reason);
  }
  @Remote("snapshot")
  async snapshot(sessionId: SessionId): Promise<ProjectSnapshot | null> {
    this.authorize(sessionId);
    await (this.projectJobs.get(sessionId) ?? Promise.resolve());
    const r = this.record(sessionId);
    if (!r) return null;
    const members = r.workers.filter(isVisibleWorker),
      memberIds = new Set(members.map((w) => w.id)),
      workers = await Promise.all(members.map((w) => this.view(w))),
      agent = this.ctx.agents.get(sessionId),
      boundary = agent
        ? this.ctx.sessionProjections.stateOf(agent.session, "turnBoundary")!
        : undefined;
    return buildProjectSnapshot({
      sessionId,
      record: r,
      workers,
      memberIds,
      boundary,
      waiting: this.turns.waiting.has(sessionId),
      pendingSteerCount: agent?.inbox.nextStep.length ?? 0,
      streamEpoch: this.epoch,
    });
  }

  @Remote({ name: "follow", mode: "stream" })
  async *follow(
    sessionId: SessionId,
    signal: AbortSignal,
  ): AsyncIterable<ProjectFrame> {
    const control = AbortSignal.any([signal, this.closing.signal]);
    while (!control.aborted) {
      const iteration = new AbortController();
      const next = abortableChange(
        this.listeners,
        AbortSignal.any([control, iteration.signal]),
      );
      void next.catch(() => {});
      try {
        const value = await this.snapshot(sessionId);
        if (value) yield { type: "baseline", value };
        try {
          await next;
        } catch {
          return;
        }
      } finally {
        iteration.abort();
      }
    }
  }

  @Remote({ name: "followWorkerParent", mode: "stream" })
  async *followWorkerParent(
    sessionId: SessionId,
    workerId: SessionId,
    signal: AbortSignal,
  ): AsyncIterable<WorkerParentReady> {
    this.authorize(sessionId);
    yield* followWorkerParent(this.access, sessionId, workerId, signal);
  }

  @Remote("catalog")
  async catalog(): Promise<ProjectSnapshot[]> {
    if (!this.available) throw new Error("project-mode/runtime-unavailable");
    const result: ProjectSnapshot[] = [];
    for (const [id] of this.domain.table("projects").entries())
      if (
        !this.ctx.invocation ||
        this.ctx
          .get("remoteAccess")
          ?.allows({ kind: "session", id: SessionId(id) })
      ) {
        const snapshot = await this.snapshot(SessionId(id));
        if (snapshot) result.push(snapshot);
      }
    return result;
  }
  @Remote("control")
  async control(
    sessionId: SessionId,
    request: ControlWorkersRequest,
    requestId: string,
    signal: AbortSignal,
  ): Promise<ControlResult> {
    this.authorize(sessionId);
    const agent = this.ctx.agents.get(sessionId);
    if (!agent) throw new Error("project-mode/coordinator-unavailable");
    return this.controlForAgent(agent, request, `remote:${requestId}`, signal);
  }
  @Remote("history")
  async history(
    sessionId: SessionId,
    workerId: SessionId,
    offset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<WorkerHistoryPage> {
    this.authorize(sessionId);
    const request = historySchema.parse({
      action: "history",
      worker_id: workerId,
      offset,
      limit,
    });
    return this.readHistory(
      sessionId,
      request.worker_id,
      request.offset,
      request.limit,
      signal,
    );
  }
  @Remote({ name: "timeline", mode: "stream" })
  async *timeline(
    sessionId: SessionId,
    workerId: SessionId,
    limit: number,
    signal: AbortSignal,
  ): AsyncIterable<WorkerTimelinePage> {
    this.authorize(sessionId);
    const request = historySchema.parse({
      action: "history",
      worker_id: workerId,
      offset: 0,
      limit,
    });
    yield* followWorkerTimeline(
      this.access,
      sessionId,
      request.worker_id,
      request.limit,
      signal,
    );
  }
  private readHistory(
    parentId: SessionId,
    workerId: SessionId,
    offset: number,
    limit: number,
    signal: AbortSignal,
  ) {
    return readHistory(this.access, parentId, workerId, offset, limit, signal);
  }
  @Remote("mode")
  mode(sessionId: SessionId): SessionModeView {
    this.authorize(sessionId);
    return this.lifecycle.mode(sessionId);
  }
  @Remote("setEnabled")
  async setEnabled(
    sessionId: SessionId,
    enabled: boolean,
    expectedRevision: number,
    requestId: string,
  ): Promise<SessionModeView> {
    this.authorize(sessionId);
    return this.lifecycle.setEnabled(
      sessionId,
      enabled,
      expectedRevision,
      requestId,
    );
  }
}
