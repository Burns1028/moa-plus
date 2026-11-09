import type { MoASnapshot } from "../../packages/moa/src/shared/index.ts";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
export const sid = (s: string) => s as SessionId;
export const snapshot = (): MoASnapshot => ({
  project: {
    version: 1,
    id: "p",
    coordinatorSessionId: sid("parent"),
    workspacePath: "/p",
    paths: {
      root: "/p",
      context: "/p/context",
      notes: "/p/notes",
      archived: "/p/archived",
    },
    mode: "enabled",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  streamEpoch: "a",
  revision: 1,
  coordinatorTurn: null,
  workers: [
    {
      workerId: sid("child"),
      name: "Builder",
      lifecycle: "active",
      status: "busy",
      availability: "live",
      queueLength: 0,
      pendingSteerCount: 0,
      phase: "working",
      progressText: "Public text",
      updatedAt: 1,
    },
  ],
  turnMemberships: [
    {
      projectId: "p",
      coordinatorSessionId: sid("parent"),
      coordinatorTurn: 3,
      workerId: sid("child"),
      firstOperationId: "o",
      firstCallId: "c",
      order: 0,
    },
  ],
  closedTurnOutcomes: [],
});
