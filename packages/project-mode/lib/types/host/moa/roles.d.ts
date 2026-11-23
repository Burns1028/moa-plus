import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { WorkAssignment } from "./agents.ts";
/** Restrict inherited execution tools; own communication tools remain available. */
export declare function applyRoleRestrictions(ctx: Context, agent: Agent, role: WorkAssignment["role"]): () => void;
