import type {} from "@deepseek-ai/dsh-tool-present/types";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { isAbsolute } from "node:path";
import type {
  WorkerTimelinePage,
  WorkerTimelineTurn,
} from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
import { abortableChange } from "./native.ts";
import { messageContent } from "./message-content.ts";
import { contextIndexPath } from "./project-memory.ts";
import {
  identityMessage,
  workerReportingInstructions,
} from "./prompts/identity.ts";
import type { RecordState, Worker } from "./state.ts";

/** Only the accepted birth message can carry the identity authored by spawnMoA. */
function birthIdentity(record: RecordState, worker: Worker) {
  const assignment = record.assignments.find(
    (value) =>
      value.workerId === worker.id &&
      value.operationId === worker.creationOperationId &&
      value.participationKind !== "send" &&
      value.messageId,
  );
  if (!assignment?.messageId) return undefined;
  const descriptor = record.operations[`moa:agent:${worker.id}`];
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor) ||
    descriptor.id !== worker.id ||
    typeof descriptor.reportTo !== "string"
  )
    return undefined;
  const workspace = descriptor.workspace;
  if (
    !workspace ||
    typeof workspace !== "object" ||
    Array.isArray(workspace) ||
    workspace.ownerId !== worker.id ||
    (workspace.mode !== "shared" && workspace.mode !== "isolated") ||
    typeof workspace.directory !== "string" ||
    !isAbsolute(workspace.directory)
  )
    return undefined;
  const paths = record.project.paths;
  return {
    messageId: assignment.messageId,
    prefix: `${identityMessage({
      id: worker.id,
      workdir: workspace.directory,
      isolated: workspace.mode === "isolated",
      reportTo: descriptor.reportTo,
      reportingInstructions: workerReportingInstructions(
        contextIndexPath(paths),
        paths.notes,
        paths.archived,
      ),
    })}\n\n`,
  };
}

/** Project only exactly verified wrappers; durable dialogue text stays intact. */
function displayText(
  message: UserMessage,
  birth: ReturnType<typeof birthIdentity>,
): string | undefined {
  const source = message.source;
  const first = message.content[0];
  if (first?.type !== "text") return undefined;
  let prefix: string;
  if (source.kind === "moa-message" && typeof source.senderId === "string")
    prefix = `${source.requestId ? `Request ID: ${source.requestId}\n` : ""}${source.replyTo ? `Reply to: ${source.replyTo}\n` : ""}From: ${source.senderId}\n`;
  else if (
    (source.kind === "user" || source.kind === "project-mode-assignment") &&
    birth?.messageId === message.id
  )
    prefix = birth.prefix;
  else return undefined;
  if (!first.text.startsWith(prefix)) return undefined;
  return [
    first.text.slice(prefix.length),
    ...message.content
      .slice(1)
      .flatMap((block) => (block.type === "text" ? [block.text] : [])),
  ].join("");
}

export async function readWorkerTimeline(
  host: HostAccess,
  parentId: SessionId,
  workerId: SessionId,
  limit: number,
  signal: AbortSignal,
): Promise<WorkerTimelinePage> {
  const record = host.record(parentId);
  if (!record) throw new Error("project-mode/not-found");
  const worker = host.worker(record, workerId);
  if (worker.lifecycle === "deleted")
    throw new Error("project-mode/worker-inactive");
  using observed = await host.ctx.sessionQuery.observeSession(workerId, {
    signal,
  });
  const assignments = new Set(
    record.assignments
      .filter((a) => a.workerId === workerId)
      .map((a) => a.messageId),
  );
  const birth = birthIdentity(record, worker);
  const turns: WorkerTimelineTurn[] = [];
  let current: WorkerTimelineTurn | undefined;
  for (const event of observed.events) {
    if (event.seq < observed.inheritedEventCount) continue;
    if (event.type === "turn/start") {
      current = {
        turn: event.data.turn,
        startedAt: event.time,
        outcome: null,
        inputs: [],
        outputs: [],
        artifacts: [],
      };
      turns.push(current);
    }
    if (!current) continue;
    if (event.type === "turn/end" && event.data.turn === current.turn) {
      current.outcome = event.data.reason.kind;
      current.finishedAt = event.time;
    }
    if (
      event.type === "user/message" &&
      (event.data.source.kind === "user" ||
        event.data.source.kind === "project-mode-assignment" ||
        event.data.source.kind === "moa-message")
    ) {
      const presentation = displayText(event.data, birth);
      current.inputs.push({
        id: event.data.id,
        seq: event.seq,
        time: event.time,
        ...messageContent(host.ctx, event.data.content),
        ...(presentation === undefined ? {} : { displayText: presentation }),
        actor:
          event.data.source.kind === "moa-message"
            ? event.data.source.senderId === record.project.coordinatorSessionId
              ? "coordinator"
              : "agent"
            : assignments.has(event.data.id) ||
                event.data.source.kind === "project-mode-assignment"
              ? "coordinator"
              : "user",
      });
    }
    if (
      event.type === "assistant/message" &&
      event.data.turn === current.turn
    ) {
      const content = messageContent(host.ctx, event.data.message.content);
      current.outputs =
        content.text || content.attachments?.length
          ? [
              {
                id: event.data.message.id,
                seq: event.seq,
                time: event.time,
                ...content,
              },
            ]
          : [];
    }
    if (
      event.type === "deliverables/presented" &&
      event.data.turn === current.turn
    ) {
      for (const file of event.data.files)
        current.artifacts.push({
          ...file,
          kind: "presented",
          seq: event.seq,
          time: event.time,
        });
    }
    if (
      event.type === "tool/result" &&
      !event.data.message.isError &&
      event.data.turn === current.turn
    ) {
      const meta = event.data.meta;
      // Durable successful file-tool metadata; call arguments alone prove no mutation.
      if (
        meta &&
        typeof meta === "object" &&
        !Array.isArray(meta) &&
        Array.isArray(meta.diffs)
      ) {
        const paths = new Set<string>();
        if (typeof meta.path === "string") paths.add(meta.path);
        for (const diff of meta.diffs)
          if (
            diff &&
            typeof diff === "object" &&
            !Array.isArray(diff) &&
            typeof diff.path === "string"
          )
            paths.add(diff.path);
        for (const path of paths)
          current.artifacts.push({
            path,
            kind: "changed",
            seq: event.seq,
            time: event.time,
          });
      }
    }
  }
  for (const turn of turns) {
    if (turn.outcome === null) turn.outputs = [];
    const files = new Map<string, (typeof turn.artifacts)[number]>();
    for (const artifact of turn.artifacts) {
      const previous = files.get(artifact.path);
      if (!previous || previous.kind !== "presented")
        files.set(artifact.path, artifact);
    }
    turn.artifacts = [...files.values()];
  }
  return {
    workerId,
    cwd: observed.header.cwd,
    status: (await host.view(worker, signal)).status,
    total: turns.length,
    hasMore: turns.length > limit,
    observedThroughSeq: observed.cursor,
    turns: turns.reverse().slice(0, limit),
  };
}

/** A UI-only native-event subscription. It never resumes or prompts an Agent. */
export async function* followWorkerTimeline(
  host: HostAccess,
  parentId: SessionId,
  workerId: SessionId,
  limit: number,
  signal: AbortSignal,
): AsyncIterable<WorkerTimelinePage> {
  const control = AbortSignal.any([signal, host.closing.signal]);
  const listeners = new Set<() => void>();
  const off = host.ctx.on("session/event", (session) => {
    if (session.id === workerId) for (const changed of listeners) changed();
  });
  try {
    while (!control.aborted) {
      const iteration = new AbortController();
      const next = abortableChange(
        listeners,
        AbortSignal.any([control, iteration.signal]),
      );
      void next.catch(() => {});
      try {
        yield await readWorkerTimeline(
          host,
          parentId,
          workerId,
          limit,
          control,
        );
        await next;
      } catch (error) {
        if (control.aborted) return;
        throw error;
      } finally {
        iteration.abort();
      }
    }
  } finally {
    off();
  }
}
