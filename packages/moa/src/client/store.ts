import type { MoASnapshot, WorkerView } from "../shared/index.ts";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SubagentAddress } from "@deepseek-ai/dsh-subagent/client";

export interface WorkerCapsule {
  key: string;
  workerId: SessionId;
  name: string;
  status: WorkerView["phase"] | "completed" | "deleted";
  text?: string;
  queueLength: number | null;
  address: SubagentAddress;
}
const EMPTY: readonly WorkerCapsule[] = Object.freeze([]);
/** Reconcile JSON views without replacing unchanged rows or arrays. */
export function reuse<T>(before: T | undefined, after: T): T {
  if (Object.is(before, after)) return after;
  if (Array.isArray(before) && Array.isArray(after)) {
    const next = after.map((v, i) => reuse(before[i], v));
    return (
      before.length === next.length && next.every((v, i) => v === before[i])
        ? before
        : next
    ) as T;
  }
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>,
      next: Record<string, unknown> = {};
    let same = Object.keys(a).length === Object.keys(b).length;
    for (const k of Object.keys(b)) {
      next[k] = reuse(a[k], b[k]);
      same &&= next[k] === a[k];
    }
    return (same ? before : next) as T;
  }
  return after;
}
/** One derived MoA cache shared by every sidebar row and turn capsule. */
export class MoAStore {
  private values = new Map<SessionId, MoASnapshot>();
  private listeners = new Set<() => void>();
  private turns = new Map<string, readonly WorkerCapsule[]>();
  private pending = new Map<SessionId, MoASnapshot>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  constructor(private readonly throttle = 150) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get = (sessionId: SessionId) => this.values.get(sessionId);
  all = () => [...this.values.values()];
  accept(value: MoASnapshot) {
    if (this.stopped) return;
    const id = value.project.coordinatorSessionId,
      before = this.values.get(id);
    if (
      before?.streamEpoch === value.streamEpoch &&
      before.revision > value.revision
    )
      return;
    // Every frame is a complete baseline. Gaps and epoch changes require no
    // speculative delta fold; equal durable revisions can contain new live text.
    this.pending.delete(id);
    const next = reuse(before, value);
    if (next === before) return;
    this.values.set(id, next);
    for (const l of this.listeners) l();
  }
  push(value: MoASnapshot) {
    const before = this.values.get(value.project.coordinatorSessionId);
    const metadata = (s: MoASnapshot) => ({
      ...s,
      workers: s.workers.map(({ progressText, updatedAt, ...w }) => w),
    });
    if (
      !before ||
      JSON.stringify(metadata(before)) !== JSON.stringify(metadata(value))
    ) {
      this.pending.delete(value.project.coordinatorSessionId);
      this.accept(value);
      return;
    }
    this.pending.set(value.project.coordinatorSessionId, value);
    if (this.timer === undefined)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        const values = [...this.pending.values()];
        this.pending.clear();
        for (const v of values) this.accept(v);
      }, this.throttle);
  }
  turn(
    sessionId: SessionId,
    turn: number,
    closed: boolean,
    segmentStartSeq?: number,
  ): readonly WorkerCapsule[] {
    const project = this.values.get(sessionId);
    if (!project) return EMPTY;
    const cacheKey = `${sessionId}:${turn}:${closed}:${segmentStartSeq ?? "legacy"}`,
      before = this.turns.get(cacheKey);
    const published = closed
      ? this.turns.get(
          `${sessionId}:${turn}:false:${segmentStartSeq ?? "legacy"}`,
        )
      : undefined;
    const list = project.turnMemberships
      .filter(
        (m) =>
          m.coordinatorTurn === turn &&
          (segmentStartSeq === undefined ||
            m.segmentStartSeq === segmentStartSeq),
      )
      .sort((a, b) => a.order - b.order)
      .flatMap((m) => {
        const w = project.workers.find((w) => w.workerId === m.workerId);
        const outcome = project.closedTurnOutcomes.find(
          (o) =>
            o.coordinatorTurn === turn &&
            o.workerId === m.workerId &&
            o.segmentStartSeq === m.segmentStartSeq,
        );
        // Explicit deletion hides every seat, including frozen history and
        // the last published row retained while a turn outcome is in flight.
        if (!w || w.lifecycle === "deleted" || outcome?.status === "deleted")
          return [];
        // Session closure can arrive before the MoA's durable outcome.
        // Retain only this seat's last published row during that gap; never
        // derive historical text/status from a later live worker frame.
        if (closed && !outcome) {
          const retained = (before ?? published)?.find(
            (c) => c.workerId === m.workerId,
          );
          return retained ? [retained] : [];
        }
        return [
          {
            key: `${sessionId}:${turn}:${m.segmentStartSeq === undefined ? "" : `${m.segmentStartSeq}:`}${m.workerId}`,
            workerId: m.workerId,
            name: w?.name ?? m.workerId,
            status: closed ? outcome!.status : w!.phase,
            text: closed ? outcome!.summary : w!.progressText,
            queueLength: closed ? null : w!.queueLength,
            address: {
              parentSessionId: sessionId,
              childSessionId: m.workerId,
              mode: "continuable" as const,
            },
          },
        ];
      });
    const next = reuse(before, list.length ? list : EMPTY);
    this.turns.set(cacheKey, next);
    return next;
  }
  dispose() {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.pending.clear();
    this.listeners.clear();
    this.turns.clear();
    this.values.clear();
  }
}
