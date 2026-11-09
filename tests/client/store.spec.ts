import { describe, it, expect, vi } from "vitest";
import { MoAStore } from "../../packages/moa/src/client/store.ts";
import { snapshot, sid } from "./fixture.ts";
describe("shared project store", () => {
  it.each(["live", "closed", "closing-gap"] as const)(
    "removes a deleted worker's %s capsule while preserving its peer and original facts",
    (kind) => {
      const store = new MoAStore(),
        s = snapshot();
      s.workers.push({ ...s.workers[0], workerId: sid("peer"), name: "Peer" });
      s.turnMemberships.push({
        ...s.turnMemberships[0],
        workerId: sid("peer"),
        order: 1,
      });
      if (kind === "closed")
        s.closedTurnOutcomes = s.workers.map((worker) => ({
          coordinatorSessionId: sid("parent"),
          coordinatorTurn: 3,
          workerId: worker.workerId,
          status: "completed",
          completionIds: [],
        }));
      store.accept(s);
      if (kind === "closing-gap") store.turn(sid("parent"), 3, false);
      const closed = kind !== "live";
      const previous = store.turn(sid("parent"), 3, closed);
      expect(previous.map((c) => c.workerId)).toEqual(["child", "peer"]);
      store.push({
        ...s,
        revision: 2,
        workers: s.workers.map((w) =>
          w.workerId === sid("child") ? { ...w, lifecycle: "deleted" } : w,
        ),
      });
      const next = store.turn(sid("parent"), 3, closed);
      expect(next.map((c) => c.workerId)).toEqual(["peer"]);
      expect(next[0]).toEqual(previous[1]);
      expect(store.get(sid("parent"))!.turnMemberships).toHaveLength(2);
      expect(store.get(sid("parent"))!.workers).toHaveLength(2);
      store.dispose();
    },
  );
  it("drops a cached closed capsule when the worker is absent from membership", () => {
    const store = new MoAStore(), s = snapshot();
    store.accept(s);
    expect(store.turn(sid("parent"), 3, false)).toHaveLength(1);
    expect(store.turn(sid("parent"), 3, true)).toHaveLength(1);
    store.accept({ ...s, revision: 2, workers: [] });
    expect(store.turn(sid("parent"), 3, true)).toEqual([]);
    store.dispose();
  });
  it("selects durable participation by human segment and keeps both historical instances of a reused worker", () => {
    const store = new MoAStore(),
      s = snapshot();
    const first = {
        ...s.turnMemberships[0],
        segmentStartSeq: 10,
        participationSeq: 14,
      },
      second = {
        ...first,
        segmentStartSeq: 20,
        participationSeq: 23,
        order: 1,
      };
    store.accept({ ...s, turnMemberships: [first, second] });
    expect(store.turn(sid("parent"), 3, false, 10).map((c) => c.key)).toEqual([
      "parent:3:10:child",
    ]);
    expect(store.turn(sid("parent"), 3, false, 20).map((c) => c.key)).toEqual([
      "parent:3:20:child",
    ]);
    expect(store.turn(sid("parent"), 3, false, 30)).toEqual([]);
    const outcome = {
      coordinatorSessionId: sid("parent"),
      coordinatorTurn: 3,
      workerId: sid("child"),
      status: "completed" as const,
      completionIds: ["r"],
    };
    store.accept({
      ...s,
      revision: 2,
      turnMemberships: [first, second],
      closedTurnOutcomes: [
        { ...outcome, segmentStartSeq: 10, summary: "first result" },
        { ...outcome, segmentStartSeq: 20, summary: "later result" },
      ],
    });
    expect(store.turn(sid("parent"), 3, true, 10)[0].text).toBe("first result");
    expect(store.turn(sid("parent"), 3, true, 20)[0].text).toBe("later result");
    const refreshed = new MoAStore();
    refreshed.accept(store.get(sid("parent"))!);
    expect(refreshed.turn(sid("parent"), 3, true, 10)).toEqual(
      store.turn(sid("parent"), 3, true, 10),
    );
  });
  it("accepts equal durable revision progress and full baseline gaps/epochs while rejecting old baselines", () => {
    const store = new MoAStore();
    const s = snapshot();
    store.accept(s);
    const old = store.turn(sid("parent"), 3, false);
    expect(old.map((c) => c.key)).toEqual(["parent:3:child"]);
    store.accept({
      ...s,
      workers: [{ ...s.workers[0], progressText: "Tool title", updatedAt: 2 }],
    });
    expect(store.turn(sid("parent"), 3, false)[0].text).toBe("Tool title");
    store.accept({ ...s, revision: 8, workers: [] });
    expect(store.get(sid("parent"))?.revision).toBe(8);
    store.accept(s);
    expect(store.get(sid("parent"))?.revision).toBe(8);
    store.accept({ ...s, streamEpoch: "b", revision: 0 });
    expect(store.get(sid("parent"))?.streamEpoch).toBe("b");
  });
  it("never falls back to live status when native closure beats the outcome frame, freezes old outcomes across reuse", () => {
    const store = new MoAStore();
    const s = snapshot();
    store.accept(s);
    expect(store.turn(sid("parent"), 3, true)).toEqual([]);
    const outcome = {
      coordinatorSessionId: sid("parent"),
      coordinatorTurn: 3,
      workerId: sid("child"),
      status: "completed" as const,
      completionIds: ["r"],
      summary: "Done",
    };
    store.accept({ ...s, revision: 2, closedTurnOutcomes: [outcome] });
    const closed = store.turn(sid("parent"), 3, true);
    expect(closed[0].status).toBe("completed");
    store.accept({
      ...s,
      revision: 3,
      closedTurnOutcomes: [outcome],
      workers: [{ ...s.workers[0], progressText: "Later run", updatedAt: 9 }],
    });
    expect(store.turn(sid("parent"), 3, true)).toBe(closed);
    expect(closed[0].text).toBe("Done");
  });
  it("structurally reuses unchanged workers and turn lists, throttles text only, flushes terminal changes", () => {
    vi.useFakeTimers();
    const store = new MoAStore(150);
    const s = snapshot();
    store.accept(s);
    const before = store.get(sid("parent"))!;
    const closed = store.turn(sid("parent"), 4, true);
    const notify = vi.fn();
    store.subscribe(notify);
    store.push({ ...s, workers: [{ ...s.workers[0], progressText: "chunk" }] });
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.turn(sid("parent"), 4, true)).toBe(closed);
    store.accept({ ...s, revision: 2 });
    expect(store.get(sid("parent"))?.turnMemberships).toBe(
      before.turnMemberships,
    );
    store.push({
      ...s,
      revision: 3,
      workers: [{ ...s.workers[0], phase: "failed" }],
    });
    expect(store.get(sid("parent"))?.workers[0].phase).toBe("failed");
    store.dispose();
    vi.useRealTimers();
  });
});
