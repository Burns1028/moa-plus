import * as React from "react";
import { JsonBlock } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ContentBlock } from "@deepseek-ai/dsh-llm/types";
import type { SharedProps } from "./components.tsx";
import type { IncomingAgentMessage } from "./tail.ts";
import { useSelected } from "./hooks.ts";
import { styles } from "./styles.ts";
import { MessagePreview } from "./worker-timeline.tsx";

/** Remove only the transport wrapper we authored; the delivered message stays unchanged. */
function messageBody(message: IncomingAgentMessage): readonly ContentBlock[] {
  const source = message.source as unknown as Record<string, unknown>;
  const first = message.content[0];
  if (first?.type !== "text") return message.content;
  if (source.kind === "moa-message") {
    const prefix = `${typeof source.requestId === "string" ? `Request ID: ${source.requestId}\n` : ""}${typeof source.replyTo === "string" ? `Reply to: ${source.replyTo}\n` : ""}From: ${source.senderId}\n`;
    if (first.text.startsWith(prefix))
      return [{ ...first, text: first.text.slice(prefix.length) }, ...message.content.slice(1)];
  }
  if (
    source.kind === "project-mode-result" &&
    typeof source.completionId === "string" &&
    first.text.startsWith("Worker ") &&
    first.text.includes(` (${source.workerId}), turn ${source.workerTurn}, outcome `) &&
    first.text.includes(`Completion ${source.completionId}. `)
  ) return message.content.slice(1);
  return message.content;
}

/** The same incoming message row is used in Coordinator and Worker conversations. */
export function AgentMessage({ message, client, t }: Pick<SharedProps, "client" | "t"> & { message: IncomingAgentMessage }) {
  const source = message.source as unknown as Record<string, unknown>;
  const id = [source.senderSessionId, source.senderId, source.workerId, source.coordinatorSessionId]
    .find((value): value is string => typeof value === "string" && value !== "");
  const name = useSelected(client.store.subscribe, () => {
    if (typeof source.senderName === "string" && source.senderName) return source.senderName;
    for (const project of client.store.projects()) {
      const worker = project.workers.find(worker => worker.workerId === id);
      if (worker) return worker.name;
      if (project.project.coordinatorSessionId === id) return t("fromCoordinator");
    }
    return id === source.rootId || source.kind === "project-mode-assignment"
      ? t("fromCoordinator") : t("fromAgent");
  });
  const labels = React.useMemo(() => ({
    code: { copyLabel: t("copy"), copiedLabel: t("copied") },
    footnotes: t("footnotes"),
  }), [t]);
  const content = messageBody(message);
  const sender = t("messageFrom", { name });
  return (
    <section className="pm-agent-message" data-moa-message>
      <style>{styles}</style>
      <header>{sender}</header>
      {content.length ? content.map((block, index) => block.type === "text"
        ? <MessagePreview key={index} text={block.text} labels={labels} />
        : <JsonBlock key={index} label={t("messageContent")} payload={block} truncatedLabel={(count) => t("truncatedContent", { count })} />)
        : <p className="pm-agent-empty">{t("emptyReply")}</p>}
    </section>
  );
}
