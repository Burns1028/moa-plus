import { it, expect } from "vitest";
import {
  workerReadOnly,
  composerMatch,
} from "../../packages/project-mode/src/client/tree.ts";
import { ProjectClient } from "../../packages/project-mode/src/client/runtime.ts";
import { snapshot, sid } from "./fixture.ts";

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
} as any;

it("leaves unknown continuations to the native composer while lookup loads or fails", async () => {
  const client = new ProjectClient({
    mode: async () => {
      throw new Error("mode failed");
    },
    catalog: async () => {
      throw new Error("catalog failed");
    },
  } as any);
  expect(composerMatch(owner, client)).toBeNull();
  await client.refreshMode(sid("child"));
  await client.loadCatalog();
  expect(composerMatch(owner, client)).toBeNull();
  client.dispose();
});

it("keeps active cold workers native and blocks known deleted or disabled workers", () => {
  const client = new ProjectClient({} as any);
  const p = snapshot();
  p.workers[0].availability = "cold";
  client.store.accept(p);
  expect(composerMatch(owner, client)).toBeNull();
  const disabled = snapshot();
  disabled.project.mode = "disabled";
  client.store.accept(disabled);
  expect(composerMatch(owner, client)?.reason).toBe("disabled");
  const deleted = snapshot();
  deleted.workers[0].lifecycle = "deleted";
  client.store.accept(deleted);
  expect(composerMatch(owner, client)?.reason).toBe("deleted");
  expect(workerReadOnly([deleted], sid("child"))?.reason).toBe("deleted");
  client.dispose();
});

it("blocks a known worker removed from its available parent project", async () => {
  const client = new ProjectClient({
    mode: async () => ({
      ok: true,
      value: {
        sessionId: sid("child"),
        role: "worker",
        enabled: false,
        revision: 0,
        canToggle: false,
        coordinatorSessionId: sid("parent"),
      },
    }),
  } as any);
  await client.refreshMode(sid("child"));
  expect(composerMatch(owner, client)).toBeNull();
  const p = snapshot();
  p.workers = [];
  client.store.accept(p);
  expect(composerMatch(owner, client)?.reason).toBe("deleted");
  client.dispose();
});
