import { it, expect, vi } from "vitest";
import { MoAClient } from "../../packages/moa/src/client/runtime.ts";
import { snapshot, sid } from "./fixture.ts";
const ok = (value: unknown) => ({ ok: true, value });
it("owns one follow per root across consumers, restarts generations, and disposes streams on unload", async () => {
  const dispose = vi.fn();
  const follow = vi.fn(() => ({
    dispose,
    async *[Symbol.asyncIterator]() {
      yield { type: "baseline", value: snapshot() };
      await new Promise(() => {});
    },
  }));
  const remote = {
    catalog: vi.fn(async () => ok([snapshot()])),
    follow,
    mode: vi.fn(async () =>
      ok({
        sessionId: sid("parent"),
        role: "coordinator",
        enabled: true,
        revision: 1,
        canToggle: true,
      }),
    ),
    setEnabled: vi.fn(),
    snapshot: vi.fn(),
  };
  const client = new MoAClient(remote as any);
  client.watchRoots([sid("parent")]);
  client.watchRoots([sid("parent")]);
  await Promise.resolve();
  expect(follow).toHaveBeenCalledTimes(1);
  client.reconnect();
  await Promise.resolve();
  expect(follow).toHaveBeenCalledTimes(2);
  expect(dispose).toHaveBeenCalledTimes(1);
  client.dispose();
  expect(dispose).toHaveBeenCalledTimes(2);
});
it("toggle uses Host revision and response as authority, reports refusal without local optimism", async () => {
  let finish: (v: unknown) => void = () => {};
  const setEnabled = vi.fn(() => new Promise((r) => (finish = r)));
  const remote = {
    catalog: vi.fn(),
    follow: vi.fn(),
    mode: vi.fn(async () =>
      ok({
        sessionId: sid("parent"),
        role: "ordinary",
        enabled: false,
        revision: 7,
        canToggle: true,
      }),
    ),
    setEnabled,
  };
  const client = new MoAClient(remote as any);
  await client.refreshMode(sid("parent"));
  const pending = client.toggle(sid("parent"), true);
  expect(client.mode(sid("parent")).value?.enabled).toBe(false);
  expect(client.mode(sid("parent")).busy).toBe(true);
  expect(setEnabled.mock.calls[0].slice(0, 3)).toEqual(["parent", true, 7]);
  finish({
    ok: false,
    error: { code: "project/busy", message: "Workers active" },
  });
  await pending;
  expect(client.mode(sid("parent")).error).toContain("Workers active");
  expect(client.mode(sid("parent")).value?.enabled).toBe(false);
  client.dispose();
});
it("late catalog cannot roll a newer follow baseline back to another stream epoch", async () => {
  let finish: (v: unknown) => void = () => {};
  const s = snapshot();
  const remote = {
    catalog: () => new Promise((r) => (finish = r)),
    follow: () => ({
      dispose() {},
      async *[Symbol.asyncIterator]() {
        yield { type: "baseline", value: { ...s, streamEpoch: "new" } };
        await new Promise(() => {});
      },
    }),
  };
  const client = new MoAClient(remote as any);
  const pending = client.loadCatalog();
  client.watchRoots([sid("parent")]);
  await Promise.resolve();
  await Promise.resolve();
  finish({ ok: true, value: [s] });
  await pending;
  expect(client.store.get(sid("parent"))?.streamEpoch).toBe("new");
  client.dispose();
});
function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
it("accepts only the latest catalog request even when an older epoch resolves last", async () => {
  const a = deferred(),
    b = deferred();
  const remote = {
    catalog: vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise),
  };
  const client = new MoAClient(remote as any);
  const first = client.loadCatalog(),
    second = client.loadCatalog();
  b.resolve(ok([{ ...snapshot(), streamEpoch: "new", revision: 10 }]));
  await second;
  a.resolve(ok([{ ...snapshot(), streamEpoch: "old" }]));
  await first;
  expect(client.store.get(sid("parent"))?.streamEpoch).toBe("new");
  client.dispose();
});
it.each(["throw", "domain"] as const)(
  "ignores stale catalog %s failures after a successful reconnect",
  async (kind) => {
    const a = deferred(),
      b = deferred();
    const client = new MoAClient({
      catalog: vi
        .fn()
        .mockReturnValueOnce(a.promise)
        .mockReturnValueOnce(b.promise),
    } as any);
    const first = client.loadCatalog();
    client.reconnect();
    b.resolve(ok([snapshot()]));
    await Promise.resolve();
    await Promise.resolve();
    if (kind === "throw") a.reject(new Error("old connection failed"));
    else a.resolve({ ok: false, error: { message: "old failure" } });
    await first;
    expect(client.catalogState).toBe("ready");
    expect(client.error).toBeUndefined();
    client.dispose();
  },
);
it("refreshes Host revision after refusal, preserves the action error and waits for the next explicit toggle", async () => {
  let revision = 1;
  const mode = () =>
    ok({
      sessionId: sid("parent"),
      role: "ordinary",
      enabled: false,
      revision,
      canToggle: true,
    });
  const setEnabled = vi.fn(async (_s, _enabled, expected) =>
    expected !== revision
      ? { ok: false, error: { message: "Revision changed" } }
      : ok({ ...(mode().value as object), enabled: true }),
  );
  const client = new MoAClient({
    mode: vi.fn(async () => mode()),
    setEnabled,
    catalog: async () => ok([]),
  } as any);
  await client.refreshMode(sid("parent"));
  revision = 2;
  await client.toggle(sid("parent"), true);
  expect(client.mode(sid("parent")).value?.revision).toBe(2);
  expect(client.mode(sid("parent")).error).toBe("Revision changed");
  expect(setEnabled).toHaveBeenCalledTimes(1);
  await client.toggle(sid("parent"), true);
  expect(setEnabled.mock.calls.map((c) => c[2])).toEqual([1, 2]);
  client.dispose();
});
it.each(["throw", "domain"] as const)(
  "ignores superseded same-generation catalog %s errors",
  async (kind) => {
    const a = deferred(),
      b = deferred(),
      client = new MoAClient({
        catalog: vi
          .fn()
          .mockReturnValueOnce(a.promise)
          .mockReturnValueOnce(b.promise),
      } as any);
    const first = client.loadCatalog(),
      second = client.loadCatalog();
    b.resolve(ok([snapshot()]));
    await second;
    if (kind === "throw") a.reject(new Error("superseded"));
    else a.resolve({ ok: false, error: { message: "superseded" } });
    await first;
    expect(client.catalogState).toBe("ready");
    expect(client.error).toBeUndefined();
    client.dispose();
  },
);
