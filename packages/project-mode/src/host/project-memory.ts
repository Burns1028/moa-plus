import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ProjectPaths } from "../shared/index.ts";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { isAbsolute, resolve, basename } from "node:path";
import type { HostAccess } from "./host-access.ts";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "moa-notes": { kind: "moa-notes"; coordinatorSessionId: string };
  }
}

export function memoryPaths(root: string): ProjectPaths & { index: string } {
  const context = resolve(root, "context");
  return {
    root: resolve(root),
    context,
    notes: resolve(root, "notes.md"),
    archived: resolve(root, "archived.md"),
    index: resolve(context, "index.md"),
  };
}

export function notesInjection(text: string): string {
  return Array.from(text).length > 8000
    ? `${text}\n\nReminder: notes exceed 8000 characters. The Coordinator should move concluded work and its results to archived.md and reusable detail to Context; keep current goals, assignments, blockers and next steps in notes.md.`
    : text;
}

export interface MoAIdentity {
  id: string;
  workdir: string;
  isolated: boolean;
  reportTo: string;
  reportingInstructions: string;
}
/** Identity is dialogue content; it never personalizes the system prompt. */
export function identityMessage(identity: MoAIdentity): string {
  if (!isAbsolute(identity.workdir))
    throw new Error("project-mode/workdir-not-absolute");
  return `Agent ID: ${identity.id}\nWorkdir: ${identity.workdir} (${identity.isolated ? "Isolated" : "Shared"})\nReport to: ${identity.reportTo}\nReporting instructions: ${identity.reportingInstructions}`;
}

function filesystem(ctx: Context, agent: Agent) {
  const presets = ctx.get("agentPresets");
  const fs = presets?.serviceFor(agent, "fs") ?? agent.ctx.get("fs");
  if (!fs) throw new Error("project-mode/filesystem-unavailable");
  const policy = (
    presets?.serviceFor(agent, "sandboxPolicy") ??
    agent.ctx.get("sandboxPolicy")
  )?.resolve({ session: agent.session });
  if (fs.sandboxMode && !policy)
    throw new Error("project-mode/missing-filesystem-policy");
  return { fs, policy };
}

export const contextIndexTemplate =
  "# Project context\n\nRead this shared index first, then open only the context files needed for the task. Coordinator and Workers maintain reusable project knowledge here. Workers contribute valuable reusable findings; the Coordinator primarily organizes, consolidates and prunes context. Keep each entry's path and short description current.\n\n## Context files\n";
export const contextIndexPath = (paths: ProjectPaths) =>
  paths.index ?? resolve(paths.context, "index.md");

export async function readNotes(
  ctx: Context,
  agent: Agent,
  project: { workspacePath: string; paths: ProjectPaths },
  signal: AbortSignal,
): Promise<string> {
  const { fs } = filesystem(ctx, agent);
  const workspace = await fs.resolve(project.workspacePath, { signal });
  const target = await fs.resolve(project.paths.notes, {
    cwd: project.workspacePath,
    signal,
  });
  if (!fs.contains(workspace, target))
    throw new Error("project-mode/path-escape");
  return fs.readText(target, signal);
}

/** Backfill only a missing index through the acting Agent's native filesystem. */
export async function ensureContextIndex(
  ctx: Context,
  agent: Agent,
  project: { workspacePath: string; paths: ProjectPaths },
  signal: AbortSignal,
) {
  const { fs, policy } = filesystem(ctx, agent);
  const cwd = project.workspacePath;
  const workspace = await fs.resolve(cwd, { signal });
  const index = await fs.resolve(contextIndexPath(project.paths), {
    cwd,
    signal,
  });
  const directory = await fs.resolve(project.paths.context, { cwd, signal });
  if (!fs.contains(workspace, directory) || !fs.contains(directory, index))
    throw new Error("project-mode/path-escape");
  if (await fs.stat(index, signal)) return;
  const entries = (await fs.stat(directory, signal))
    ? await fs.listDir(directory, signal)
    : [];
  const links = entries
    .filter(
      (e) =>
        e.name !== basename(contextIndexPath(project.paths)) &&
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
  await fs.writeText(
    index,
    contextIndexTemplate + links,
    { kind: "createIfAbsent" },
    signal,
    policy,
  );
}

/** Native admission owns the history commit; unchanged notes still reach each inference. */
export function bindProjectMemory(host: HostAccess): void {
  host.ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
    const decision = await next();
    const record = host.record(agent.id) ?? host.owner(agent.id);
    if (decision.kind !== "enter" || record?.project.mode !== "enabled")
      return decision;
    const control = AbortSignal.any([signal, host.closing.signal]);
    try {
      await ensureContextIndex(host.ctx, agent, record.project, control);
    } catch (error) {
      control.throwIfAborted();
      host.ctx.logger.warn(`project-mode: context index: ${String(error)}`);
    }
    if (host.record(agent.id)?.project.mode !== "enabled") return decision;
    try {
      const notes = await readNotes(host.ctx, agent, record.project, control);
      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({
            source: { kind: "moa-notes", coordinatorSessionId: agent.id },
            content: [
              {
                type: "text",
                text: `Current notes.md (complete):\n${notesInjection(notes)}`,
              },
            ],
          }),
        ],
      };
    } catch (error) {
      control.throwIfAborted();
      // A denied memory read must not disable otherwise available native work.
      host.ctx.logger.warn(`project-mode: notes unavailable: ${String(error)}`);
      return decision;
    }
  });
}
