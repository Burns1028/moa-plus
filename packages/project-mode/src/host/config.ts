import z from "@deepseek-ai/schemastery";
export interface Config {
  backgroundStrategy: "after-seconds" | "new-message" | "llm-judge";
  backgroundAfterSeconds: number;
  completionVerification: boolean;
  dataDirectory: string;
  coordinatorHiddenTools: string[];
  progressTextMaxChars: number;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  retryMaxAttempts: number;
}
export const Config: z<Config> = z.object({
  backgroundStrategy: z.union(["after-seconds", "new-message", "llm-judge"]).default("llm-judge"),
  backgroundAfterSeconds: z.number().min(0).default(10),
  completionVerification: z.boolean().default(true),
  dataDirectory: z.string().default("."),
  coordinatorHiddenTools: z
    .array(z.string())
    .default([
      "subagent",
      "subagent_fork",
      "list_agents",
      "send_message",
      "interrupt_agent",
      "list_subagent_models",
      "workflow",
    ]),
  progressTextMaxChars: z.number().min(1).default(100),
  retryInitialDelayMs: z.number().min(10).default(1000),
  retryMaxDelayMs: z.number().min(10).default(30000),
  retryMaxAttempts: z.number().min(0).step(1).default(5),
});
