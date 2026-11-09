import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import { interruptJudgePrompt } from "../prompts/interrupt-judge.ts";

export interface InterruptContext {
  kind: "request" | "background";
  description: string;
  elapsedSeconds?: number;
  tool?: { name: string; arguments: unknown };
}

/** Inspect a complete unread batch without consuming it or starting another Agent. */
export async function judgeInterrupt(
  ctx: Context,
  agent: Agent,
  messages: readonly UserMessage[],
  context: InterruptContext,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const control = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  try {
    const route = agent.session.requestHeader()?.config ?? agent.options;
    if (!route.provider || !route.model) return true;
    const model = await ctx.llm.resolveModelInfo(
      route.provider,
      route.model,
      control,
    );
    const effort = model.reasoning?.efforts.find((e) =>
      /^(off|none|disabled)$/i.test(e.id),
    )?.id;
    // A reasoning-only route cannot provide the requested no-thinking judge.
    if (model.reasoning?.efforts.length && !effort) return true;
    let answer = "";
    for await (const chunk of ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      ...(effort ? { reasoningEffort: effort } : {}),
      maxTokens: 32,
      temperature: 0,
      system:
        interruptJudgePrompt,
      messages: [
        createUserMessage({
          source: { kind: "user" },
          content: [
            {
              type: "text",
              text: JSON.stringify({ context, unread: messages }),
            },
          ],
        }),
      ],
      signal: control,
    })) {
      control.throwIfAborted();
      if (chunk.type === "text-delta") answer += chunk.text;
      if (
        chunk.type === "finish" &&
        (chunk.reason.kind === "error" || chunk.reason.kind === "aborted")
      )
        return true;
    }
    return answer.trim() !== "false";
  } catch (error) {
    signal.throwIfAborted();
    ctx.logger.debug(
      `moa: interrupt judge handed back control: ${String(error)}`,
    );
    return true;
  }
}
