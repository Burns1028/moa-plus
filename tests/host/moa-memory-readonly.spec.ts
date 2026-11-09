import { expect, it } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fixture, response } from "./fixture.ts";
import { withManagedAgent } from "../../packages/project-mode/src/host/moa/residency.ts";
import { bindWorkerMemoryPolicy } from "../../packages/project-mode/src/host/moa/worker-memory-policy.ts";

it.each(["shared", "isolated"] as const)(
  "restricts the actual shared records for a %s Worker while other writes and Context remain usable",
  async (workspace) => {
    const f = await fixture();
    const signal = new AbortController().signal;
    try {
      if (workspace === "isolated") {
        for (const args of [
          ["init"],
          ["config", "user.name", "Test"],
          ["config", "user.email", "test@example.com"],
        ])
          execFileSync("git", args, { cwd: f.root, stdio: "pipe" });
        await writeFile(join(f.root, "tracked.txt"), "original");
        execFileSync("git", ["add", "tracked.txt"], { cwd: f.root });
        execFileSync("git", ["commit", "-m", "fixture"], {
          cwd: f.root,
          stdio: "pipe",
        });
      }
      await f.ctx.plugin(await import("@deepseek-ai/dsh-tool-fs"));
      if (["darwin", "linux"].includes(process.platform)) {
        await f.ctx.plugin(
          (await import("@deepseek-ai/dsh-sandbox-local")).default,
        );
        await f.ctx.plugin(
          (await import("@deepseek-ai/dsh-subprocess-local")).default,
        );
        await f.ctx.plugin(
          (await import("@deepseek-ai/dsh-bash-sandbox")).default,
        );
        await f.ctx.plugin(await import("@deepseek-ai/dsh-shell-env"));
        await f.ctx.plugin(await import("@deepseek-ai/dsh-tool-bash"), {
          promoteOnTimeout: false,
        });
      }
      const { agent: parent } = await f.ctx.agents.create({
        sessionId: SessionId("readonly-owner"),
        meta: { cwd: f.root },
        agentOptions: { provider: "test", model: "test" },
      });
      const mode = await f.ctx.projectMode.setEnabled(
        parent.id,
        true,
        0,
        "enable",
      );
      const paths = mode.paths!;
      const [receipt] = await (f.ctx.projectMode as any).moa.task(
        parent,
        [
          {
            name: "executor",
            task: "work",
            role: "General-purpose",
            workspace,
            nested: workspace === "shared",
          },
        ],
        "worker",
        signal,
      );
      let n = 0;
      await expect
        .poll(() => f.ctx.agents.get(SessionId(receipt.workerId)))
        .toBeUndefined();
      const exec = (agent: any, name: string, args: object) =>
        f.ctx.tools.execute({
          agent,
          name,
          arguments: args,
          callId: `memory-${n++}` as any,
          signal,
        });
      await withManagedAgent(
        (f.ctx.projectMode as any).access,
        SessionId(receipt.workerId),
        signal,
        async (worker) => {
          expect(
            await exec(worker, "write", {
              file_path: paths.notes,
              content: "bad",
            }),
          ).toMatchObject({
            isError: true,
            error: { info: { code: "FS_READ_ONLY_PATH" } },
          });
          expect(
            (
              await exec(worker, "write", {
                file_path: paths.archived,
                content: "bad",
              })
            ).isError,
          ).toBe(true);
          if (["darwin", "linux"].includes(process.platform)) {
            const bash = await exec(worker, "bash", {
              command: `printf bad > '${paths.notes}'`,
              description: "Check actual Worker record protection",
              timeoutMs: 2000,
            });
            expect((bash.value as any).exitCode, JSON.stringify(bash)).not.toBe(
              0,
            );
          }
          const own = join(
            f.ctx.workingDirectory.get(worker.session),
            workspace === "isolated" ? "notes.md" : "own/notes.md",
          );
          const ownWrite = await exec(worker, "write", {
            file_path: own,
            content: "own output",
          });
          expect(
            ownWrite.isError,
            JSON.stringify({ own, paths, result: ownWrite }),
          ).toBe(false);
          expect(
            await (f.ctx.projectMode as any).moa.context(
              worker,
              {
                action: "write",
                path: "confirmed.md",
                content: "reusable knowledge",
              },
              signal,
            ),
          ).toMatchObject({ operation: "create" });
          expect(
            (
              await exec(parent, "write", {
                file_path: paths.notes,
                content: "Coordinator update",
              })
            ).isError,
          ).toBe(false);
          expect(await readFile(paths.notes, "utf8")).toBe(
            "Coordinator update",
          );
          if (workspace === "shared") {
            const [leaf] = await (f.ctx.projectMode as any).moa.task(
              worker,
              [
                {
                  name: "leaf",
                  task: "work",
                  role: "General-purpose",
                  workspace: "shared",
                },
              ],
              "nested-leaf",
              signal,
            );
            await expect
              .poll(() => f.ctx.agents.get(SessionId(leaf.workerId)))
              .toBeUndefined();
            await withManagedAgent(
              (f.ctx.projectMode as any).access,
              SessionId(leaf.workerId),
              signal,
              async (child) => {
                expect(
                  (
                    await exec(child, "write", {
                      file_path: paths.notes,
                      content: "nested bad",
                    })
                  ).isError,
                ).toBe(true);
              },
            );
          }
        },
      );
      const { agent: ordinary } = await f.ctx.agents.create({
        sessionId: SessionId("ordinary"),
        meta: { cwd: f.root },
      });
      expect(
        (
          await exec(ordinary, "write", {
            file_path: paths.notes,
            content: "ordinary session",
          })
        ).isError,
      ).toBe(false);
      await f.plugin.dispose();
      expect(
        (
          await exec(ordinary, "write", {
            file_path: paths.notes,
            content: "after unload",
          })
        ).isError,
      ).toBe(false);
    } finally {
      await f.dispose();
    }
  },
);

it("reuses unchanged native bindings and replaces path contributions without leaking the old one", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("binding-owner"),
      meta: { cwd: f.root },
    });
    const paths = {
      notes: join(f.root, "notes.md"),
      archived: join(f.root, "archived.md"),
    };
    const first = bindWorkerMemoryPolicy(f.ctx, agent, paths);
    const unchanged = bindWorkerMemoryPolicy(f.ctx, agent, paths, first);
    expect(unchanged === first).toBe(true);
    const changed = { ...paths, notes: join(f.root, "new-notes.md") };
    const second = bindWorkerMemoryPolicy(f.ctx, agent, changed, first);
    expect(
      f.ctx.sandboxPolicy.resolve({ session: agent.session }).readOnlyPaths,
    ).toEqual([changed.notes, changed.archived]);
    first.dispose();
    expect(
      f.ctx.sandboxPolicy.resolve({ session: agent.session }).readOnlyPaths,
    ).toEqual([changed.notes, changed.archived]);
    second.dispose();
    expect(
      f.ctx.sandboxPolicy.resolve({ session: agent.session }).readOnlyPaths,
    ).toBeUndefined();
  } finally {
    await f.dispose();
  }
});

it("keeps Worker restrictions until background cancellation cleanup actually joins", async () => {
  const f = await fixture(undefined, { backgroundAfterSeconds: 0.01 });
  const started = Promise.withResolvers<any>(),
    cleanup = Promise.withResolvers<void>();
  try {
    const { agent: parent } = await f.ctx.agents.create({
      sessionId: SessionId("readonly-background-owner"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const mode = await f.ctx.projectMode.setEnabled(
      parent.id,
      true,
      0,
      "enable",
    );
    f.ctx.tools.register({
      name: "held",
      description: "hold native cleanup",
      parameters: { type: "object" },
      output: {
        schema: { type: "string" },
        render: (_a, value) => [{ type: "text", text: value }],
      },
      async execute(_args, exec) {
        started.resolve(exec.agent);
        await new Promise<void>((resolve) =>
          exec.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
        await cleanup.promise;
        expect(
          f.ctx.sandboxPolicy.resolve({ session: exec.agent!.session })
            .readOnlyPaths,
        ).toContain(mode.paths!.notes);
        return "joined";
      },
    });
    let workerRequests = 0;
    f.adapter.handler = (options) => {
      if (options.sessionId === parent.id || workerRequests++)
        return response("done");
      return [
        { type: "block-start", index: 0, blockType: "tool-call" },
        {
          type: "tool-call-delta",
          index: 0,
          id: "held",
          name: "held",
          argumentsDelta: "{}",
        },
        {
          type: "block-end",
          index: 0,
          block: {
            type: "tool-call",
            id: "held",
            name: "held",
            arguments: "{}",
          },
        },
        { type: "finish", reason: { kind: "tool-calls" } },
      ];
    };
    await (f.ctx.projectMode as any).moa.task(
      parent,
      [
        {
          name: "worker",
          task: "work",
          role: "General-purpose",
          workspace: "shared",
        },
      ],
      "held-worker",
      new AbortController().signal,
    );
    const worker = await started.promise;
    expect(
      f.ctx.sandboxPolicy.resolve({ session: worker.session }).readOnlyPaths,
    ).toContain(mode.paths!.notes);
    let disposed = false;
    const unloading = f.plugin.dispose().then(() => {
      disposed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(disposed).toBe(false);
    expect(
      f.ctx.sandboxPolicy.resolve({ session: worker.session }).readOnlyPaths,
    ).toContain(mode.paths!.notes);
    cleanup.resolve();
    await unloading;
    expect(
      f.ctx.sandboxPolicy.resolve({ session: worker.session }).readOnlyPaths,
    ).toBeUndefined();
  } finally {
    cleanup.resolve();
    await f.dispose();
  }
});
