import type {} from "@deepseek-ai/dsh-user-approval";
import { withManagedAgent } from "./residency.ts";
import { randomUUID } from "node:crypto";
import { observeForTurn } from "../native.ts";
import { accessProjectContext, contextIndexPath, type ProjectContextInput } from "../project-memory.ts";
import { identityMessage, workerReportingInstructions } from "../prompts/identity.ts";
import {
  MoAWorkspaceManager,
  MoAWorkspacePrepareError,
  type MoAWorkspaceRecord,
} from "./workspaces.ts";
import {
  buildForkSeed,
  SessionId,
  type SessionEvent,
  type SessionSeq,
} from "@deepseek-ai/dsh-session";
import type { SubagentProvider } from "@deepseek-ai/dsh-subagent";

/** Native continuation manager reserves the child and owns activation. */
export function createForkProvider(
  loadSeed: (id: SessionId) => readonly SessionEvent[] | undefined,
): SubagentProvider {
  return {
    name: "moa-fork",
    capabilities: {
      agentOptions: true,
      agentPreset: false,
      outputSchema: true,
      depthLimit: true,
    },
    inheritsParentContext: true,
    async prepareContinuable({ sessionId, signal }) {
      signal.throwIfAborted();
      const seed = loadSeed(sessionId);
      if (!seed) throw new Error("moa/fork-seed-unavailable");
      return seed.length ? { seed } : {};
    },
  };
}

/** The inclusive committed watermark is selected by the caller observing the source. */
export function prepareForkSeed(
  events: readonly SessionEvent[],
  watermark: SessionSeq,
): SessionEvent[] {
  if (!events.some((event) => event.seq === watermark))
    throw new Error("moa/fork-watermark-unavailable");
  return buildForkSeed(events, watermark);
}

import type { Agent } from "@deepseek-ai/dsh-agent";
import type { HostAccess } from "../host-access.ts";
import type { WorkerOperations } from "../worker-operations.ts";

export interface TaskInput {
  name: string;
  task: string;
  role: "Explorer" | "Planner" | "Deep Research" | "General-purpose";
  workspace?: "shared" | "isolated";
  reportTo?: string;
  nested?: boolean;
}
export interface AgentDescriptor {
  id: string;
  creatorId: string;
  reportTo: string;
  role: TaskInput["role"];
  nested: boolean;
  sourceDirectory: string;
  workspaceMode: "shared" | "isolated";
  workspace?: MoAWorkspaceRecord;
  forkOperation?: string;
  workspaceIncomplete?: boolean;
}
export interface QueryAgentsInput {
  ids?: string[];
  wait?: "all" | "selected";
  timeoutMs?: number;
  history?: { offset: number; limit: number };
}

/** Views are derived from native Agents and Project membership; no agent loop is duplicated. */
export class MoAAgents {
  private waiting = new Set<string>();
  private tasks = new Map<
    string,
    Promise<Awaited<ReturnType<MoAAgents["startTasks"]>>>
  >();
  private unregisterFork?: () => void;
  dispose() {
    this.unregisterFork?.();
    this.unregisterFork = undefined;
  }
  constructor(
    private host: HostAccess,
    private workers: WorkerOperations,
  ) {
    if (!host.ctx.subagents.getProvider("moa-fork"))
      this.unregisterFork = host.ctx.subagents.registerProvider(
        createForkProvider((id) => {
          const descriptor = this.descriptor(id);
          const fork = descriptor?.forkOperation
            ? (host.owner(id)?.operations[
                descriptor.forkOperation
              ] as unknown as { seed?: SessionEvent[] } | undefined)
            : undefined;
          return fork?.seed;
        }),
      );
  }
  descriptor(id: SessionId): AgentDescriptor | undefined {
    return this.host.owner(id)?.operations[`moa:agent:${id}`] as unknown as
      | AgentDescriptor
      | undefined;
  }
  lifecycle(
    agent: Agent,
  ): "Idle" | "Waiting" | "Running" | "Aborting" | "Zombie" {
    if (agent.moaAborting) return "Aborting";
    if (this.waiting.has(agent.id)) return "Waiting";
    const events = agent.session
      .snapshotEvents()
      .filter((event) => event.seq >= agent.session.inheritedEventCount);
    if (agent.status === "running") {
      const pending = new Set<string>();
      for (const event of events) {
        if (event.type === "turn/start" || event.type === "turn/end")
          pending.clear();
        if (event.type === "approval/asked") pending.add(event.data.id);
        if (event.type === "approval/decided") pending.delete(event.data.id);
      }
      return pending.size ? "Waiting" : "Running";
    }
    return events.some((e) => e.type === "turn/start") ? "Zombie" : "Idle";
  }
  private workspaceManager(agent: Agent): MoAWorkspaceManager {
    const presets = this.host.ctx.get("agentPresets");
    const fs = presets?.serviceFor(agent, "fs") ?? agent.ctx.get("fs");
    const policy =
      presets?.serviceFor(agent, "sandboxPolicy") ??
      agent.ctx.get("sandboxPolicy");
    const sandbox =
      presets?.serviceFor(agent, "sandbox") ?? agent.ctx.get("sandbox");
    if (!fs || (fs.sandboxMode && !policy))
      throw new Error("moa/workspace-capability-unavailable");
    const source = this.host.ctx.workingDirectory.get(agent.session);
    const project = (this.host.record(agent.id) ?? this.host.owner(agent.id))
      ?.project;
    return new MoAWorkspaceManager({
      fs,
      // Workspace management owns only the project's Git resources. Preserve
      // the actor's mode/identity; ordinary execution keeps its own cwd policy.
      policy: () => ({
        ...(policy?.resolve({ session: agent.session }) ?? {
          mode: "danger-full-access" as const,
        }),
        workspaceRoot: project?.workspacePath ?? source,
      }),
      sandbox: sandbox ?? {
        confine: async () => {
          throw new Error("moa/workspace-sandbox-unavailable");
        },
      },
    });
  }
  task(
    agent: Agent,
    tasks: TaskInput[],
    operationId: string,
    signal: AbortSignal,
    seed?: readonly SessionEvent[],
  ) {
    const key = JSON.stringify([agent.id, operationId]);
    const pending = this.tasks.get(key);
    if (pending) return pending;
    const work = this.startTasks(
      agent,
      tasks,
      operationId,
      signal,
      seed,
    ).finally(() => {
      if (this.tasks.get(key) === work) this.tasks.delete(key);
    });
    this.tasks.set(key, work);
    return work;
  }
  private async startTasks(
    agent: Agent,
    tasks: TaskInput[],
    operationId: string,
    signal: AbortSignal,
    seed?: readonly SessionEvent[],
  ) {
    if (!tasks.length || tasks.length > 20)
      throw new Error("moa/invalid-task-batch-size");
    const record = this.host.record(agent.id) ?? this.host.owner(agent.id);
    if (
      !record ||
      record.project.mode !== "enabled" ||
      this.host.ctx.agents.get(agent.id) !== agent
    )
      throw new Error("moa/not-member");
    const rootId = SessionId(record.project.coordinatorSessionId);
    if (
      agent.id !== rootId &&
      !(
        record.operations[`moa:agent:${agent.id}`] as unknown as
          | AgentDescriptor
          | undefined
      )?.nested
    )
      throw new Error("moa/nested-disabled");
    for (const item of tasks) {
      const reportTo = item.reportTo ?? agent.id;
      if (
        reportTo !== rootId &&
        !record.workers.some(
          (w) => w.id === reportTo && w.lifecycle === "active",
        )
      )
        throw new Error("moa/not-member");
    }
    const batchKey = `moa:task:${operationId}`;
    let ids = this.host.record(rootId)?.operations[batchKey] as
      | string[]
      | undefined;
    if (!ids) {
      ids = tasks.map(() => randomUUID());
      await this.host.update(rootId, (r) => ({
        ...r,
        operations: { ...r.operations, [batchKey]: ids! },
      }));
    }
    if (ids.length !== tasks.length)
      throw new Error("moa/task-replay-mismatch");
    const manager = this.workspaceManager(agent);
    const results = [];
    for (let i = 0; i < tasks.length; i++) {
      const item = tasks[i],
        childId = SessionId(ids[i]);
      const key = `moa:agent:${childId}`;
      let descriptor = this.host.record(rootId)?.operations[key] as unknown as
        | AgentDescriptor
        | undefined;
      if (!descriptor) {
        descriptor = {
          id: childId,
          creatorId: agent.id,
          reportTo: item.reportTo ?? agent.id,
          role: item.role,
          nested: item.nested ?? false,
          sourceDirectory: this.host.ctx.workingDirectory.get(agent.session),
          workspaceMode: item.workspace ?? "isolated",
          workspaceIncomplete: true,
          ...(seed ? { forkOperation: `moa:fork:${operationId}` } : {}),
        };
        await this.host.update(rootId, (r) => ({
          ...r,
          operations: {
            ...r.operations,
            [key]: JSON.parse(JSON.stringify(descriptor)),
          },
        }));
      }
      if (descriptor.workspaceIncomplete && descriptor.workspace) {
        await manager.destroy(descriptor.workspace, signal);
        descriptor = {
          ...descriptor,
          workspace: undefined,
          workspaceIncomplete: undefined,
        };
        await this.host.update(rootId, (r) => ({
          ...r,
          operations: {
            ...r.operations,
            [key]: JSON.parse(JSON.stringify(descriptor)),
          },
        }));
      }
      if (!descriptor.workspace) {
        if (descriptor.workspaceMode === "isolated") {
          const recovered = await manager.discoverOwned(
            descriptor.sourceDirectory,
            childId,
            signal,
          );
          for (const partial of recovered)
            await manager.destroy(partial, signal);
        }
        let workspace: MoAWorkspaceRecord;
        try {
          workspace = await manager.prepare({
            ownerId: childId,
            sourceDirectory: descriptor.sourceDirectory,
            mode: descriptor.workspaceMode,
            signal,
          });
        } catch (error) {
          await this.host.update(rootId, (r) => ({
            ...r,
            operations: {
              ...r.operations,
              [key]: JSON.parse(
                JSON.stringify(
                  error instanceof MoAWorkspacePrepareError
                    ? {
                        ...descriptor,
                        workspace: error.record,
                        workspaceIncomplete: true,
                      }
                    : { ...descriptor, workspaceIncomplete: undefined },
                ),
              ),
            },
          }));
          throw error;
        }
        descriptor = {
          ...descriptor,
          workspace,
          workspaceIncomplete: undefined,
        };
        await this.host.update(rootId, (r) => ({
          ...r,
          operations: {
            ...r.operations,
            [key]: JSON.parse(JSON.stringify(descriptor)),
          },
        }));
      }
      const identity = identityMessage({
        id: childId,
        workdir: descriptor.workspace!.directory,
        isolated: descriptor.workspace!.mode === "isolated",
        reportTo: descriptor.reportTo,
        reportingInstructions: workerReportingInstructions(contextIndexPath(record.project.paths), record.project.paths.notes, record.project.paths.archived),
      });
      try {
        const result = await this.workers.spawnMoA(
          agent,
          {
            name: item.name,
            task: item.task,
            childId,
            cwd: descriptor.workspace!.directory,
            identity,
            provider: seed ? "moa-fork" : "spawn",
          },
          `${operationId}:${i}`,
          signal,
        );
        if (!("workerId" in result))
          throw new Error("moa/invalid-task-receipt");
        results.push(result);
      } catch (error) {
        // Only a native pre-admission rejection proves the workspace was unused.
        if (
          this.host
            .record(rootId)
            ?.workers.some(
              (w) => w.id === childId && w.lifecycle === "provision-failed",
            )
        ) {
          try {
            await manager.destroy(
              descriptor.workspace!,
              new AbortController().signal,
            );
            await this.clearWorkspace(rootId, key);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "MoA admission failed and workspace cleanup remains pending",
            );
          }
        }
        throw error;
      }
    }
    return results;
  }
  async fork(
    agent: Agent,
    sourceId: SessionId,
    item: TaskInput,
    operationId: string,
    signal: AbortSignal,
  ) {
    const record = this.host.record(agent.id) ?? this.host.owner(agent.id);
    if (
      !record ||
      record.project.mode !== "enabled" ||
      this.host.ctx.agents.get(agent.id) !== agent
    )
      throw new Error("moa/not-member");
    if (
      sourceId !== record.project.coordinatorSessionId &&
      !record.workers.some((w) => w.id === sourceId && w.lifecycle === "active")
    )
      throw new Error("moa/not-member");
    const rootId = SessionId(record.project.coordinatorSessionId);
    const key = `moa:fork:${operationId}`;
    let stored = this.host.record(rootId)?.operations[key] as unknown as
      | { sourceId: string; watermark: number | null; seed?: SessionEvent[] }
      | undefined;
    if (!stored) {
      using observed = await observeForTurn(this.host.ctx, sourceId, signal);
      const last = observed.events.at(-1);
      stored = {
        sourceId,
        watermark: last?.seq ?? null,
        seed: last ? prepareForkSeed(observed.events, last.seq) : [],
      };
      await this.host.update(rootId, (r) => ({
        ...r,
        operations: {
          ...r.operations,
          [key]: JSON.parse(JSON.stringify(stored)),
        },
      }));
    }
    if (stored.sourceId !== sourceId)
      throw new Error("moa/fork-replay-mismatch");
    const seed = stored.seed;
    if (!seed) {
      const receipt = this.host.record(rootId)?.operations[`${operationId}:0`];
      if (receipt) return receipt;
      throw new Error("moa/fork-seed-unavailable");
    }
    const [result] = await this.task(agent, [item], operationId, signal, seed);
    return result;
  }
  private recoveryState(record: import("../state.ts").RecordState) {
    const descriptors = Object.entries(record.operations)
      .filter(([key]) => key.startsWith("moa:agent:"))
      .map(([, value]) => value as unknown as AgentDescriptor);
    const deleted = new Set(
      record.workers.filter((w) => w.lifecycle === "deleted").map((w) => w.id),
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const d of descriptors)
        if (deleted.has(d.creatorId) && !deleted.has(d.id)) {
          deleted.add(d.id);
          changed = true;
        }
    }
    return { descriptors, deleted };
  }
  needsRecovery(record: import("../state.ts").RecordState): boolean {
    const { descriptors, deleted } = this.recoveryState(record);
    return (
      record.workers.some(
        (w) =>
          w.lifecycle === "deleting" ||
          (deleted.has(w.id) && w.lifecycle !== "deleted"),
      ) ||
      descriptors.some((d) => {
        const worker = record.workers.find((w) => w.id === d.id);
        return (
          (!worker ||
            worker.lifecycle === "provision-failed" ||
            deleted.has(d.id)) &&
          !!(d.workspace || d.workspaceIncomplete)
        );
      })
    );
  }
  private clearWorkspace(rootId: SessionId, key: string) {
    return this.host.update(rootId, (r) => {
      const descriptor = r.operations[key];
      if (
        !descriptor ||
        typeof descriptor !== "object" ||
        Array.isArray(descriptor)
      )
        return r;
      const {
        workspace: _workspace,
        workspaceIncomplete: _preparing,
        ...facts
      } = descriptor;
      return { ...r, operations: { ...r.operations, [key]: facts } };
    });
  }
  /** Startup reconciliation cleans abandoned preparations and removed native families. */
  async recover(agent: Agent, signal: AbortSignal) {
    let record = this.host.record(agent.id) ?? this.host.owner(agent.id);
    if (!record || record.project.mode !== "enabled") return;
    const rootId = SessionId(record.project.coordinatorSessionId);
    const { descriptors, deleted } = this.recoveryState(record);
    if (
      record.workers.some(
        (w) => deleted.has(w.id) && w.lifecycle !== "deleted",
      ) ||
      record.deliveries.some(
        (d) =>
          deleted.has(d.targetId ?? rootId) &&
          d.state !== "consumed" &&
          d.state !== "suppressed",
      )
    ) {
      await this.host.update(rootId, (r) => ({
        ...r,
        workers: r.workers.map((w) =>
          deleted.has(w.id)
            ? {
                ...w,
                lifecycle: "deleted",
                deletedAt: w.deletedAt ?? Date.now(),
              }
            : w,
        ),
        deliveries: r.deliveries.map((d) =>
          deleted.has(d.targetId ?? rootId) && d.state !== "consumed"
            ? { ...d, state: "suppressed" }
            : d,
        ),
      }));
      record = this.host.record(rootId)!;
    }
    if (!descriptors.length) return;
    const manager = this.workspaceManager(agent);
    const activePreparations = new Set<string>();
    for (const key of this.tasks.keys()) {
      const [creator, operation] = JSON.parse(key);
      const owner =
        this.host.record(SessionId(creator)) ??
        this.host.owner(SessionId(creator));
      if (owner?.project.coordinatorSessionId === rootId)
        for (const id of (record.operations[`moa:task:${operation}`] as
          | string[]
          | undefined) ?? [])
          activePreparations.add(id);
    }
    for (const descriptor of descriptors) {
      if (activePreparations.has(descriptor.id)) continue;
      const worker = record.workers.find((w) => w.id === descriptor.id);
      if (
        worker &&
        worker.lifecycle !== "deleted" &&
        worker.lifecycle !== "provision-failed"
      )
        continue;
      if (descriptor.workspace)
        await manager.destroy(descriptor.workspace, signal);
      else if (
        descriptor.workspaceIncomplete &&
        descriptor.workspaceMode === "isolated"
      ) {
        for (const owned of await manager.discoverOwned(
          record.project.workspacePath,
          descriptor.id,
          signal,
        ))
          await manager.destroy(owned, signal);
      } else continue;
      await this.clearWorkspace(rootId, `moa:agent:${descriptor.id}`);
    }
  }
  async context(
    agent: Agent,
    input: ProjectContextInput,
    signal: AbortSignal,
  ) {
    return accessProjectContext(this.host, agent, input, signal);
  }
  async kill(
    agent: Agent,
    childId: SessionId,
    signal: AbortSignal,
    options: {
      destroy?: boolean;
      continueWith?: string;
      operationId?: string;
    } = {},
  ) {
    const record = this.host.record(agent.id) ?? this.host.owner(agent.id);
    if (
      !record ||
      record.project.mode !== "enabled" ||
      this.host.ctx.agents.get(agent.id) !== agent ||
      !record.workers.some((w) => w.id === childId && w.lifecycle !== "deleted")
    )
      throw new Error("moa/not-member");
    const direct = await this.host.ctx.subagents.listChildren(agent.id, signal);
    if (!direct.some((child) => child.id === childId))
      throw new Error("moa/not-direct-child");
    if (options.destroy && options.continueWith)
      throw new Error("moa/destroy-cannot-continue");
    signal.throwIfAborted();
    const rootId = SessionId(record.project.coordinatorSessionId);
    const child = this.host.ctx.agents.get(childId);
    this.host.notify();
    try {
      const stop = async (target: Agent) => {
        const { createUserMessage } = await import("@deepseek-ai/dsh-llm");
        const operationId = options.operationId ?? `kill:${randomUUID()}`;
        const alreadyAdmitted =
          target.session
            .snapshotEvents()
            .some(
              (e) =>
                e.type === "user/message" &&
                e.data.source.kind === "moa-message" &&
                e.data.source.operationId === operationId,
            ) ||
          [...target.inbox.nextStep, ...target.inbox.nextTurn].some(
            (m) =>
              m.source.kind === "moa-message" &&
              m.source.operationId === operationId,
          );
        if (alreadyAdmitted) return;
        const continuation = options.continueWith
          ? createUserMessage({
              source: {
                kind: "moa-message",
                form: "relay",
                rootId,
                senderId: agent.id,
                operationId,
              },
              content: [{ type: "text", text: options.continueWith }],
            })
          : undefined;
        const join = async () => {
          this.host.ctx.subagents.interrupt(childId, {
            kind: "ancestor",
            agent,
          });
          const joined = target.cancelAndJoin(
            { kind: "parent" },
            continuation ? { continuation } : undefined,
          );
          this.host.notify();
          await joined;
          return continuation?.id ?? "";
        };
        if (continuation && agent.id === rootId)
          await this.workers.controlForAgent(
            agent,
            {
              action: "send",
              worker_id: childId,
              delivery: "steer",
              message: options.continueWith!,
            },
            operationId,
            signal,
            join,
          );
        else await join();
      };
      if (child || options.continueWith)
        await withManagedAgent(this.host, childId, signal, stop);
      if (options.destroy) {
        await this.host.update(rootId, (r) => ({
          ...r,
          workers: r.workers.map((w) =>
            w.id === childId ? { ...w, lifecycle: "deleting" } : w,
          ),
        }));
        await this.host.ctx.subagents.drainChildren(agent, [childId]);
        await this.host.update(rootId, (r) => ({
          ...r,
          workers: r.workers.map((w) =>
            w.id === childId
              ? { ...w, lifecycle: "deleted", deletedAt: Date.now() }
              : w,
          ),
        }));
        await this.recover(agent, signal);
      }
      return {
        workerId: childId,
        accepted: true,
        lifecycle: options.destroy
          ? ("deleted" as const)
          : this.host.ctx.agents.get(childId)
            ? this.lifecycle(this.host.ctx.agents.get(childId)!)
            : ("Zombie" as const),
      };
    } finally {
      this.host.notify();
    }
  }
  async query(agent: Agent, input: QueryAgentsInput, signal: AbortSignal) {
    const record = this.host.record(agent.id) ?? this.host.owner(agent.id);
    if (
      !record ||
      record.project.mode !== "enabled" ||
      this.host.ctx.agents.get(agent.id) !== agent
    )
      throw new Error("moa/not-member");
    if (input.wait === "selected" && !input.ids?.length)
      throw new Error("moa/selection-required");
    if (
      input.history &&
      (!Number.isInteger(input.history.offset) ||
        input.history.offset < 0 ||
        !Number.isInteger(input.history.limit) ||
        input.history.limit < 0)
    )
      throw new Error("moa/invalid-history-window");
    if (input.wait) this.waiting.add(agent.id);
    const deadline = Date.now() + (input.timeoutMs ?? 30000);
    try {
      for (;;) {
        signal.throwIfAborted();
        let wake!: () => void;
        const changed = new Promise<void>((resolve) => {
          wake = resolve;
        });
        this.host.listeners.add(wake);
        try {
          const direct = await this.host.ctx.subagents.listChildren(
            agent.id,
            signal,
          );
          const ids = new Set(direct.map((child) => child.id));
          const current =
            this.host.record(SessionId(record.project.coordinatorSessionId)) ??
            record;
          const selected = current.workers.filter(
            (worker) =>
              ids.has(SessionId(worker.id)) &&
              worker.lifecycle !== "deleted" &&
              worker.lifecycle !== "provision-failed" &&
              (!input.ids || input.ids.includes(worker.id)),
          );
          if (
            input.ids &&
            input.ids.some((id) => !selected.some((worker) => worker.id === id))
          )
            throw new Error("moa/not-direct-child");
          const children = await Promise.all(
            selected.map(async (worker) => {
              const view = await this.host.inspect(worker, signal);
              const live = this.host.ctx.agents.get(SessionId(worker.id));
              return {
                ...view,
                lifecycleState: live
                  ? this.lifecycle(live)
                  : worker.lifecycle === "provisioning"
                    ? ("Idle" as const)
                    : ("Zombie" as const),
              };
            }),
          );
          const history = input.history
            ? await Promise.all(
                selected.map((worker) =>
                  this.host.readHistory(
                    SessionId(record.project.coordinatorSessionId),
                    SessionId(worker.id),
                    input.history!.offset,
                    input.history!.limit,
                    signal,
                  ),
                ),
              )
            : undefined;
          if (!input.wait) return { children, ...(history ? { history } : {}) };
          if (agent.inbox.nextStep.length)
            return { children, reason: "interrupted" as const };
          if (children.every((child) => child.status === "idle"))
            return { children, reason: "done" as const };
          const remaining = deadline - Date.now();
          if (remaining <= 0) return { children, reason: "timeout" as const };
          let timer: ReturnType<typeof setTimeout> | undefined;
          const abort = new AbortController();
          try {
            await Promise.race([
              changed,
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, remaining);
              }),
              new Promise<never>((_, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                  signal: abort.signal,
                }),
              ),
            ]);
          } finally {
            abort.abort();
            if (timer) clearTimeout(timer);
          }
        } finally {
          this.host.listeners.delete(wake);
        }
      }
    } finally {
      if (input.wait) this.waiting.delete(agent.id);
    }
  }
}
