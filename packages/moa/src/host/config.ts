import z from "@deepseek-ai/schemastery";
export interface Config {
  dataDirectory: string;
  coordinatorHiddenTools: string[];
  progressTextMaxChars: number;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  retryMaxAttempts: number;
}
export const Config: z<Config> = z.object({
  dataDirectory: z.string().default(".dsh/project-mode"),
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
