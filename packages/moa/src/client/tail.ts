import type { ConversationNodeDefinition } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  ChatNode,
  ChatSnapshot,
} from "@deepseek-ai/dsh-client-ui-chat/client";
import type { TurnWorkerMembership } from "../shared/index.ts";

declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "project-mode-workers-tail": {
      turn: number;
      step: number;
      segmentStartSeq: number;
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
}> = {
  kind: "project-mode-workers-tail",
  target: "chat",
  match(event) {
    if (
      event.type === "user/message" &&
      (event.data.source as { kind: string }).kind === "project-mode-result"
    )
      return { id: `result:${event.data.id}`, role: "start" };
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
      (match) => match?.location.kind === "step",
    )?.location;
    if (location?.kind !== "step" || !context.state) {
      const previous = context.current.get("chat") as
        | ChatNode<"project-mode-workers-tail">
        | null
        | undefined;
      return previous ? { ...previous, visibility: "hidden" } : null;
    }
    const node: ChatNode<"project-mode-workers-tail"> = {
      key: context.key,
      id: context.id,
      kind: "project-mode-workers-tail",
      target: "chat",
      anchorSeq: context.state.seq + 0.2,
      location: { kind: "turn", turn: location.turn },
      visibility: "visible",
      groupTree: "turn",
      data: {
        turn: location.turn.turn,
        step: location.step.step,
        segmentStartSeq: context.state.segmentStartSeq,
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
  if (node.visibility !== "visible") return null;
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
