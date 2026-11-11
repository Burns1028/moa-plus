import * as React from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type {
  PropsRuntime,
  PropsLocale,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId, SessionSeq } from "@deepseek-ai/dsh-session/types";
import type { SessionFace } from "@deepseek-ai/dsh-api-session-controller/client";
import projectModeRemote from "../../lib/typert.remote-client.js";
import { ProjectClient } from "./runtime.ts";
import { bindCoordinatorInputPolicy } from "./input-policy.ts";
import { bindOrchestrationInput } from "./orchestration-input.ts";
import { bindWorkerParents } from "./worker-parent.ts";
import { registerProjectPanels } from "./panels.tsx";
import {
  humanBoundaryDefinition,
  workerTailDefinition,
  segmentTail,
  segmentHistoryTarget,
} from "./tail.ts";
import {
  ProjectToggle,
  WorkerCapsuleList,
  type SharedProps,
} from "./components.tsx";
import { bindProjectBranches } from "./branch.tsx";
import { workerReadOnly, composerMatch } from "./tree.ts";
import { en, zh } from "./locales.ts";
import { styles } from "./styles.ts";
import { useSelected } from "./hooks.ts";
import { AgentMessage } from "./agent-message.tsx";
export const inject = [
  "remote",
  "sessions",
  "workspaces",
  "uiWorkspace",
  "uiConversation",
  "conversation",
  "slots",
  "locale",
];
export async function apply(ctx: Context) {
  // $mount owns its contribution as an effect on this parent context. The
  // namespace is a separate Cordis service; consumers need an injected child
  // so namespace withdrawal also releases their UI, listeners and streams.
  await ctx.remote.$mount(projectModeRemote);
  await ctx.inject(["remote.projectMode"], applyProjectClient);
}
function applyProjectClient(ctx: Context) {
  const client = new ProjectClient(ctx.remote.projectMode);
  const open = (target: Parameters<Context["uiWorkspace"]["openSession"]>[0]) =>
    ctx.uiWorkspace.openSession(target);
  ctx.effect(() => () => client.dispose());
  ctx.inject(["sidebarRight", "sidebarRightTabs"], (scope) =>
    registerProjectPanels(scope, client, open),
  );
  ctx.effect(() => bindWorkerParents(client, ctx.sessions));
  ctx.inject(["inputTriggers"], (scope) => {
    scope.effect(() => bindOrchestrationInput(client, scope.inputTriggers));
  });
  const historyLoads = new WeakMap<SessionFace, Set<number>>();
  let disposed = false;
  ctx.effect(() => () => {
    disposed = true;
  });
  const loadSegmentHistory = (id: SessionId, target: number) => {
    if (disposed) return false;
    const session = ctx.sessions.binding(id)?.session;
    if (!session) return false;
    const state = session.getSnapshot();
    if (state.openState !== "open" || state.loadingOlder) return false;
    const pending = historyLoads.get(session) ?? new Set<number>();
    if (pending.has(target)) return true;
    historyLoads.set(session, pending);
    pending.add(target);
    try {
      // Native Session owns paging, shared jump targets, and error state. A
      // rejected transport must not escape this detached rendering request.
      void session
        .loadThrough(target as SessionSeq)
        .catch(() => {})
        .finally(() => pending.delete(target));
    } catch {
      pending.delete(target);
    }
    return true;
  };
  ctx.effect(() =>
    bindCoordinatorInputPolicy(
      client,
      ctx.conversation.submission,
      ctx.sessions.list,
    ),
  );
  ctx.effect(() => ctx.locale.register("project-mode", { en, zh }));
  ctx.effect(() => ctx.uiConversation.events.register(humanBoundaryDefinition));
  ctx.effect(() => ctx.uiConversation.events.register(workerTailDefinition));
  const refreshRoots = () => {
    const list = ctx.sessions.list.getSnapshot();
    for (const row of Object.values(list.byId))
      if (
        (row.retainedBy.mainView ?? 0) > 0 &&
        ctx.sessions.subagentAddress(row.id)
      )
        void client.refreshMode(row.id);
    client.watchRoots(
      list.ids.filter((id) => list.byId[id]?.origin !== "subagent"),
    );
  };
  ctx.effect(() => {
    refreshRoots();
    return ctx.sessions.list.subscribe(refreshRoots);
  });
  ctx.on("connection/reset", () => client.reconnect());
  void client.loadCatalog();
  const shared = () => ({ client, open });
  ctx.slots.inject("conversation.input.left", () =>
    ctx.slots.register(
      {
        name: "conversation.input.left",
        id: "project-mode.toggle",
        order: 5,
        locale: "project-mode",
        inject: shared,
      },
      (
        p: PropsRuntime<"conversation.input.left"> &
          PropsLocale<"project-mode"> &
          Omit<SharedProps, "t">,
      ) => (
        <>
          <style>{styles}</style>
          <ProjectToggle {...p} running={p.useSession((s) => s.running)} />
        </>
      ),
    ),
  );
  ctx.slots.inject("conversation.chat.node", () =>
    ctx.slots.register(
      {
        name: "conversation.chat.node",
        key: "project-mode-workers-tail",
        locale: "project-mode",
        inject: shared,
      },
      (
        p: PropsRuntime<"conversation.chat.node", "project-mode-workers-tail"> &
          Omit<SharedProps, "t"> &
          PropsLocale<"project-mode">,
      ) => {
        const memberships = useSelected(
          client.store.subscribe,
          () => client.store.project(p.sessionId)?.turnMemberships ?? [],
        );
        const historyTarget = p.useChat((s) =>
          segmentHistoryTarget(s, p.node, memberships),
        );
        const historyReady = p.useSession(
          (s) => s.openState === "open" && !s.loadingOlder,
        );
        const historyAttempt = React.useRef<{
          id: SessionId;
          target: number;
        }>();
        React.useEffect(() => {
          if (typeof historyTarget !== "number") {
            historyAttempt.current = undefined;
            return;
          }
          if (
            !historyReady ||
            (historyAttempt.current?.id === p.sessionId &&
              historyAttempt.current.target === historyTarget)
          )
            return;
          // A plain native page can block loadThrough with a resolved no-op.
          // Retry when that page settles, but never loop on our own failure.
          if (loadSegmentHistory(p.sessionId, historyTarget))
            historyAttempt.current = {
              id: p.sessionId,
              target: historyTarget,
            };
        }, [p.sessionId, historyTarget, historyReady]);
        const closed = p.useChat(
          (s) => s.timeline.turns.get(p.node.data.turn)?.end !== undefined,
        );
        const settled = p.useChat((s) => {
          const reason = s.timeline.turns.get(p.node.data.turn)?.end?.data.reason.kind;
          return reason === "completed" || reason === "handoff";
        });
        const selected = p.useChat((s) => segmentTail(s, p.node) !== null);
        return (
          <>
            {p.node.data.incoming && <AgentMessage {...p} message={p.node.data.incoming} settled={settled} />}
            {selected && <WorkerCapsuleList
              {...p}
              turn={p.node.data.turn}
              segmentStartSeq={p.node.data.segmentStartSeq}
              closed={closed}
            />}
          </>
        );
      },
    ),
  );
  ctx.slots.inject("sidebar.workspaces.session.branch", () =>
    bindProjectBranches(ctx, client, open),
  );
  // Selectors are synchronous owner-only functions. Changing the set of
  // readonly workers re-registers only this chain entry so native election
  // observes metadata frames even without another Session event.
  ctx.slots.inject("conversation.composer", () => {
    let previous: string | undefined,
      dispose = () => {};
    const reconcile = () => {
      const readonly = client.store.projects().flatMap((p) =>
        p.workers.flatMap((w) => {
          const match = workerReadOnly([p], w.workerId);
          return match ? [{ id: w.workerId, ...match }] : [];
        }),
      );
      const membership = client.store.projects().map((p) => ({
        parent: p.project.coordinatorSessionId,
        mode: p.project.mode,
        workers: p.workers.map((w) => w.workerId),
      }));
      const key = JSON.stringify([readonly, membership, client.modeVersion]);
      if (key === previous) return;
      previous = key;
      dispose();
      dispose = ctx.slots.register(
        {
          name: "conversation.composer",
          priority: -20,
          locale: "project-mode",
          select: (owner) => composerMatch(owner, client),
          inject: shared,
        },
        (
          p: PropsRuntime<"conversation.composer"> &
            PropsLocale<"project-mode"> &
            Omit<SharedProps, "t"> & {
              matched: {
                id: SessionId;
                parent: SessionId;
                reason: "deleted" | "disabled";
              };
            },
        ) => (
          <div className="pm-readonly">
            <style>{styles}</style>
            <p>
              {p.t(
                p.matched.reason === "deleted"
                  ? "readonlyDeleted"
                  : "readonlyDisabled",
              )}
            </p>
            <button type="button" onClick={() => p.open(p.matched.parent)}>
              {p.t("parent")}
            </button>
          </div>
        ),
      );
    };
    reconcile();
    const stop = client.store.subscribe(reconcile),
      stopModes = client.subscribeModes(reconcile);
    return () => {
      stop();
      stopModes();
      dispose();
    };
  });
}
