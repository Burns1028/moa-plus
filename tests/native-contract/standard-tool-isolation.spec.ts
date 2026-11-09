import { expect, it } from "vitest";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import Group from "@deepseek-ai/cordis-plugin-group";
import Presets from "@deepseek-ai/dsh-agent-preset-registry";
import Settings from "@deepseek-ai/dsh-tool-subagent/model-selection-settings";
import * as Fork from "@deepseek-ai/dsh-subagent-fork-in-process";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { fixture, response } from "../host/fixture.ts";

// The delegation rows and settings are the published dsh-web-app Standard
// preset's configuration. In particular modelSelectionSettings remains true
// even when the user's Host setting is disabled. That branch installs subagent
// on the Agent's own scope instead of the retained preset ancestor.
it.each([false, true])(
  "removes Standard's per-Agent delegation variant from composition and requests (model selection: %s)",
  async (modelSelection) => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.adapter.handler = async (options) => {
      if (options.sessionId !== "standard-coordinator") await gate;
      return response("done");
    };
    const names = [
      "subagent",
      "subagent_fork",
      "list_agents",
      "send_message",
      "interrupt_agent",
      ...(modelSelection ? ["list_subagent_models"] : []),
    ];
    try {
      f.ctx.baseUrl = new URL("./", import.meta.url).href;
      await f.ctx.plugin(Loader);
      f.ctx.loader.builtins.group = Group;
      await f.ctx.plugin(Settings, {
        enabled: modelSelection,
        allowedModels: modelSelection
          ? [{ provider: "test", model: "test" }]
          : [],
      });
      await f.ctx.plugin(Fork, { providerName: "fork" });
      await f.ctx.plugin(Presets, { default: "standard" });
      await f.ctx.agentPresets.register({
        id: "standard",
        plugins: [
          { name: "@deepseek-ai/dsh-tool-subagent-control" },
          { name: "@deepseek-ai/dsh-tool-subagent-control/list-agents" },
          {
            name: "@deepseek-ai/dsh-tool-subagent",
            config: {
              provider: "spawn",
              toolName: "subagent",
              modelSelectionSettings: true,
            },
          },
          {
            name: "@deepseek-ai/dsh-tool-subagent",
            config: { provider: "fork", toolName: "subagent_fork" },
          },
        ],
      });
      const create = async (id: string) =>
        (
          await f.ctx.agents.create({
            sessionId: SessionId(id),
            meta: { cwd: f.root },
            agentOptions: { provider: "test", model: "test" },
            setup: async (ctx) => {
              await f.ctx.agentPresets.mount(ctx);
            },
          })
        ).agent;
      const agent = await create("standard-coordinator");
      const ordinary = await create("standard-ordinary");
      const before = new Map(
        names.map((name) => [name, f.ctx.tools.get(name, agent)]),
      );
      for (const name of names) expect(before.get(name), name).toBeDefined();
      await f.ctx.projectMode.setEnabled(agent.id, true, 0, "on");
      agent.followup(
        createUserMessage({
          source: { kind: "user" },
          content: [{ type: "text", text: "Check tools" }],
        }),
      );
      await agent.whenIdle();
      const request = f.adapter.requests.find(
        (request) => request.sessionId === agent.id,
      )!;
      expect(request).toBeDefined();
      const schemas = f.ctx.tools.schemas(agent).map((tool) => tool.name);
      const routedNames = request.tools?.map((tool) => tool.name) ?? [];
      expect(schemas).toContain("Task");
      expect(routedNames).toContain("Task");
      for (const name of names) {
        expect.soft(schemas, `native schemas: ${name}`).not.toContain(name);
        expect
          .soft(routedNames, `GenerateOptions.tools: ${name}`)
          .not.toContain(name);
        expect(
          f.ctx.tools.get(name, ordinary),
          `ordinary ${name}`,
        ).toBeDefined();
      }
      const receipt = (await f.ctx.projectMode.controlForAgent(
        agent,
        { action: "spawn", name: "worker", task: "work" },
        "spawn",
        new AbortController().signal,
      )) as { workerId: ReturnType<typeof SessionId> };
      expect(receipt).toMatchObject({ accepted: true });
      const worker = f.ctx.agents.get(receipt.workerId)!;
      expect(worker).toBeDefined();
      expect(f.ctx.agentPresets.composedPreset(worker.ctx)).toBe("standard");
      for (const name of names)
        expect(f.ctx.tools.get(name, worker), `worker ${name}`).toBeUndefined();
      release();
      await worker.whenIdle();
      await f.ctx.projectMode.snapshot(agent.id);
      await agent.whenIdle();
      await expect(
        f.ctx.projectMode.setEnabled(
          agent.id,
          false,
          f.ctx.projectMode.mode(agent.id).revision,
          "off",
        ),
      ).rejects.toThrow("project-mode/session-mode-locked");
      await f.plugin.dispose();
      for (const name of names)
        expect(f.ctx.tools.get(name, agent), `unloaded ${name}`).toBe(
          before.get(name),
        );
      expect(f.ctx.tools.get("Task", agent)).toBeUndefined();
    } finally {
      release();
      await f.dispose();
    }
  },
);
