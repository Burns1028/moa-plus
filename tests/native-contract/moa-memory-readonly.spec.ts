import { expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { assembleContextFor } from "@deepseek-ai/dsh-agent";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import { SessionId } from "@deepseek-ai/dsh-session";
import Policy from "@deepseek-ai/dsh-sandbox-policy";
import SandboxedFS from "@deepseek-ai/dsh-fs-sandbox";
import Sandbox from "@deepseek-ai/dsh-sandbox-local";
import WorkingDirectory from "@deepseek-ai/dsh-working-directory";
import Subprocess from "@deepseek-ai/dsh-subprocess-local";
import Bash from "@deepseek-ai/dsh-bash-sandbox";
import Jobs from "@deepseek-ai/dsh-jobs-local";
import { SandboxProvider } from "@deepseek-ai/dsh-sandbox";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  link,
  realpath,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const signal = () => new AbortController().signal;
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
class LegacySandbox extends SandboxProvider {
  async confine(argv: readonly string[]) {
    return {
      argv: [...argv],
      enforcement: "full" as const,
      denialSignatures: [],
      runnerFailureRules: [],
    };
  }
}
async function setup(
  mode: "workspace-write" | "danger-full-access" = "workspace-write",
  sandboxPlugin: typeof Sandbox | typeof LegacySandbox = Sandbox,
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "moa-readonly-contract-")),
  );
  const ctx = new Context();
  await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(Policy, { mode });
  await ctx.plugin(SandboxedFS, { cwd: root });
  await ctx.plugin(WorkingDirectory);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(Jobs);
  await ctx.plugin(sandboxPlugin);
  await ctx.plugin(Subprocess);
  await ctx.plugin(Bash, { timeoutMs: 2000, maxTimeoutMs: 5000 });
  await ctx.plugin(await import("@deepseek-ai/dsh-shell-env"));
  await ctx.plugin(await import("@deepseek-ai/dsh-tool-bash"), {
    promoteOnTimeout: false,
  });
  await ctx.plugin(await import("@deepseek-ai/dsh-tool-fs"));
  const create = async (id: string) =>
    (await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: root } }))
      .agent;
  const worker = await create("worker");
  const coordinator = await create("coordinator");
  const notes = join(root, "legacy", "records", "notes.md"),
    archived = join(root, "legacy", "records", "archived.md");
  await mkdir(join(root, "legacy", "records"), { recursive: true });
  await writeFile(notes, "NOTES");
  await writeFile(archived, "ARCHIVED");
  let call = 0;
  const exec = (name: string, args: object, agent = worker) =>
    ctx.tools.execute({
      agent,
      name,
      arguments: args,
      callId: `readonly-${call++}` as any,
      signal: signal(),
    });
  return {
    ctx,
    root,
    worker,
    coordinator,
    notes,
    archived,
    exec,
    write: (path: string, content: string, agent = worker) =>
      exec("write", { file_path: path, content }, agent),
    bash: (command: string) =>
      exec("bash", {
        command,
        description: "Check native Worker record ownership",
        workdir: root,
        timeoutMs: 2000,
      }),
    protect: () =>
      ctx.sandboxPolicy.restrictReadOnly(worker.id, [notes, archived]),
    async dispose() {
      await ctx.fiber.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("composes session restrictions without changing mode or leaking disposers", async () => {
  const f = await setup("danger-full-access");
  try {
    const a = f.protect(),
      b = f.ctx.sandboxPolicy.restrictReadOnly(f.worker.id, [f.notes]);
    const snapshot = f.ctx.sandboxPolicy.resolve({ session: f.worker.session });
    expect(snapshot).toMatchObject({
      mode: "danger-full-access",
      readOnlyPaths: [f.notes, f.archived],
    });
    const assembly = await f.ctx.systemPrompt.assemble(
      assembleContextFor(f.worker, signal()),
    );
    const rendered = assembly.contexts.find(
      (item) => item.name === "sandbox:policy",
    )!.text;
    expect(rendered).toContain(f.notes);
    expect(rendered).toContain(f.archived);
    expect(rendered).toContain("read-only");
    expect(rendered).not.toContain("does not restrict file modifications");
    expect(
      f.ctx.sandboxPolicy.resolve({
        session: f.worker.session,
        mode: "workspace-write",
      }).readOnlyPaths,
    ).toEqual([f.notes, f.archived]);
    expect(
      f.ctx.sandboxPolicy.resolve({ session: f.coordinator.session })
        .readOnlyPaths,
    ).toBeUndefined();
    a();
    a();
    expect(
      f.ctx.sandboxPolicy.resolve({ session: f.worker.session }).readOnlyPaths,
    ).toEqual([f.notes]);
    b();
    expect(
      f.ctx.sandboxPolicy.resolve({ session: f.worker.session }).readOnlyPaths,
    ).toBeUndefined();
    const target = await f.ctx.fs.resolve(f.notes);
    await expect(
      f.ctx.fs.writeText(target, "bad", undefined, signal(), snapshot),
    ).rejects.toMatchObject({ code: "FS_READ_ONLY_PATH" });
    expect((await f.write(f.notes, "released")).isError).toBe(false);
  } finally {
    await f.dispose();
  }
});

it("rejects a legacy process provider that cannot enforce readonly paths before spawn", async () => {
  const f = await setup("danger-full-access", LegacySandbox);
  try {
    f.protect();
    const result = await f.bash(`printf bad > ${quote(f.notes)}`);
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "READ_ONLY_PATH_UNSUPPORTED" } },
    });
    expect(await readFile(f.notes, "utf8")).toBe("NOTES");
  } finally {
    await f.dispose();
  }
});

it.each(["workspace-write", "danger-full-access"] as const)(
  "stock filesystem preserves actual records and legitimate writes under %s",
  async (mode) => {
    const f = await setup(mode);
    try {
      const off = f.protect();
      for (const path of [f.notes, f.archived]) {
        expect(await f.write(path, "bad")).toMatchObject({
          isError: true,
          error: { info: { code: "FS_READ_ONLY_PATH" } },
        });
        expect(
          await f.exec("edit", {
            file_path: path,
            old_string: path === f.notes ? "NOTES" : "ARCHIVED",
            new_string: "bad",
          }),
        ).toMatchObject({ isError: true });
      }
      const alias = join(f.root, "notes-alias.md");
      await symlink(f.notes, alias);
      expect((await f.write(alias, "bad")).isError).toBe(true);
      const missing = join(f.root, "absent-record.md");
      const absentOff = f.ctx.sandboxPolicy.restrictReadOnly(f.worker.id, [
        missing,
      ]);
      expect((await f.write(missing, "bad")).isError).toBe(true);
      absentOff();
      expect(
        (await f.write(join(f.root, "own", "notes.md"), "own work")).isError,
      ).toBe(false);
      expect(
        (await f.write(join(f.root, "context", "fact.md"), "knowledge"))
          .isError,
      ).toBe(false);
      expect(
        (await f.write(f.notes, "Coordinator update", f.coordinator)).isError,
      ).toBe(false);
      expect(await readFile(f.archived, "utf8")).toBe("ARCHIVED");
      off();
      expect((await f.write(f.notes, "ordinary after release")).isError).toBe(
        false,
      );
    } finally {
      await f.dispose();
    }
  },
);

it
  .skipIf(!["darwin", "linux"].includes(process.platform))
  .each(["workspace-write", "danger-full-access"] as const)(
  "stock Bash denies record and ancestor mutations while sibling writes work under %s",
  async (mode) => {
    const f = await setup(mode);
    try {
      f.protect();
      const sibling = join(f.root, "normal.txt");
      await writeFile(sibling, "normal");
      const alias = join(f.root, "alias.md");
      await symlink(f.notes, alias);
      for (const command of [
        `printf bad > ${quote(f.notes)}`,
        `printf bad >> ${quote(f.archived)}`,
        `printf bad > ${quote(alias)}`,
        `mv ${quote(sibling)} ${quote(f.notes)}`,
        `mv ${quote(f.archived)} ${quote(f.archived + ".moved")}`,
        `rm ${quote(f.notes)}`,
        `ln ${quote(f.notes)} ${quote(join(f.root, "new-hardlink"))}`,
        `mv ${quote(join(f.root, "legacy"))} ${quote(join(f.root, "renamed"))}`,
        `rm -rf ${quote(join(f.root, "legacy"))}`,
      ]) {
        const result = await f.bash(command);
        expect(result.isError, JSON.stringify(result)).toBe(false);
        expect((result.value as any).exitCode, command).not.toBe(0);
        if ((result.value as any).sandbox?.denied)
          expect(JSON.stringify(result.content)).toContain(
            "Session read-only paths remain protected after escalation.",
          );
        expect(await readFile(f.notes, "utf8")).toBe("NOTES");
        expect(await readFile(f.archived, "utf8")).toBe("ARCHIVED");
      }
      const good = await f.bash(
        `printf good > ${quote(sibling)} && mv ${quote(sibling)} ${quote(sibling + ".moved")} && rm ${quote(sibling + ".moved")}`,
      );
      expect((good.value as any).exitCode, JSON.stringify(good)).toBe(0);
      expect(
        (await f.write(f.notes, "Coordinator update", f.coordinator)).isError,
      ).toBe(false);
    } finally {
      await f.dispose();
    }
  },
);

it.skipIf(!["darwin", "linux"].includes(process.platform))(
  "rejects an existing hardlink before a restricted Bash command starts",
  async () => {
    const f = await setup("danger-full-access");
    try {
      f.protect();
      await link(f.notes, join(f.root, "existing-hardlink"));
      const marker = join(f.root, "should-not-run");
      expect(await f.bash(`touch ${quote(marker)}`)).toMatchObject({
        isError: true,
        error: { info: { code: "READ_ONLY_PATH_UNSUPPORTED" } },
      });
      await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(f.notes, "utf8")).toBe("NOTES");
    } finally {
      await f.dispose();
    }
  },
);

it.each(["landlock", "windows-acl"] as const)(
  "refuses unsupported %s restriction policies instead of dropping them",
  async (runner) => {
    const f = await setup();
    try {
      f.ctx.sandbox.internals = {
        platform: runner === "landlock" ? "linux" : "win32",
        chain: [runner],
        probeLandlock: () => "full",
      };
      f.protect();
      const marker = join(f.root, "should-not-run");
      expect(await f.bash(`touch ${quote(marker)}`)).toMatchObject({
        isError: true,
        error: { info: { code: "READ_ONLY_PATH_UNSUPPORTED" } },
      });
      await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await f.dispose();
    }
  },
);

it.skipIf(!["darwin", "linux"].includes(process.platform))(
  "keeps a missing record protected without silently skipping a bind",
  async () => {
    const f = await setup("danger-full-access");
    try {
      f.protect();
      await rm(f.notes);
      const result = await f.bash(`printf bad > ${quote(f.notes)}`);
      if (process.platform === "linux")
        expect(result).toMatchObject({
          isError: true,
          error: { info: { code: "READ_ONLY_PATH_UNSUPPORTED" } },
        });
      else expect((result.value as any).exitCode).not.toBe(0);
      await expect(stat(f.notes)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await f.dispose();
    }
  },
);

it.skipIf(!["darwin", "linux"].includes(process.platform))(
  "protects external shared records without widening an Isolated Worker's workspace or host temp",
  async () => {
    const f = await setup("workspace-write");
    const externalTemp = await realpath(
      await mkdtemp(join(tmpdir(), "moa-unrelated-temp-")),
    );
    try {
      const isolated = join(f.root, "isolated");
      await mkdir(isolated);
      const { agent } = await f.ctx.agents.create({
        sessionId: SessionId("isolated-native"),
        meta: { cwd: isolated },
      });
      f.ctx.sandboxPolicy.restrictReadOnly(agent.id, [f.notes, f.archived]);
      const bash = (command: string) =>
        f.exec(
          "bash",
          {
            command,
            description:
              "Check external shared records from isolated workspace",
            workdir: isolated,
            timeoutMs: 2000,
          },
          agent,
        );
      for (const command of [
        `printf bad > ${quote(f.notes)}`,
        `mv ${quote(join(f.root, "legacy"))} ${quote(join(f.root, "renamed"))}`,
      ]) {
        const result = await bash(command);
        expect((result.value as any).exitCode, JSON.stringify(result)).not.toBe(
          0,
        );
      }
      const own = join(isolated, "own.txt");
      const good = await bash(
        `printf good > ${quote(own)} && mv ${quote(own)} ${quote(own + ".moved")} && rm ${quote(own + ".moved")}`,
      );
      expect((good.value as any).exitCode, JSON.stringify(good)).toBe(0);
      expect(await readFile(f.notes, "utf8")).toBe("NOTES");
      if (process.platform === "linux") {
        const hostFile = join(externalTemp, "host.txt");
        await writeFile(hostFile, "host original");
        const temp = await bash(
          `mkdir -p ${quote(externalTemp)} && printf ephemeral > ${quote(hostFile)}`,
        );
        expect((temp.value as any).exitCode, JSON.stringify(temp)).toBe(0);
        expect(await readFile(hostFile, "utf8")).toBe("host original");
      }
    } finally {
      await f.dispose();
      await rm(externalTemp, { recursive: true, force: true });
    }
  },
);
