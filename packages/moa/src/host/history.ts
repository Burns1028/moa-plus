import type { SessionId } from "@deepseek-ai/dsh-session";
import type { WorkerHistoryPage } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";

/** A relative window over committed dialogue, indexed from its newest message. */
export async function readHistory(
  host: HostAccess,
  parentId: SessionId,
  workerId: SessionId,
  offset: number,
  limit: number,
  signal: AbortSignal,
): Promise<WorkerHistoryPage> {
  const r = host.record(parentId);
  if (!r) throw new Error("project-mode/not-found");
  const worker = host.worker(r, workerId);
  if (worker.lifecycle === "deleted")
    throw new Error("project-mode/worker-inactive");
  using observed = await host.ctx.sessionQuery.observeSession(workerId, {
    signal,
  });
  let turn = 0;
  const messages: Omit<WorkerHistoryPage["messages"][number], "index">[] = [];
  for (const event of observed.events) {
    if (event.type === "turn/start") turn = event.data.turn;
    if (event.seq < observed.inheritedEventCount) continue;
    const message =
      event.type === "assistant/message"
        ? event.data.message
        : event.type === "user/message" &&
            (event.data.source.kind === "user" ||
              event.data.source.kind === "project-mode-assignment")
          ? event.data
          : undefined;
    if (!message) continue;
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    // Reasoning-only/tool-only assistant steps are not visible AI replies.
    if (message.role === "assistant" && !text) continue;
    messages.push({
      id: message.id,
      seq: event.seq,
      turn,
      role: message.role === "assistant" ? "assistant" : "user",
      text,
    });
  }
  return {
    workerId,
    status: (await host.view(worker, signal)).status,
    offset,
    limit,
    total: messages.length,
    messages: messages
      .reverse()
      .slice(offset, offset + limit)
      .map((message, i) => ({ ...message, index: offset + i })),
    observedThroughSeq: observed.cursor,
  };
}
