import { isVisibleWorker } from "../shared/worker-membership.ts";
import * as React from "react";
import {
  FileTypeIcon,
  MarkdownText,
  StateDot,
  extractMarkdownPlainText,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { TypertClientRemote } from "@deepseek-ai/dsh-typert-protocol";
import { fileAddressFor } from "@deepseek-ai/dsh-util-workspace-path";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
  WorkerTimelineMessage,
  WorkerTimelinePage,
  WorkerTimelineTurn,
} from "../shared/index.ts";
import type { SharedProps } from "./components.tsx";
import { projectForSession } from "./tree.ts";
import { useSelected } from "./hooks.ts";
import { WorkerIcon } from "./worker-icon.tsx";
import { panelStyles } from "./panel-styles.ts";

export type WorkersPanelProps = PropsRuntime<"sidebar.right.pane.tab"> &
  PropsLocale<"project-mode"> &
  SharedProps & {
    timeline: TypertClientRemote["projectMode"]["timeline"];
  };
function Timestamp({ time }: { time: number }) {
  return (
    <time dateTime={new Date(time).toISOString()}>
      {new Date(time).toLocaleString(undefined, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}
export function MessagePreview({
  text,
  labels,
  collapseLabel,
}: Pick<React.ComponentProps<typeof MarkdownText>, "text" | "labels"> & {
  collapseLabel: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const preview = React.useMemo(() => extractMarkdownPlainText(text), [text]);
  return (
    <details
      className="pm-axis-preview"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>{expanded ? collapseLabel : preview}</span>
      </summary>
      {expanded && (
        <MarkdownText text={text} labels={labels} variant="compact" />
      )}
    </details>
  );
}
function MessageBody({
  message,
  labels,
  open,
  collapseLabel,
}: {
  message: Pick<WorkerTimelineMessage, "text" | "displayText" | "attachments">;
  labels: React.ComponentProps<typeof MarkdownText>["labels"];
  open(path: string): void;
  collapseLabel: string;
}) {
  return (
    <>
      {(message.displayText ?? message.text) && (
        <MessagePreview
          text={message.displayText ?? message.text}
          labels={labels}
          collapseLabel={collapseLabel}
        />
      )}
      {!!message.attachments?.length && (
        <ul className="pm-axis-files">
          {message.attachments.map(({ type, attachment, path }, index) => {
            const name = attachment.name ?? attachment.attachmentId;
            const label = (
              <>
                <FileTypeIcon path={name} size={16} /> <span>{name}</span>
              </>
            );
            return (
              <li key={`${type}:${attachment.attachmentId}:${index}`}>
                {path ? (
                  <button type="button" title={path} onClick={() => open(path)}>
                    {label}
                  </button>
                ) : (
                  <span title={attachment.attachmentId}>{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function TimelineTurn({
  turn,
  t,
  labels,
  open,
}: {
  turn: WorkerTimelineTurn;
  t: WorkersPanelProps["t"];
  labels: React.ComponentProps<typeof MarkdownText>["labels"];
  open(path: string): void;
}) {
  const outcome =
    turn.outcome === null
      ? "working"
      : turn.outcome === "handoff"
        ? "continued"
        : turn.outcome === "completed"
          ? "completed"
          : turn.outcome === "aborted"
            ? "stopped"
            : "failed";
  const body = (messages: WorkerTimelineMessage[]) => (
    <MessageBody
      message={{
        text: messages
          .map((message) => message.displayText ?? message.text)
          .filter(Boolean)
          .join("\n\n"),
        attachments: messages.flatMap((message) => message.attachments ?? []),
      }}
      labels={labels}
      collapseLabel={t("collapseText")}
      open={open}
    />
  );
  return (
    <article className="pm-axis-turn">
      <div className="pm-axis-turn-head">
        <strong>{t("timelineTurn", { turn: turn.turn })}</strong>
        <Timestamp time={turn.startedAt} />
        <span className="pm-axis-outcome" data-outcome={outcome}>
          {t(outcome)}
        </span>
      </div>
      <section className="pm-axis-section">
        <h4>{t("timelineInputs")}</h4>
        {turn.inputs.length ? (
          body(turn.inputs)
        ) : (
          <p className="pm-axis-empty">{t("emptyInput")}</p>
        )}
      </section>
      <section className="pm-axis-section pm-axis-output">
        <h4>{t("timelineOutputs")}</h4>
        {turn.outputs.length ? (
          body(turn.outputs)
        ) : (
          <p className="pm-axis-empty">
            {t(turn.outcome === null ? "awaitingReply" : "emptyReply")}
          </p>
        )}
      </section>
      <section className="pm-axis-section">
        <h4>{t("timelineArtifacts")}</h4>
        {turn.artifacts.length ? (
          <ul className="pm-axis-files">
            {turn.artifacts.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  title={
                    file.description
                      ? `${file.path}\n${file.description}`
                      : file.path
                  }
                  onClick={() => open(file.path)}
                >
                  <FileTypeIcon path={file.path} size={16} />
                  <span>{file.path.split(/[\\/]/).at(-1)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pm-axis-empty">{t("noArtifacts")}</p>
        )}
      </section>
    </article>
  );
}
export function WorkersPanel({
  client,
  open,
  timeline,
  sessionId,
  useTabInfo,
  t,
}: WorkersPanelProps) {
  const project = useSelected(client.store.subscribe, () =>
    projectForSession(client, sessionId),
  );
  const generation = useSelected(
    client.subscribeModes,
    () => client.connectionVersion,
  );
  const { tab } = useTabInfo();
  const [chosen, choose] = React.useState<SessionId>();
  const axisRef = React.useRef<HTMLElement>(null);
  const workers = (project?.workers ?? []).filter(isVisibleWorker),
    worker = workers.find((w) => w.workerId === chosen) ?? workers[0];
  const nativeReady =
    worker?.lifecycle === "active" && worker.availability === "live";
  const [windowSize, setWindowSize] = React.useState(10),
    [retry, setRetry] = React.useState(0);
  const [state, setState] = React.useState<{
    workerId: SessionId;
    page?: WorkerTimelinePage;
    error?: string;
    readyWhenFailed?: boolean;
  }>();
  const labels = React.useMemo(
    () => ({
      code: { copyLabel: t("copy"), copiedLabel: t("copied") },
      footnotes: t("footnotes"),
    }),
    [t],
  );
  React.useEffect(() => {
    if (!tab.visible || !project || !worker) return;
    const controller = new AbortController(),
      signal = AbortSignal.any([controller.signal, tab.signal]);
    const stream = timeline(
      project.project.coordinatorSessionId,
      worker.workerId,
      windowSize,
      signal,
    );
    void (async () => {
      try {
        for await (const page of stream)
          if (!signal.aborted) setState({ workerId: worker.workerId, page });
      } catch (error) {
        if (!signal.aborted)
          setState({
            workerId: worker.workerId,
            error: error instanceof Error ? error.message : String(error),
            readyWhenFailed: nativeReady,
          });
      } finally {
        stream.dispose();
      }
    })();
    return () => {
      controller.abort();
      stream.dispose();
    };
  }, [
    worker?.workerId,
    project?.project.coordinatorSessionId,
    project?.streamEpoch,
    tab.visible,
    tab.signal,
    windowSize,
    retry,
    generation,
  ]);
  const current = state?.workerId === worker?.workerId ? state : undefined,
    page = current?.page;
  React.useEffect(() => {
    // A creation-time observation can fail before native activation. Reopen
    // only when that failed attempt gains readiness; healthy streams stay put.
    if (current?.error && current.readyWhenFailed === false && nativeReady)
      setRetry((value) => value + 1);
  }, [worker?.workerId, current?.error, current?.readyWhenFailed, nativeReady]);
  if (!workers.length)
    return (
      <div className="pm-workers-panel pm-workers-panel-empty">
        <style>{panelStyles}</style>
        <p className="pm-axis-empty">{t("noWorkers")}</p>
      </div>
    );
  return (
    <div className="pm-workers-panel">
      <style>{panelStyles}</style>
      <nav className="pm-workers-list" aria-label={t("workers")}>
        {workers.map((w) => (
          <button
            type="button"
            key={w.workerId}
            aria-pressed={w.workerId === worker?.workerId}
            onClick={() => {
              choose(w.workerId);
              setWindowSize(10);
              if (axisRef.current) axisRef.current.scrollTop = 0;
            }}
            title={w.name}
          >
            <span className="pm-panel-worker-icon">
              <WorkerIcon workerId={w.workerId} />
              {(w.phase === "working" ||
                w.phase === "starting" ||
                w.phase === "stopping") && (
                <StateDot
                  state="ongoing"
                  size={22}
                  className="pm-panel-running"
                />
              )}
            </span>
            <span className="pm-worker-copy">
              <span className="pm-worker-name">{w.name}</span>
              <span className="pm-worker-phase">{t(w.phase)}</span>
            </span>
          </button>
        ))}
      </nav>
      <section
        ref={axisRef}
        className="pm-worker-axis"
        aria-label={t("timeline")}
      >
        {worker && (
          <header>
            <h3>{worker.name}</h3>
            <button
              type="button"
              onClick={() =>
                open({
                  parentSessionId:
                    worker.parentSessionId ??
                    project!.project.coordinatorSessionId,
                  childSessionId: worker.workerId,
                  mode: "continuable",
                })
              }
            >
              {t("openConversation")}
            </button>
          </header>
        )}
        {worker && !page && !current?.error && (
          <p className="pm-axis-empty">{t("loadingTimeline")}</p>
        )}
        {current?.error && (
          <div className="pm-axis-error" role="status">
            {current.error}
            <br />
            <button type="button" onClick={() => setRetry((r) => r + 1)}>
              {t("retry")}
            </button>
          </div>
        )}
        {page?.turns.toReversed().map((turn) => (
          <TimelineTurn
            key={`${worker!.workerId}:${turn.turn}`}
            turn={turn}
            t={t}
            labels={labels}
            open={(path) =>
              tab.actions.openResource(
                fileAddressFor(worker!.workerId, page.cwd, path),
              )
            }
          />
        ))}
        {page && !page.turns.length && (
          <p className="pm-axis-empty">{t("noTurns")}</p>
        )}
        {page?.hasMore && (
          <button
            type="button"
            className="pm-axis-more"
            onClick={() => setWindowSize((n) => n + 10)}
          >
            {t("loadEarlier")}
          </button>
        )}
      </section>
    </div>
  );
}
