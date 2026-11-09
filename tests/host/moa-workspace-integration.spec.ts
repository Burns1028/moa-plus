import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionId } from "@deepseek-ai/dsh-session";
import { fixture, response } from "./fixture.ts";
import { MoAAgents } from "../../packages/project-mode/src/host/moa/agents.ts";

it.skipIf(process.platform !== "darwin")(
  "prepares nested isolated workspaces under actual project confinement and refuses an external common Git directory",
  async () => {
    const f = await fixture(undefined, { sandboxMode: "workspace-write" });
    const external = await mkdtemp(join(tmpdir(), "moa-foreign-"));
    const release = Promise.withResolvers<void>();
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
    try {
      for (const cwd of [f.root, external]) {
        git(cwd, "init");
        git(cwd, "config", "user.name", "Test");
        git(cwd, "config", "user.email", "test@example.com");
        await writeFile(join(cwd, "tracked.txt"), "original");
        git(cwd, "add", "tracked.txt");
        git(cwd, "commit", "-m", "initial");
      }
      const { default: SandboxPolicy } = await import(
        "@deepseek-ai/dsh-sandbox-policy"
      );
      const { default: SandboxLocal } = await import(
        "@deepseek-ai/dsh-sandbox-local"
      );
      const { default: Loader } = await import(
        "@deepseek-ai/cordis-plugin-loader"
      );
      const { default: Group } = await import(
        "@deepseek-ai/cordis-plugin-group"
      );
      const { default: Presets } = await import(
        "@deepseek-ai/dsh-agent-preset-registry"
      );
      await f.ctx.plugin(SandboxLocal);
      f.ctx.baseUrl = new URL("./", import.meta.url).href;
      await f.ctx.plugin(Loader);
      f.ctx.loader.builtins.group = Group;
      await f.ctx.plugin(Presets, { default: "confined" });
      await f.ctx.agentPresets.register({
        id: "confined",
        plugins: [
          {
            name: "cordis:group",
            group: true,
            isolate: { fs: true },
            config: [
              {
                name: new URL("./fixtures/sandbox-fs.mjs", import.meta.url)
                  .href,
                config: { cwd: f.root },
              },
            ],
          },
        ],
      });
      const { agent: root } = await f.ctx.agents.create({
        sessionId: SessionId("confined-root"),
        meta: { cwd: f.root },
        agentOptions: { provider: "test", model: "test" },
        setup: async (ctx) => {
          await f.ctx.agentPresets.mount(ctx);
        },
      });
      await f.ctx.projectMode.setEnabled(root.id, true, 0, "enable");
      f.adapter.handler = async (options) => {
        if (options.sessionId !== root.id) await release.promise;
        return response("done");
      };
      const controls: MoAAgents = (f.ctx.projectMode as any).moa;
      const [leader] = await controls.task(
        root,
        [
          {
            name: "leader",
            task: "work",
            role: "General-purpose",
            nested: true,
          },
        ],
        "leader",
        new AbortController().signal,
      );
      const leaderAgent = f.ctx.agents.get(SessionId(leader.workerId))!;
      const nativePolicy = f.ctx.sandboxPolicy.resolve({
        session: leaderAgent.session,
      });
      expect(nativePolicy.workspaceRoot).toBe(leaderAgent.session.header.cwd);
      const [child] = await controls.task(
        leaderAgent,
        [{ name: "nested", task: "work", role: "General-purpose" }],
        "nested",
        new AbortController().signal,
      );
      const nestedWorkspace = controls.descriptor(
        SessionId(child.workerId),
      )!.workspace!;
      expect(nestedWorkspace.mode).toBe("isolated");
      expect(
        await readFile(join(nestedWorkspace.directory, "tracked.txt"), "utf8"),
      ).toBe("original");
      // The control operation's project scope does not widen ordinary native execution.
      expect(
        f.ctx.sandboxPolicy.resolve({ session: leaderAgent.session }),
      ).toEqual(nativePolicy);
      const management = (controls as any).workspaceManager(root);
      const orphan = await management.prepare({
        ownerId: "crashed-child",
        sourceDirectory: leaderAgent.session.header.cwd,
        mode: "isolated",
        signal: new AbortController().signal,
      });
      await (f.ctx.projectMode as any).access.update(
        root.id,
        (record: any) => ({
          ...record,
          operations: {
            ...record.operations,
            "moa:agent:crashed-child": {
              id: "crashed-child",
              creatorId: leader.workerId,
              reportTo: leader.workerId,
              role: "General-purpose",
              nested: false,
              workspaceMode: "isolated",
              workspaceIncomplete: true,
              sourceDirectory: leaderAgent.session.header.cwd,
            },
          },
        }),
      );
      const linked = join(f.root, "external-worktree");
      git(external, "worktree", "add", linked);
      const before = git(external, "worktree", "list", "--porcelain");
      const manager = (controls as any).workspaceManager(root);
      await expect(
        manager.prepare({
          ownerId: "foreign",
          sourceDirectory: linked,
          mode: "isolated",
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("contained-git-root");
      expect(git(external, "worktree", "list", "--porcelain")).toBe(before);
      expect(await readFile(join(external, "tracked.txt"), "utf8")).toBe(
        "original",
      );
      const deleting = controls.kill(
        root,
        SessionId(leader.workerId),
        new AbortController().signal,
        { destroy: true },
      );
      release.resolve();
      await deleting;
      await expect(stat(nestedWorkspace.directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(orphan.directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        (f.ctx.projectMode as any).access
          .record(root.id)
          .workers.find((worker: any) => worker.id === child.workerId)
          .lifecycle,
      ).toBe("deleted");
      expect(
        controls.needsRecovery(
          (f.ctx.projectMode as any).access.record(root.id),
        ),
      ).toBe(false);
    } finally {
      release.resolve();
      await f.dispose();
      await rm(external, { recursive: true, force: true });
    }
  },
);
