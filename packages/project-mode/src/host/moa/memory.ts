import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { isAbsolute, resolve } from "node:path";

export interface MoAMemoryPaths {
  root: string;
  context: string;
  notes: string;
  archived: string;
  /** Optional for records created before the progressive index existed. */
  index?: string;
}

export function memoryPaths(root: string): MoAMemoryPaths & { index: string } {
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
    ? `${text}\n\nReminder: notes exceed 8000 characters; archive or prune completed material while preserving useful context.`
    : text;
}

export interface MoAIdentity {
  id: string;
  workdir: string;
  isolated: boolean;
  reportTo: string;
  reportingInstructions: string;
}

/** Return dialogue history content, not a system prompt. */
export function identityMessage(identity: MoAIdentity): string {
  if (!isAbsolute(identity.workdir))
    throw new Error("project-mode/workdir-not-absolute");
  return `Agent ID: ${identity.id}\nWorkdir: ${identity.workdir} (${identity.isolated ? "Isolated" : "Shared"})\nReport to: ${identity.reportTo}\nReporting instructions: ${identity.reportingInstructions}`;
}

export const contextIndexTemplate =
  "# Project context\n\nRead this index first, then open only the context files needed for the task. Maintain paths and short descriptions for reusable knowledge.\n\n## Context files\n";

/** Operations use the acting agent's scoped provider and session policy. */
export class MoAMemory {
  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
    private readonly project: { workspacePath: string; paths: MoAMemoryPaths },
  ) {}

  private filesystem() {
    const presets = this.ctx.get("agentPresets");
    const fs =
      presets?.serviceFor(this.agent, "fs") ?? this.agent.ctx.get("fs");
    if (!fs) throw new Error("project-mode/filesystem-unavailable");
    const policy = (
      presets?.serviceFor(this.agent, "sandboxPolicy") ??
      this.agent.ctx.get("sandboxPolicy")
    )?.resolve({ session: this.agent.session });
    if (fs.sandboxMode && !policy)
      throw new Error("project-mode/missing-filesystem-policy");
    return { fs, policy };
  }

  async readNotes(signal: AbortSignal): Promise<string> {
    const { fs } = this.filesystem();
    const cwd = this.project.workspacePath;
    const workspace = await fs.resolve(cwd, { signal });
    const target = await fs.resolve(this.project.paths.notes, { cwd, signal });
    if (!fs.contains(workspace, target))
      throw new Error("project-mode/path-escape");
    return fs.readText(target, signal);
  }

  async ensureContextIndex(signal: AbortSignal): Promise<void> {
    const { fs, policy } = this.filesystem();
    const cwd = this.project.workspacePath;
    const workspace = await fs.resolve(cwd, { signal });
    const directory = await fs.resolve(this.project.paths.context, {
      cwd,
      signal,
    });
    const index = await fs.resolve(
      this.project.paths.index ??
        resolve(this.project.paths.context, "index.md"),
      { cwd, signal },
    );
    if (!fs.contains(workspace, directory) || !fs.contains(directory, index))
      throw new Error("project-mode/path-escape");
    if (await fs.stat(index, signal)) return;
    const entries = (await fs.stat(directory, signal))
      ? await fs.listDir(directory, signal)
      : [];
    const links = entries
      .filter(
        (e) =>
          e.name !== "index.md" &&
          (e.type === "file" || e.type === "directory"),
      )
      .map((e) => {
        const name = e.name.replace(/[\[\]\\]/g, "\\$&");
        const href = encodeURIComponent(e.name).replace(
          /[()]/g,
          (c) => `%${c.charCodeAt(0).toString(16)}`,
        );
        return `- [${name}${e.type === "directory" ? "/" : ""}](./${href}) — Existing context ${e.type}; add a short description.\n`;
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
}
