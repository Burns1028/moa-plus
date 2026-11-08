import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { TaskInput } from "./agents.ts";
/** Restrict global native execution tools; scoped communication tools remain available. */
export declare function applyRoleRestrictions(ctx: Context, agent: Agent, role: TaskInput["role"]): () => void;
