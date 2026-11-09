import * as React from "react";
import { useEffect } from "react";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionTarget } from "@deepseek-ai/dsh-api-session-controller/client";
import type { MoAKey } from "./locales.ts";
import type { MoAClient } from "./runtime.ts";
import { useSelected } from "./hooks.ts";
import { styles } from "./styles.ts";
import { WorkerIcon } from "./worker-icon.tsx";
export type Translator = (
  key: MoAKey,
  args?: Record<string, string | number>,
) => string;
export interface SharedProps {
  client: MoAClient;
  open: (target: SessionTarget) => void;
  t: Translator;
}
export function WorkerCapsuleList({
  client,
  sessionId,
  turn,
  closed,
  segmentStartSeq,
  open,
  t,
}: SharedProps & {
  sessionId: SessionId;
  turn: number;
  closed: boolean;
  segmentStartSeq?: number;
}) {
  const capsules = useSelected(client.store.subscribe, () =>
    client.store.turn(sessionId, turn, closed, segmentStartSeq),
  );
  if (!capsules.length) return null;
  return (
    <>
      <style>{styles}</style>
      <ul className="pm-capsules" aria-label={t("workers")}>
        {capsules.map((c) => {
          const status = t(c.status),
            progress = c.text?.replace(/\s+/g, " ").trim(),
            active =
              c.status === "working" ||
              c.status === "starting" ||
              c.status === "waiting-user";
          const detail = active && progress ? progress : status;
          const tooltip = [
            ...new Set(
              [
                c.name,
                status,
                progress,
                c.queueLength
                  ? t("queued", { count: c.queueLength })
                  : undefined,
              ].filter(Boolean),
            ),
          ].join("\n");
          return (
            <li key={c.key}>
              <button
                type="button"
                className="pm-capsule"
                onClick={() => open(c.address)}
                aria-label={t("openWorker", { name: c.name })}
                title={tooltip}
              >
                <WorkerIcon workerId={c.workerId} />
                <strong>{c.name}</strong>
                <span className="pm-progress">{detail}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
export function MoAToggle({
  client,
  sessionId,
  running,
  open,
  t,
}: SharedProps & { sessionId: SessionId; running: boolean }) {
  const state = useSelected(client.subscribeModes, () =>
    client.mode(sessionId),
  );
  const moaMode = useSelected(client.store.subscribe, () => {
    const project = client.store
      .all()
      .find(
        (p) =>
          p.project.coordinatorSessionId === sessionId ||
          p.workers.some((w) => w.workerId === sessionId),
      )?.project;
    return project ? `${project.mode}:${project.modeLocked}` : undefined;
  });
  useEffect(() => {
    void client.refreshMode(sessionId);
  }, [client, sessionId, running, moaMode]);
  if (state.value?.role === "worker")
    return (
      <>
        <style>{styles}</style>
        <button
          type="button"
          className="pm-toggle pm-parent"
          onClick={() =>
            state.value?.coordinatorSessionId &&
            open(state.value.coordinatorSessionId)
          }
        >
          {t("parent")}
        </button>
      </>
    );
  const reason = state.value?.toggleBlockedReason;
  if (
    state.value?.enabled &&
    (state.value.modeLocked || running || moaMode === "enabled:true")
  )
    return (
      <span
        className="pm-toggle pm-fixed"
        title={t("blocked.session-mode-locked")}
      >
        {t("moa")}
      </span>
    );
  return (
    <span className="pm-toggle" aria-busy={state.busy}>
      <label title={reason ? t(`blocked.${reason}`) : state.value?.paths?.root}>
        <input
          type="checkbox"
          checked={state.value?.enabled ?? false}
          disabled={state.busy || !state.value?.canToggle}
          onChange={(e) => {
            void client.toggle(sessionId, e.currentTarget.checked);
          }}
        />
        {t("moa")}
      </label>
      {state.busy && <span role="status">{t("enabling")}</span>}
      {state.error && (
        <span role="alert">{t("error", { message: state.error })}</span>
      )}
    </span>
  );
}
