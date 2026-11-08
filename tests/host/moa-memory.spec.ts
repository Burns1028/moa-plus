import { expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import { fixture } from "./fixture.ts";
import {
  MoAMemory,
  memoryPaths,
  notesInjection,
  identityMessage,
  contextIndexTemplate,
} from "../../packages/project-mode/src/host/moa/memory.ts";

it("preserves every note character and warns only above 8000 Unicode code points", () => {
  const exact = "🚀".repeat(8000);
  expect(notesInjection(exact)).toBe(exact);
  const over = exact + "\n末";
  const injected = notesInjection(over);
  expect(injected.startsWith(over)).toBe(true);
  expect(injected.slice(over.length)).toMatch(/clean|prune|archiv/i);
});

it("places identity facts and reporting instructions in history content", () => {
  const message = identityMessage({
    id: "worker-1",
    workdir: "/tmp/work",
    isolated: true,
    reportTo: "parent-1",
    reportingInstructions: "Report evidence and blockers.",
  });
  expect(message).toContain("worker-1");
  expect(message).toContain("/tmp/work");
  expect(message).toContain("Isolated");
  expect(message).toContain("parent-1");
  expect(message).toContain("Report evidence and blockers.");
  expect(
    identityMessage({
      id: "w",
      workdir: "/tmp",
      isolated: false,
      reportTo: "p",
      reportingInstructions: "done",
    }),
  ).toContain("Shared");
});

it("creates an index alongside legacy files through the acting agent filesystem without changing them", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("moa-memory"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const paths = memoryPaths(join(f.root, "legacy"));
    await mkdir(paths.context, { recursive: true });
    await writeFile(join(paths.context, "context.md"), "legacy\r\n正文\n");
    await writeFile(join(paths.context, "topic.md"), "topic body\n");
    await writeFile(paths.notes, "full notes\r\n");
    const { index: _index, ...legacyPaths } = paths;
    const memory = new MoAMemory(f.ctx, agent, {
      workspacePath: f.root,
      paths: legacyPaths,
    });
    const signal = new AbortController().signal;
    await memory.ensureContextIndex(signal);
    expect(await readFile(paths.index, "utf8")).toContain(contextIndexTemplate);
    expect(await readFile(paths.index, "utf8")).toContain("context.md");
    expect(await readFile(paths.index, "utf8")).toContain("topic.md");
    expect(await memory.readNotes(signal)).toBe("full notes\r\n");
    await writeFile(paths.index, "curated index\n");
    await memory.ensureContextIndex(signal);
    expect(await readFile(paths.index, "utf8")).toBe("curated index\n");
    expect(await readFile(join(paths.context, "context.md"), "utf8")).toBe(
      "legacy\r\n正文\n",
    );
    expect(await readFile(join(paths.context, "topic.md"), "utf8")).toBe(
      "topic body\n",
    );
  } finally {
    await f.dispose();
  }
});

it("rejects memory paths outside the acting workspace", async () => {
  const f = await fixture();
  try {
    const { agent } = await f.ctx.agents.create({
      sessionId: SessionId("moa-escape"),
      meta: { cwd: f.root },
      agentOptions: { provider: "test", model: "test" },
    });
    const memory = new MoAMemory(f.ctx, agent, {
      workspacePath: f.root,
      paths: memoryPaths(join(f.root, "..", "outside")),
    });
    await expect(
      memory.ensureContextIndex(new AbortController().signal),
    ).rejects.toThrow("project-mode/path-escape");
  } finally {
    await f.dispose();
  }
});
