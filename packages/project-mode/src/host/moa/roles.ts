import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { TaskInput } from "./agents.ts";

/** Restrict global native execution tools; scoped communication tools remain available. */
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
  const available = names.filter((name) => !!ctx.tools.get(name));
  return agent.ctx.tools.restrict({ allow: available });
}
