import { Context } from "@deepseek-ai/cordis";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import {
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import Storage from "@deepseek-ai/dsh-storage";
import * as StorageJson from "@deepseek-ai/dsh-storage-json";
import * as Persistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import * as StorageDomain from "@deepseek-ai/dsh-storage-domain";
import JobsLocal from "@deepseek-ai/dsh-jobs-local";
import Subagents from "@deepseek-ai/dsh-subagent";
import * as Spawn from "@deepseek-ai/dsh-subagent-spawn-in-process";
import SessionQueryEngine from "@deepseek-ai/dsh-session-query";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ProjectMode from "../../packages/project-mode/src/host/index.ts";

export function response(text: string): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text },
    { type: "block-end", index: 0, block: { type: "text", text } },
    { type: "finish", reason: { kind: "stop" } },
  ];
}
export class Adapter extends LlmAdapter {
  requests: GenerateOptions[] = [];
  constructor(
    public handler: (
      options: GenerateOptions,
    ) => Promise<StreamChunk[]> | StreamChunk[] = () => response("done"),
  ) {
    super();
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model };
  }
  async *stream(options: GenerateOptions) {
    this.requests.push(options);
    yield* await this.handler(options);
  }
}
// Native observation/read implementation; search is not used by this plugin.
class Query extends SessionQueryEngine {
  async searchSessions(): Promise<never> {
    throw new Error("Search outside fixture scope");
  }
  async searchEvents(): Promise<never> {
    throw new Error("Search outside fixture scope");
  }
}
export async function fixture(
  adapter = new Adapter(),
  options: {
    root?: string;
    keepFiles?: boolean;
    maxActiveSubagents?: number;
    workspace?: boolean;
    completionVerification?: boolean;
  } = {},
) {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "project-mode-")));
  const ctx = new Context();
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
  await ctx.plugin(Persistence, {
    root: join(root, "sessions"),
    compression: "none",
  });
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(JobsLocal);
  ctx.llm.registerAdapter(["test"], adapter);
  await ctx.plugin(Storage);
  await ctx.plugin(StorageJson, { root: join(root, "storage") });
  await ctx.plugin(StorageDomain, { backend: "json" });
  if (options.workspace) {
    const { default: WorkspaceRegistry } = await import(
      "@deepseek-ai/dsh-workspace"
    );
    await ctx.plugin(WorkspaceRegistry);
  }
  await ctx.plugin(Query);
  await ctx.plugin(
    Subagents,
    options.maxActiveSubagents === undefined
      ? {}
      : { maxActiveSubagents: options.maxActiveSubagents },
  );
  await ctx.plugin(Spawn, { providerName: "spawn" });
  const plugin = await ctx.plugin(ProjectMode, { completionVerification: options.completionVerification ?? false });
  return {
    ctx,
    root,
    adapter,
    plugin,
    async dispose() {
      await ctx.fiber.dispose();
      if (!options.keepFiles) await rm(root, { recursive: true, force: true });
    },
  };
}
