import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { Context } from "@deepseek-ai/cordis";
import type { WorkerMessageAttachment } from "../shared/index.ts";

/** Project visible dialogue without rewriting text or copying attachment content. */
export function messageContent(
  ctx: Context,
  content: readonly ContentBlock[],
  separator = "",
): { text: string; attachments?: WorkerMessageAttachment[] } {
  const attachments: WorkerMessageAttachment[] = [];
  for (const block of content) {
    if (block.type !== "file" && block.type !== "image") continue;
    const store = ctx.get("attachments");
    const hostPath =
      block.type === "file"
        ? store?.fileHostPath(block.attachment)
        : store?.imageHostPath(block.attachment);
    const path = hostPath && ctx.get("fs")?.processPathFromHostPath(hostPath);
    const reference =
      block.type === "file"
        ? { type: "file" as const, attachment: block.attachment }
        : { type: "image" as const, attachment: block.attachment };
    attachments.push({ ...reference, ...(path ? { path } : {}) });
  }
  return {
    text: content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(separator),
    ...(attachments.length ? { attachments } : {}),
  };
}
