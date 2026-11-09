import { it, expect } from "vitest";
import {
  workerReadOnly,
  composerMatch,
} from "../../packages/moa/src/client/tree.ts";
import { MoAClient } from "../../packages/moa/src/client/runtime.ts";
import { snapshot, sid } from "./fixture.ts";
it("worker role uses parent mode rather than worker enabled=false; disabled/deleted are readonly", () => {
  const p = snapshot();
  expect(workerReadOnly([p], sid("child"))).toBeUndefined();
  p.project.mode = "disabled";
  expect(workerReadOnly([p], sid("child"))?.reason).toBe("disabled");
  p.project.mode = "enabled";
  p.workers[0].lifecycle = "deleted";
  expect(workerReadOnly([p], sid("child"))?.reason).toBe("deleted");
});
it("pending or unavailable native continuation ownership is readonly until mode and parent baseline resolve", () => {
  const client = new MoAClient({} as any);
  const owner = {
    sessionId: sid("child"),
    session: {
      subagent: {
        address: {
          parentSessionId: sid("parent"),
          childSessionId: sid("child"),
          mode: "continuable",
        },
      },
    },
  };
  expect(composerMatch(owner as any, client)?.reason).toBe("pending");
  client.store.accept(snapshot());
  expect(composerMatch(owner as any, client)).toBeNull();
  client.dispose();
});
