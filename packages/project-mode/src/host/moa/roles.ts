import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { TaskInput } from "./agents.ts";

/** Restrict inherited execution tools; own communication tools remain available. */
export function applyRoleRestrictions(
  ctx: Context,
  agent: Agent,
  role: TaskInput["role"],
): () => void {
  if (role === "General-purpose") return () => {};
  const names =
    role === "Deep Research"
      ? ["web_search", "web_fetch"]
      : ["glob", "grep", "read"];
  const available = names.filter((name) => !!ctx.tools.get(name, agent));
  return agent.ctx.tools.restrict({ allow: available });
}
