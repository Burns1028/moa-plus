import * as React from "react";
import {
  JsonBlock,
  MarkdownText,
  extractMarkdownPlainText,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ContentBlock } from "@deepseek-ai/dsh-llm/types";
import type { SharedProps } from "./components.tsx";
import type { IncomingAgentMessage } from "./tail.ts";
import { useSelected } from "./hooks.ts";
import { styles } from "./styles.ts";
import { WorkerIcon } from "./worker-icon.tsx";

/** Remove only the transport wrapper we authored; the delivered message stays unchanged. */
function messageBody(message: IncomingAgentMessage): readonly ContentBlock[] {
  const source = message.source as unknown as Record<string, unknown>;
  const first = message.content[0];
  if (first?.type !== "text") return message.content;
  if (source.kind === "moa-message") {
    const prefix = `${typeof source.requestId === "string" ? `Request ID: ${source.requestId}\n` : ""}${typeof source.replyTo === "string" ? `Reply to: ${source.replyTo}\n` : ""}From: ${source.senderId}\n`;
    if (first.text.startsWith(prefix))
      return [
        { ...first, text: first.text.slice(prefix.length) },
        ...message.content.slice(1),
      ];
  }
  if (
    source.kind === "project-mode-result" &&
    typeof source.completionId === "string" &&
    first.text.startsWith("Worker ") &&
    first.text.includes(
      ` (${source.workerId}), turn ${source.workerTurn}, outcome `,
    ) &&
    first.text.includes(`Completion ${source.completionId}. `)
  )
    return message.content.slice(1);
  return message.content;
}

function Reasoning({
  text,
  labels,
  t,
}: Pick<React.ComponentProps<typeof MarkdownText>, "text" | "labels"> &
  Pick<SharedProps, "t">) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <details
      className="pm-agent-reasoning"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>{t("agentReasoning")}</summary>
      {expanded && (
        <MarkdownText text={text} labels={labels} variant="compact" />
      )}
    </details>
  );
}

/** Internal correspondence belongs to the native process, not a user bubble. */
export function AgentMessage({
  message,
  client,
  t,
  settled = false,
  opening = false,
}: Pick<SharedProps, "client" | "t"> & {
  message: IncomingAgentMessage;
  settled?: boolean;
  opening?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(opening);
  const disclosure = React.useRef<HTMLDetailsElement>(null);
  const previewId = React.useId();
  React.useEffect(() => {
    if (!opening) return;
    if (disclosure.current) disclosure.current.open = true;
    setExpanded(true);
  }, [opening]);
  React.useEffect(() => {
    if (!settled || opening) return;
    if (disclosure.current) disclosure.current.open = false;
    setExpanded(false);
  }, [settled, opening]);
  const compact = settled && !opening;
  const source = message.source as unknown as Record<string, unknown>;
  const id = [
    source.senderSessionId,
    source.senderId,
    source.workerId,
    source.coordinatorSessionId,
  ].find((value): value is string => typeof value === "string" && value !== "");
  const name = useSelected(client.store.subscribe, () => {
    if (typeof source.senderName === "string" && source.senderName)
      return source.senderName;
    for (const project of client.store.projects()) {
      const worker = project.workers.find((worker) => worker.workerId === id);
      if (worker) return worker.name;
      if (project.project.coordinatorSessionId === id)
        return t("fromCoordinator");
    }
    return id === source.rootId || source.kind === "project-mode-assignment"
      ? t("fromCoordinator")
      : t("fromAgent");
  });
  const labels = React.useMemo(
    () => ({
      code: { copyLabel: t("copy"), copiedLabel: t("copied") },
      footnotes: t("footnotes"),
    }),
    [t],
  );
  const content = React.useMemo(() => messageBody(message), [message]);
  const visibleText = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
  const preview = React.useMemo(
    () =>
      extractMarkdownPlainText(visibleText)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240),
    [visibleText],
  );
  const sender = t("messageFrom", { name });
  const kind =
    source.kind === "project-mode-result"
      ? "agentReport"
      : source.kind === "project-mode-assignment"
        ? "agentAssignment"
        : typeof source.replyTo === "string"
          ? "agentReply"
          : typeof source.requestId === "string"
            ? "agentRequest"
            : "agentMessage";
  return (
    <>
      <style>{styles}</style>
      <details
        ref={disclosure}
        className="pm-agent-message"
        data-moa-message
        data-settled={compact || undefined}
        data-opening-input={opening || undefined}
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary
          aria-label={t(expanded ? "collapse" : "expand", {
            name: `${sender} · ${t(kind)}`,
          })}
          aria-describedby={expanded || compact ? undefined : previewId}
        >
          <span className="pm-agent-heading">
            <WorkerIcon workerId={id ?? name} />
            <span className="pm-agent-sender">{sender}</span>
            <span className="pm-agent-kind">{t(kind)}</span>
            <svg
              className="pm-agent-chevron"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="m6 4 4 4-4 4" />
            </svg>
          </span>
          {!expanded && !compact && (
            <span className="pm-agent-preview" id={previewId}>
              {preview ||
                (content.length ? t("messageContent") : t("emptyReply"))}
            </span>
          )}
        </summary>
        {expanded && (
          <div className="pm-agent-body">
            {content.length ? (
              content.map((block, index) =>
                block.type === "text" ? (
                  <MarkdownText
                    key={index}
                    text={block.text}
                    labels={labels}
                    variant="compact"
                  />
                ) : block.type === "reasoning" ? (
                  <Reasoning
                    key={index}
                    text={block.text}
                    labels={labels}
                    t={t}
                  />
                ) : (
                  <JsonBlock
                    key={index}
                    label={t("messageContent")}
                    payload={block}
                    truncatedLabel={(count) => t("truncatedContent", { count })}
                  />
                ),
              )
            ) : (
              <p className="pm-agent-empty">{t("emptyReply")}</p>
            )}
          </div>
        )}
      </details>
    </>
  );
}
