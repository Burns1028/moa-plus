import { isVisibleWorker } from "../shared/worker-membership.ts";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId, type SessionEvent } from "@deepseek-ai/dsh-session";
import { randomUUID } from "node:crypto";
import { resolve, relative, isAbsolute } from "node:path";
import type { SessionModeView } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
import { recordSchema, type RecordState } from "./state.ts";
import { ordinarySessionResolver, resolveOrdinaryAgent } from "./native.ts";
import { contextIndexPath, contextIndexTemplate } from "./moa-memory.ts";

export function hasOwnTurn(
  events: readonly SessionEvent[],
  inheritedEventCount: number,
) {
  return events.some(
    (event) => event.type === "turn/start" && event.seq >= inheritedEventCount,
  );
}

interface LifecycleOptions {
  put(id: SessionId, record: RecordState): Promise<void>;
  attach(agent: Agent): void;
  recover(id: SessionId): Promise<void>;
}
/** Owns MoA identity and draft enable/disable through native Agent maintenance. */
export class MoALifecycle {
  constructor(
    private host: HostAccess,
    private options: LifecycleOptions,
  ) {}
  mode(sessionId: SessionId): SessionModeView {
    const worker = this.host.owner(sessionId),
      r = this.host.record(sessionId),
      agent = this.host.ctx.agents.get(sessionId);
    const modeLocked = this.modeLocked(r, agent);
    const blocked = worker
      ? "worker-session"
      : modeLocked
        ? "session-mode-locked"
        : !agent && !ordinarySessionResolver(this.host.ctx)
          ? "runtime-unavailable"
          : agent?.status === "running"
            ? "agent-running"
            : undefined;
    return {
      sessionId,
      role: worker ? "worker" : r ? "coordinator" : "ordinary",
      enabled: r?.project.mode === "enabled",
      modeLocked,
      revision: r?.project.revision ?? 0,
      canToggle: !blocked,
      ...(blocked ? { toggleBlockedReason: blocked } : {}),
      ...(r ? { projectId: r.project.id, paths: r.project.paths } : {}),
      ...(worker
        ? {
            projectId: worker.project.id,
            coordinatorSessionId: SessionId(
              worker.project.coordinatorSessionId,
            ),
          }
        : {}),
    };
  }
  private modeLocked(r: RecordState | undefined, agent?: Agent): boolean {
    return (
      r?.project.mode === "enabled" &&
      // Treat an unmigrated enabled record as fixed until recovery proves it
      // is a draft. Live history closes the gap before turn/start is persisted.
      (r.project.modeLocked !== false ||
        (!!agent &&
          hasOwnTurn(
            agent.session.snapshotEvents(),
            agent.session.inheritedEventCount,
          )))
    );
  }
  async setEnabled(
    sessionId: SessionId,
    enabled: boolean,
    expectedRevision: number,
    requestId: string,
  ): Promise<SessionModeView> {
    if (!requestId) throw new Error("requestId required");
    const old = this.host.record(sessionId);
    if (old?.toggles[requestId] !== undefined) return this.mode(sessionId);
    if (this.host.owner(sessionId))
      throw new Error("project-mode/worker-session");
    if (!enabled && this.modeLocked(old, this.host.ctx.agents.get(sessionId)))
      throw new Error("project-mode/session-mode-locked");
    if ((old?.project.revision ?? 0) !== expectedRevision)
      throw new Error("project-mode/revision-conflict");
    const agent = await resolveOrdinaryAgent(this.host.ctx, sessionId);
    if (!agent) throw new Error("project-mode/runtime-unavailable");
    if (this.host.owner(sessionId))
      throw new Error("project-mode/worker-session");
    if (!enabled && this.modeLocked(this.host.record(sessionId), agent))
      throw new Error("project-mode/session-mode-locked");
    if (agent.status !== "idle") throw new Error("project-mode/agent-running");
    await agent.runMaintenance(async (signal) => {
      let r = this.host.record(sessionId);
      if (!enabled && this.modeLocked(r, agent))
        throw new Error("project-mode/session-mode-locked");
      if ((r?.project.revision ?? 0) !== expectedRevision)
        throw new Error("project-mode/revision-conflict");
      if (!enabled && r) await this.requireCanDisable(r);
      if (!r) {
        if (!enabled) return;
        r = await this.createRecord(agent, signal);
      }
      r = {
        ...r,
        project: {
          ...r.project,
          mode: enabled ? "enabled" : "disabled",
          modeLocked:
            r.project.modeLocked === true ||
            (enabled &&
              hasOwnTurn(
                agent.session.snapshotEvents(),
                agent.session.inheritedEventCount,
              )),
          revision: r.project.revision + 1,
          updatedAt: Date.now(),
        },
        toggles: { ...r.toggles, [requestId]: r.project.revision + 1 },
      };
      await this.options.put(sessionId, recordSchema.parse(r));
      this.options.attach(agent);
      if (this.host.record(agent.id))
        this.host.enqueue(() => this.options.recover(agent.id));
      this.host.notify();
    });
    return this.mode(sessionId);
  }

  private async requireCanDisable(r: RecordState): Promise<void> {
    if (
      r.deliveries.some(
        (d) => d.state !== "consumed" && d.state !== "suppressed",
      )
    )
      throw new Error("project-mode/results-pending");
    const views = await Promise.all(
      r.workers.filter(isVisibleWorker).map((w) => this.host.view(w)),
    );
    if (
      views.some(
        (v) => v.status !== "idle" || v.queueLength || v.pendingSteerCount,
      ) ||
      r.assignments.some(
        (a) => a.admission === "prepared" || a.admission === "unknown",
      )
    )
      throw new Error("project-mode/workers-active");
  }

  private async createRecord(
    agent: Agent,
    signal: AbortSignal,
  ): Promise<RecordState> {
    const sessionId = agent.id;
    const cwd = await this.host.ctx.workingDirectory.ensure(agent, signal),
      id = randomUUID(),
      base = this.host.config.dataDirectory;
    if (isAbsolute(base) || relative(".", base).split(/[\\/]/).includes(".."))
      throw new Error("project-mode/invalid-directory");
    const root = resolve(cwd, base, id),
      paths = {
        root,
        context: resolve(root, "context"),
        notes: resolve(root, "notes.md"),
        archived: resolve(root, "archived.md"),
      };
    const presets = this.host.ctx.get("agentPresets");
    const fs = presets?.serviceFor(agent, "fs") ?? agent.ctx.get("fs");
    if (!fs) throw new Error("project-mode/filesystem-unavailable");
    const cwdTarget = await fs.resolve(cwd);
    const policy = (
      presets?.serviceFor(agent, "sandboxPolicy") ??
      agent.ctx.get("sandboxPolicy")
    )?.resolve({ session: agent.session });
    if (fs.sandboxMode && !policy)
      throw new Error("project-mode/missing-filesystem-policy");
    for (const [path, content] of [
      [paths.notes, "# Active tasks\n"],
      [paths.archived, "# Archived tasks\n"],
      [contextIndexPath(paths), contextIndexTemplate],
    ] as const) {
      const target = await fs.resolve(path, { cwd, signal });
      if (!fs.contains(cwdTarget, target))
        throw new Error("project-mode/path-escape");
      if ((await fs.stat(target, signal)) === undefined)
        await fs.writeText(
          target,
          content,
          { kind: "createIfAbsent" },
          signal,
          policy,
        );
    }
    const now = Date.now();
    return {
      project: {
        version: 1,
        id,
        coordinatorSessionId: sessionId,
        workspacePath: cwd,
        paths,
        mode: "disabled",
        modeLocked: false,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
      workers: [],
      assignments: [],
      completions: [],
      deliveries: [],
      memberships: [],
      outcomes: [],
      operations: {},
      toggles: {},
      reminders: {},
    };
  }
}
