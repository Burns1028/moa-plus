import * as React from "react";
import { createPortal } from "react-dom";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionSnapshot } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ChatNode, ChatSnapshot } from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { Button, IconCloseOutlineRegular, MenuItemButton, useAnchoredPosition } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { isVisibleWorker } from "../shared/worker-membership.ts";
import { ProjectToggle, type SharedProps } from "./components.tsx";
import { useSelected } from "./hooks.ts";
import type { ProjectKey } from "./locales.ts";
import type { ProjectClient } from "./runtime.ts";

const progressKey = "project-mode.first-run-guide";
const finished = "finished";

function canStartGuide(session: SessionSnapshot): boolean {
  return session.openState === "open" && session.blank && !session.running && !session.subagent;
}

function firstCompletedTaskTurn(chat: ChatSnapshot): number | undefined {
  let firstInput = Infinity;
  for (const node of chat.nodes.values()) {
    if (node.kind !== "user") continue;
    const { source, seq } = (node as ChatNode<"user">).data;
    if (source && typeof source === "object" && "kind" in source && source.kind === "user")
      firstInput = Math.min(firstInput, seq);
  }
  for (const turn of chat.timeline.turnOrder) {
    const end = chat.timeline.turns.get(turn)?.end;
    if (end?.data.reason.kind === "completed" && end.seq > firstInput) return turn;
  }
}

function TypedLine({ text }: { text: string }) {
  const characters = React.useMemo(() => Array.from(text), [text]);
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setCount(characters.length);
      return;
    }
    let cursor = 0;
    const timer = window.setInterval(() => {
      cursor += 1;
      setCount(cursor);
      if (cursor >= characters.length) window.clearInterval(timer);
    }, 22);
    return () => window.clearInterval(timer);
  }, [characters]);

  return (
    <span className="pm-guide-line" role="status">
      <span className="pm-guide-readable">{text}</span>
      <span className="pm-guide-measure" aria-hidden="true">{text}</span>
      <span className="pm-guide-typed" aria-hidden="true">
        {characters.slice(0, count).join("")}
        {count < characters.length && <span className="pm-guide-caret" />}
      </span>
    </span>
  );
}

const copy = {
  example: "guideExample",
  send: "guideSend",
  workers: "guideWorkers",
  result: "guideResult",
} as const satisfies Record<string, ProjectKey>;

export function registerFirstRunGuide(ctx: Context, client: ProjectClient) {
  let progress: string | null = null;
  try {
    progress = localStorage.getItem(progressKey);
  } catch {
    // Keep progress in memory when the client profile cannot write storage.
  }
  let result: { sessionId: SessionId; workerCount: number } | undefined;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const notify = () => { for (const listener of listeners) listener(); };
  const clearResult = (sessionId: SessionId) => {
    if (result?.sessionId !== sessionId) return;
    result = undefined;
    notify();
  };
  const save = (next: string | null) => {
    progress = next;
    try {
      if (next === null) localStorage.removeItem(progressKey);
      else localStorage.setItem(progressKey, next);
    } catch {
      // The current client still keeps its progress.
    }
    notify();
  };
  const dismiss = () => {
    result = undefined;
    save(finished);
  };

  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register(
    { name: "conversation.input.dock", id: "project-mode.first-run-guide", locale: "project-mode" },
    function FirstRunBubble({
      sessionId, session, input, useChat, t,
    }: PropsRuntime<"conversation.input.dock"> & PropsLocale<"project-mode">) {
      const current = useSelected(subscribe, () => progress);
      const workerCount = useSelected(subscribe, () =>
        result?.sessionId === sessionId ? result.workerCount : undefined,
      );
      const mode = useSelected(client.subscribeModes, () => client.mode(sessionId).value);
      const workers = useSelected(client.store.subscribe, () =>
        current === sessionId && client.store.project(sessionId)?.workers.some(worker => worker.lifecycle === "active"),
      );
      const candidate = canStartGuide(session) && mode?.canToggle;
      const completedTurn = useChat(chat =>
        current === sessionId && mode?.enabled ? firstCompletedTaskTurn(chat) : undefined,
      );

      React.useEffect(() => {
        if (candidate && mode?.enabled && progress === null) save(sessionId);
        if (candidate && !mode?.enabled && progress === sessionId) save(null);
      }, [candidate, current, mode?.enabled, sessionId]);
      React.useEffect(() => {
        if (progress !== sessionId || completedTurn === undefined) return;
        const project = client.store.project(sessionId);
        const participants = new Set(project?.turnMemberships
          .filter(member => member.coordinatorTurn === completedTurn)
          .map(member => member.workerId));
        result = {
          sessionId,
          workerCount: project?.workers.filter(worker =>
            participants.has(worker.workerId) && isVisibleWorker(worker),
          ).length ?? 0,
        };
        save(finished);
      }, [sessionId, completedTurn]);
      React.useEffect(() => () => clearResult(sessionId), [sessionId]);
      React.useEffect(() => {
        if (session.running) clearResult(sessionId);
      }, [sessionId, session.running]);

      let stage: keyof typeof copy | undefined;
      const empty = input.draft === "" && input.attachmentIds.length === 0 && input.phase === "plain";
      if (workerCount !== undefined && !session.running) stage = "result";
      else if (current === sessionId && session.running && workers) stage = "workers";
      else if (candidate && mode?.enabled && (current === null || current === sessionId))
        stage = empty ? "example" : "send";
      if (!stage) return null;

      let message = t(copy[stage]);
      if (stage === "result" && workerCount !== undefined) {
        if (workerCount === 1) message = t("guideResultOneWorker");
        if (workerCount > 1) message = t("guideResultWorkers", { count: workerCount });
      }
      return (
        <div className="pm-first-guide" data-guide-stage={stage} key={stage}>
          <TypedLine key={message} text={message} />
          <div className="pm-guide-actions">
            {stage === "example" && (
              <Button type="button" size="sm" variant="outline" onClick={() => {
                const binding = ctx.sessions.binding(sessionId);
                if (binding) ctx.conversation.input.requestDraftInitialization(binding, {
                  prompt: t("guideExamplePrompt"),
                  whenDraftExists: "keep",
                });
              }}>{t("guideFill")}</Button>
            )}
            <Button type="button" size="sm" onClick={dismiss}>
              {t(stage === "result" ? "guideDone" : "guideSkip")}
            </Button>
          </div>
        </div>
      );
    },
  ));

  ctx.inject(["sidebarRight"], (scope) => {
    scope.slots.inject("sidebar.panellist.actions", () => scope.slots.register(
      { name: "sidebar.panellist.actions", id: "project-mode.reopen-first-run-guide", locale: "project-mode" },
      function ReopenGuide({ onDismiss, t }:
        PropsRuntime<"sidebar.panellist.actions"> & PropsLocale<"project-mode">) {
        const id = useSelected(scope.sidebarRight.mounted.subscribe, scope.sidebarRight.mounted.getSnapshot);
        const session = id ? scope.sessions.binding(id)?.session : undefined;
        const canReplay = useSelected(
          (listener) => session?.subscribe(listener) ?? (() => {}),
          () => {
            const state = session?.getSnapshot();
            return !!state?.blank && !state.running && !state.subagent;
          },
        );
        if (!canReplay) return null;
        return <MenuItemButton onSelect={() => {
          result = undefined;
          save(null);
          onDismiss();
        }}>{t("guideMenu")}</MenuItemButton>;
      },
    ));
  });

  return function GuidedProjectToggle(p:
    PropsRuntime<"conversation.input.left"> & PropsLocale<"project-mode"> & Omit<SharedProps, "t">) {
    const { sessionId, useSession, useInput, t } = p;
    const blank = useSession(canStartGuide);
    const running = useSession(session => session.running);
    const empty = useInput(input => input.draft === "" && input.attachmentIds.length === 0 && input.phase === "plain");
    const mode = useSelected(client.subscribeModes, () => client.mode(sessionId));
    const current = useSelected(subscribe, () => progress);
    const open = current === null && blank && empty && !mode.busy &&
      mode.value?.canToggle === true && !mode.value.enabled;
    const anchorRef = React.useRef<HTMLButtonElement>(null);
    const panelRef = React.useRef<HTMLDivElement>(null);
    const descriptionId = React.useId();
    const position = useAnchoredPosition({ open, anchorRef, panelRef, side: "top", gap: 8, margin: 12 });
    return <>
      <ProjectToggle {...p} running={running} buttonRef={anchorRef} guideDescriptionId={open ? descriptionId : undefined} />
      {open && createPortal(
        <div ref={panelRef} className="pm-first-guide pm-guide-by-toggle" data-guide-stage="enable"
          style={position ?? { visibility: "hidden" }}>
          <div id={descriptionId} className="pm-guide-description"><TypedLine text={t("guideEnable")} /></div>
          <Button type="button" size="sm" aria-label={t("guideClose")} onClick={dismiss}
            icon={<IconCloseOutlineRegular aria-hidden="true" />} />
        </div>,
        document.body,
      )}
    </>;
  };
}
