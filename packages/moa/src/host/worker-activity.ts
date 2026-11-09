import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import type { WorkerActivity, WorkerInputView } from "../shared/index.ts";
import type { HostAccess } from "./host-access.ts";
import { SessionId } from "@deepseek-ai/dsh-session";
import { observeForTurn } from "./native.ts";
import { messageSchema } from "./state.ts";

/** Read native committed messages and the native Inbox; no shadow task queue. */
export async function readWorkerActivity(
  host: HostAccess,
  workerId: SessionId,
  signal?: AbortSignal,
  previewChars = host.config.progressTextMaxChars,
): Promise<WorkerActivity> {
  signal?.throwIfAborted();
  const coordinatorInputs = new Set(
    host
      .owner(workerId)
      ?.assignments.filter((a) => a.workerId === workerId)
      .flatMap((a) => (a.messageId ? [a.messageId] : [])),
  );
  const agent = host.ctx.agents.get(workerId);
  if (agent)
    return summarize(
      agent.session.snapshotEvents(),
      agent.session.inheritedEventCount,
      agent.inbox.nextStep,
      agent.inbox.nextTurn,
      coordinatorInputs,
      previewChars,
    );
  using observed = await observeForTurn(host.ctx, workerId, signal);
  const inbox = observed.projections?.values.inbox;
  if (!inbox) throw new Error("project-mode/worker-inbox-unavailable");
  return summarize(
    observed.events,
    observed.inheritedEventCount,
    inbox["next-step"].map((value) => messageSchema.parse(value)),
    inbox["next-turn"].map((value) => messageSchema.parse(value)),
    coordinatorInputs,
    previewChars,
  );
}

function summarize(
  events: readonly SessionEvent[],
  inherited: number,
  nextStep: readonly UserMessage[],
  nextTurn: readonly UserMessage[],
  coordinatorInputs: ReadonlySet<string>,
  previewChars: number,
): WorkerActivity {
  const admissions = new Map<string, { seq: number; time: number }>();
  const committed: WorkerInputView[] = [];
  const actor = (
    message: UserMessage,
  ): WorkerInputView["actor"] | undefined => {
    if (
      coordinatorInputs.has(message.id) ||
      message.source.kind === "project-mode-assignment"
    )
      return "coordinator";
    // Native spawn uses a user-kind message too; its accepted message ID
    // proves coordinator ownership before falling back to human input.
    if (message.source.kind === "user") return "user";
    if ("form" in message.source && message.source.form === "relay")
      return "other";
  };
  const input = (
    message: UserMessage,
    state: WorkerInputView["state"],
    position: { seq: number; time: number },
  ): WorkerInputView | undefined => {
    const by = actor(message);
    if (!by) return;
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return {
      messageId: message.id,
      actor: by,
      text: text.slice(0, previewChars),
      truncated: text.length > previewChars,
      state,
      ...position,
    };
  };
  for (const event of events) {
    if (event.seq < inherited) continue;
    if (event.type === "agent/inbox/spliced")
      for (const message of event.data.inserted)
        admissions.set(message.id, { seq: event.seq, time: event.time });
    if (event.type === "user/message") {
      const value = input(
        event.data,
        "committed",
        admissions.get(event.data.id) ?? { seq: event.seq, time: event.time },
      );
      if (value) committed.push(value);
    }
  }
  const pending: WorkerInputView[] = [];
  for (const [messages, state] of [
    [nextStep, "pending-steer"],
    [nextTurn, "pending-queue"],
  ] as const)
    for (const message of messages) {
      const position = admissions.get(message.id);
      if (!position)
        throw new Error("project-mode/worker-admission-unavailable");
      const value = input(message, state, position);
      if (value?.actor === "user") pending.push(value);
    }
  pending.sort((a, b) => a.seq - b.seq);
  const users = [
    ...committed.filter((m) => m.actor === "user"),
    ...pending,
  ].sort((a, b) => a.seq - b.seq);
  return {
    observedThroughSeq: events.at(-1)?.seq ?? -1,
    ...(committed.length ? { latestInput: committed.at(-1)! } : {}),
    ...(users.length ? { lastUserInput: users.at(-1)! } : {}),
    pendingUserInputs: pending.slice(-3),
    pendingUserInputCount: pending.length,
  };
}
