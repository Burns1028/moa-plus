import { isVisibleWorker } from "../shared/worker-membership.ts";
import * as React from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionTarget } from "@deepseek-ai/dsh-api-session-controller/client";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { MoAClient } from "./runtime.ts";
import { useSelected } from "./hooks.ts";
import { WorkerIcon } from "./worker-icon.tsx";

type BranchProps = PropsRuntime<"sidebar.workspaces.session.branch"> &
  PropsLocale<"project-mode"> & {
    matched: { coordinator: true };
    client: MoAClient;
    open: (target: SessionTarget) => void;
  };

function savedExpansion(id: string): boolean {
  try {
    const own = localStorage.getItem(`project-mode.branch:${id}`);
    return own === null
      ? JSON.parse(localStorage.getItem("project-mode.expansion") ?? "{}")[
          id
        ] === true
      : own === "true";
  } catch {
    return false;
  }
}

/** Add only the disclosure and children; DSH renders every row and the browser. */
export function MoABranch(p: BranchProps) {
  const archived = p.useWorkspaces((state) => state.archivedSessionIds);
  const workers = useSelected(p.client.store.subscribe, () =>
    (p.client.store.get(p.sessionId)?.workers ?? [])
      .filter((w) => isVisibleWorker(w) && !archived.includes(w.workerId))
      .map(({ workerId, name, phase }) => ({ workerId, name, phase })),
  );
  const [expanded, setExpanded] = React.useState(() =>
    savedExpansion(p.sessionId),
  );
  const selectedChild = workers.find(
    (w) => w.workerId === p.currentSessionId,
  )?.workerId;
  React.useEffect(() => {
    if (selectedChild) setExpanded(true);
  }, [selectedChild]);
  const groupId = React.useId();
  if (archived.includes(p.sessionId) || !workers.length) return p.renderRow();
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(`project-mode.branch:${p.sessionId}`, String(next));
    } catch {}
  };
  return (
    <div className="pm-project-branch">
      <style>{`
        .pm-project-branch{display:contents}
        .pm-project-branch [data-row-key]>span:first-child{width:16px!important}
        .pm-worker-branch>[role=treeitem]>span:first-child{width:16px!important}
        .pm-project-branch [data-row-key]>span:nth-child(2):has(>[data-slot="sidebar.session.row.leading"]:empty){display:none}
        .pm-project-branch:has([data-row-key]>span:nth-child(2)>[data-slot="sidebar.session.row.leading"]:empty)>.pm-worker-branch>[role=treeitem]>span:first-child{display:none!important}

        .pm-branch-toggle{display:flex;align-items:center;justify-content:center;width:12px;height:20px;padding:0;border:0;background:none;color:inherit;cursor:pointer;flex:none}
        .pm-branch-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-radius:3px}
        .pm-worker-branch{display:flex;flex-direction:column;gap:2px;margin-top:2px}
        .pm-worker-branch .pm-worker-icon{width:16px;height:16px;display:block;flex:none}
        .pm-worker-identity{position:relative;display:inline-flex;width:16px;height:16px;flex:none}
        .pm-worker-identity .pm-worker-running{position:absolute;inset:-3px;pointer-events:none}
      `}</style>
      {p.renderRow(
        <button
          type="button"
          className="pm-branch-toggle"
          aria-label={p.t(expanded ? "collapse" : "expand", {
            name: p.t("workers"),
          })}
          aria-expanded={expanded}
          aria-controls={groupId}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden="true"
            focusable="false"
            style={{ transform: expanded ? "rotate(90deg)" : undefined }}
          >
            <path
              d="m3.5 2 3 3-3 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>,
      )}
      {expanded && (
        <div
          className="pm-worker-branch"
          role="group"
          id={groupId}
          aria-label={p.t("workers")}
        >
          {workers.map((w) => (
            <React.Fragment key={w.workerId}>
              {p.renderChild({
                sessionId: w.workerId,
                title: w.name,
                icon: (
                  <span className="pm-worker-identity">
                    <WorkerIcon workerId={w.workerId} />
                    {(w.phase === "working" || w.phase === "starting") && (
                      <StateDot
                        state="ongoing"
                        size={22}
                        className="pm-worker-running"
                      />
                    )}
                  </span>
                ),
                trailing: p.t(w.phase),
                selected: p.currentSessionId === w.workerId,
                onOpen: () =>
                  p.open({
                    parentSessionId: p.sessionId,
                    childSessionId: w.workerId,
                    mode: "continuable",
                  }),
              })}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** Capture immutable routing facts; a selector never reads an external store. */
export function bindMoABranches(
  ctx: Context,
  client: MoAClient,
  open: BranchProps["open"],
): () => void {
  let key: string | undefined;
  let remove = () => {};
  const reconcile = () => {
    const ids = client.store
      .all()
      .filter((p) => p.workers.some((w) => isVisibleWorker(w)))
      .map((p) => p.project.coordinatorSessionId)
      .sort();
    const next = JSON.stringify(ids);
    if (key === next) return;
    key = next;
    remove();
    const eligible = new Set(ids);
    remove = ctx.slots.register(
      {
        name: "sidebar.workspaces.session.branch",
        priority: -10,
        locale: "project-mode",
        select: (owner) =>
          eligible.has(owner.sessionId) ? { coordinator: true as const } : null,
        inject: () => ({ client, open }),
      },
      (props: BranchProps) => <MoABranch {...props} />,
    );
  };
  reconcile();
  const stop = client.store.subscribe(reconcile);
  return () => {
    stop();
    remove();
  };
}
