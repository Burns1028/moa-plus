import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { MoAPaths } from "../shared/index.ts";
import { resolve } from "node:path";

export const contextIndexTemplate =
  "# MoA context\n\nRead this shared index first, then open only the context files needed for the task. Coordinator and Workers maintain reusable project knowledge here. Workers contribute valuable reusable findings; the Coordinator primarily organizes, consolidates and prunes context. Keep each entry's path and short description current.\n\n## Context files\n";
export const contextIndexPath = (paths: MoAPaths) =>
  resolve(paths.context, "context.md");

/** Backfill only a missing index through the acting Agent's native filesystem. */
export async function ensureContextIndex(
  ctx: Context,
  agent: Agent,
  project: { workspacePath: string; paths: MoAPaths },
  signal: AbortSignal,
) {
  const presets = ctx.get("agentPresets");
  const fs = presets?.serviceFor(agent, "fs") ?? agent.ctx.get("fs");
  if (!fs) throw new Error("project-mode/filesystem-unavailable");
  const cwd = project.workspacePath;
  const workspace = await fs.resolve(cwd, { signal });
  const index = await fs.resolve(contextIndexPath(project.paths), {
    cwd,
    signal,
  });
  if (!fs.contains(workspace, index))
    throw new Error("project-mode/path-escape");
  if (await fs.stat(index, signal)) return;
  const directory = await fs.resolve(project.paths.context, { cwd, signal });
  const entries = (await fs.stat(directory, signal))
    ? await fs.listDir(directory, signal)
    : [];
  const links = entries
    .filter(
      (e) =>
        e.name !== "context.md" &&
        (e.type === "file" || e.type === "directory"),
    )
    .map((e) => {
      const name = e.name.replace(/[\[\]\\]/g, "\\$&");
      const href = encodeURIComponent(e.name).replace(
        /[()]/g,
        (c) => `%${c.charCodeAt(0).toString(16)}`,
      );
      return `- [${name}${e.type === "directory" ? "/" : ""}](./${href}) — Existing context ${e.type === "directory" ? "folder" : "file"}; add a short description.\n`;
    })
    .join("");
  const policy = (
    presets?.serviceFor(agent, "sandboxPolicy") ??
    agent.ctx.get("sandboxPolicy")
  )?.resolve({ session: agent.session });
  if (fs.sandboxMode && !policy)
    throw new Error("project-mode/missing-filesystem-policy");
  await fs.writeText(
    index,
    contextIndexTemplate + links,
    { kind: "createIfAbsent" },
    signal,
    policy,
  );
}
