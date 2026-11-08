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
import type { WorkerTimelinePage } from "../shared/index.ts";
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
}: Pick<React.ComponentProps<typeof MarkdownText>, "text" | "labels">) {
  const [expanded, setExpanded] = React.useState(false);
  const preview = React.useMemo(() => extractMarkdownPlainText(text), [text]);
  return (
    <details
      className="pm-axis-preview"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {expanded ? (
          <MarkdownText text={text} labels={labels} variant="compact" />
        ) : (
          preview
        )}
      </summary>
    </details>
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
  const [windowSize, setWindowSize] = React.useState(10),
    [retry, setRetry] = React.useState(0);
  const [state, setState] = React.useState<{
    workerId: SessionId;
    page?: WorkerTimelinePage;
    error?: string;
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
              {(w.phase === "working" || w.phase === "starting" || w.phase === "stopping") && (
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
        {!workers.length && <p className="pm-axis-empty">{t("noWorkers")}</p>}
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
                  parentSessionId: worker.parentSessionId ?? project!.project.coordinatorSessionId,
                  childSessionId: worker.workerId,
                  mode: "continuable",
                })
              }
            >
              {t("openConversation")}
            </button>
          </header>
        )}
        {!worker && <p className="pm-axis-empty">{t("selectWorker")}</p>}
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
        {page?.turns.map((turn) => (
          <article
            className="pm-axis-turn"
            key={`${worker!.workerId}:${turn.turn}`}
          >
            <div className="pm-axis-head">
              <strong>{t("timelineTurn", { turn: turn.turn })}</strong>
              <Timestamp time={turn.startedAt} />
              <span className="pm-axis-outcome">
                {t(
                  turn.outcome === null
                    ? "working"
                    : turn.outcome === "handoff"
                      ? "continued"
                      : turn.outcome === "completed"
                      ? "completed"
                      : turn.outcome === "aborted"
                        ? "stopped"
                        : "failed",
                )}
              </span>
            </div>
            <section className="pm-axis-section">
              <h4>{t("timelineInputs")}</h4>
              {turn.inputs.map((message) => (
                <div className="pm-axis-message" key={message.id}>
                  <Timestamp time={message.time} /> ·{" "}
                  {t(
                    message.actor === "coordinator"
                      ? "fromCoordinator"
                      : message.actor === "agent"
                        ? "fromAgent"
                      : "fromUser",
                  )}
                  <MessagePreview text={message.text} labels={labels} />
                </div>
              ))}
            </section>
            <section className="pm-axis-section">
              <h4>{t("timelineOutputs")}</h4>
              {turn.outputs.map((message) => (
                <div className="pm-axis-message" key={message.id}>
                  <Timestamp time={message.time} />
                  <MessagePreview text={message.text} labels={labels} />
                </div>
              ))}
              {!turn.outputs.length && (
                <p className="pm-axis-empty">
                  {t(turn.outcome === null ? "awaitingReply" : "emptyReply")}
                </p>
              )}
            </section>
            <section className="pm-axis-section">
              <h4>{t("timelineArtifacts")}</h4>
              <ul className="pm-axis-files">
                {turn.artifacts.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      title={file.path}
                      onClick={() =>
                        tab.actions.openResource(
                          fileAddressFor(worker!.workerId, page.cwd, file.path),
                        )
                      }
                    >
                      <FileTypeIcon path={file.path} size={16} />{" "}
                      <span>{file.path.split(/[\\/]/).at(-1)}</span>
                    </button>
                    {file.description && <small>{file.description}</small>}
                    <Timestamp time={file.time} />
                  </li>
                ))}
              </ul>
              {!turn.artifacts.length && (
                <p className="pm-axis-empty">{t("noArtifacts")}</p>
              )}
            </section>
          </article>
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
