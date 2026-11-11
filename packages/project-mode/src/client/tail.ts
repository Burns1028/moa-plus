import type { ConversationNodeDefinition } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  ChatNode,
  ChatSnapshot,
} from "@deepseek-ai/dsh-client-ui-chat/client";
import type { TurnWorkerMembership } from "../shared/index.ts";
import type { UserMessage } from "@deepseek-ai/dsh-llm/types";

export interface IncomingAgentMessage {
  source: UserMessage["source"];
  content: UserMessage["content"];
}

function incoming(event: Parameters<typeof humanBoundaryDefinition.match>[0]): IncomingAgentMessage | undefined {
  if (event.type !== "user/message" || event.surfaceOp !== "append") return;
  const source = event.data.source as unknown as Record<string, unknown>;
  if (
    source.kind === "moa-message" ||
    source.kind === "project-mode-result" ||
    source.kind === "project-mode-assignment"
  ) return { source: event.data.source, content: event.data.content };
}

declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "project-mode-workers-tail": {
      turn: number;
      step: number;
      segmentStartSeq: number;
      incoming?: IncomingAgentMessage;
      openingInput?: boolean;
    };
  }
}

/** Human inputs split transcript placement without changing the native turn. */
export const humanBoundaryDefinition: ConversationNodeDefinition<{
  seq: number;
}> = {
  kind: "project-mode-human-boundary",
  match: (event) =>
    event.type === "turn/start" ||
    (event.type === "user/message" &&
      event.data.source.kind === "user" &&
      event.surfaceOp === "append")
      ? { id: String(event.seq), role: "start" }
      : null,
  start: (_context, match) => ({ seq: match.event.seq }),
  update: (context) => context.state,
  publication: () => "none",
};

/**
 * A native step owns its own tail seat. Later steps never move an earlier seat
 * across a human message. Empty seats are hidden by native Chat layout.
 */
export const workerTailDefinition: ConversationNodeDefinition<{
  seq: number;
  segmentStartSeq: number;
  incoming?: IncomingAgentMessage;
}> = {
  kind: "project-mode-workers-tail",
  target: "chat",
  match(event) {
    if (event.type === "user/message" && incoming(event))
      return {
        id: `${(event.data.source as { kind: string }).kind === "project-mode-result" ? "result" : "message"}:${event.data.id}`,
        role: "start",
        exclusive: true,
      };
    if (
      event.type !== "assistant/live-chunk" &&
      event.type !== "assistant/message" &&
      event.type !== "tool/call" &&
      event.type !== "tool/result"
    )
      return null;
    if (
      !("turn" in event.data) ||
      !("step" in event.data) ||
      typeof event.data.turn !== "number" ||
      typeof event.data.step !== "number"
    )
      return null;
    return {
      id: `${event.data.turn}:${event.data.step}`,
      // Input is admitted after step/start. Initialize at actual step output so
      // the backward reader includes that step's human input.
      role: "start",
    };
  },
  start: (_context, match, reader) => ({
    seq: match.event.seq,
    ...(incoming(match.event) ? { incoming: incoming(match.event) } : {}),
    segmentStartSeq:
      reader.previous<{ seq: number }>(humanBoundaryDefinition.kind)?.state
        .seq ??
      (match.location.kind === "turn" || match.location.kind === "step"
        ? match.location.turn.start?.seq
        : undefined) ??
      0,
  }),
  update: (context, match) => ({
    ...context.state,
    seq: Math.max(context.state.seq, match.event.seq),
  }),
  publication: (match) =>
    match.event.type === "assistant/live-chunk"
      ? "animation-frame"
      : "immediate",
  buildViewNode(context) {
    const location = [context.start, ...context.matches].find(
      (match) => match?.location.kind === "step" ||
        (context.state?.incoming && match?.location.kind === "turn"),
    )?.location;
    if (!context.state || (location?.kind !== "step" && !context.state.incoming)) {
      const previous = context.current.get("chat") as
        | ChatNode<"project-mode-workers-tail">
        | null
        | undefined;
      return previous ? { ...previous, visibility: "hidden" } : null;
    }
    // Native messages may be admitted between steps. Retain that explicit
    // Turn owner without assigning them to an earlier or later Step.
    const turn = location?.kind === "step" || location?.kind === "turn"
      ? location.turn : undefined;
    const source = context.state.incoming?.source as unknown as
      | Record<string, unknown>
      | undefined;
    const process = turn?.data.get("turn-process");
    // A Coordinator's initial task is the Worker's question, not execution
    // traffic. Use the same control boundary as native opening-input layout:
    // processStartSeq can move back to turn/start when an answer is finalized.
    const openingInput = Boolean(
      source &&
      (source.kind === "project-mode-assignment" ||
        (source.kind === "moa-message" && typeof source.senderId === "string" &&
          source.senderId !== "" && source.senderId === source.rootId)) &&
      location?.kind === "step" && location.step.step === 1 && turn?.start &&
      (!process || process.controlAnchorSeq === turn.start.seq ||
        context.state.seq + 0.2 < process.controlAnchorSeq),
    );
    const node: ChatNode<"project-mode-workers-tail"> = {
      key: context.key,
      id: context.id,
      kind: "project-mode-workers-tail",
      target: "chat",
      anchorSeq: context.state.seq + 0.2,
      location: turn
        ? { kind: "turn", turn }
        : context.start?.location ?? { kind: "unresolved" },
      visibility: "visible",
      // Only the opening task belongs to input. Later correspondence remains
      // process; interleaved input would keep the completed turn expanded.
      groupTree: context.state.incoming ? openingInput ? "input" : "process" : "turn",
      data: {
        turn: turn?.turn ?? 0,
        step: location?.kind === "step" ? location.step.step : 0,
        segmentStartSeq: context.state.segmentStartSeq,
        ...(context.state.incoming ? { incoming: context.state.incoming } : {}),
        ...(openingInput ? { openingInput: true } : {}),
      },
    };
    return node;
  },
};

/** Pick exactly one native seat at the bottom of each human transcript segment. */
export function segmentTail(
  snapshot: ChatSnapshot,
  node: ChatNode<"project-mode-workers-tail">,
) {
  if (node.visibility !== "visible" || node.data.turn === 0) return null;
  const { turn, segmentStartSeq } = node.data;
  const last = snapshot.nodes
    .values()
    .filter(
      (candidate): candidate is ChatNode<"project-mode-workers-tail"> =>
        candidate.kind === "project-mode-workers-tail" &&
        candidate.visibility === "visible" &&
        (candidate as ChatNode<"project-mode-workers-tail">).data.turn ===
          turn &&
        (candidate as ChatNode<"project-mode-workers-tail">).data
          .segmentStartSeq === segmentStartSeq,
    )
    .reduce<ChatNode<"project-mode-workers-tail"> | undefined>(
      (latest, candidate) =>
        !latest || candidate.anchorSeq > latest.anchorSeq ? candidate : latest,
      undefined,
    );
  return last?.key === node.key
    ? {
        turn,
        segmentStartSeq,
        closed: snapshot.timeline.turns.get(turn)?.end !== undefined,
      }
    : null;
}

/**
 * An unknown history prefix is never a wildcard segment. Load the canonical
 * boundary and every intervening native event before deciding placement: an
 * unloaded passive human message may separate the seat from an older worker.
 */
export function segmentHistoryTarget(
  snapshot: ChatSnapshot,
  node: ChatNode<"project-mode-workers-tail">,
  memberships: readonly TurnWorkerMembership[],
): number | undefined {
  if (node.data.segmentStartSeq !== 0 || !segmentTail(snapshot, node))
    return undefined;
  const boundaries = memberships.flatMap((membership) =>
    membership.coordinatorTurn === node.data.turn &&
    membership.segmentStartSeq !== undefined &&
    membership.segmentStartSeq > 0 &&
    membership.participationSeq !== undefined &&
    membership.participationSeq <= node.anchorSeq
      ? [membership.segmentStartSeq]
      : [],
  );
  return boundaries.length ? Math.min(...boundaries) : undefined;
}
