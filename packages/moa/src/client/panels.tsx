import * as React from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import { MenuItemButton } from "@deepseek-ai/dsh-client-ui-primitives";
import { fileAddressFor } from "@deepseek-ai/dsh-util-workspace-path";
import type { MoAClient } from "./runtime.ts";
import { moaRemote } from "./compat.ts";
import { useSelected } from "./hooks.ts";
import { moaForSession } from "./tree.ts";
import { WorkersPanel, type WorkersPanelProps } from "./worker-timeline.tsx";

const WORKERS = "project-mode-workers";
export function registerMoAPanels(
  ctx: Context,
  client: MoAClient,
  open: WorkersPanelProps["open"],
): void {
  const initialized = new Set<string>();
  const shared = () => ({
    client,
    open,
    timeline: moaRemote(ctx.remote).timeline.bind(moaRemote(ctx.remote)),
  });
  ctx.effect(() =>
    ctx.sidebarRightTabs.register({
      id: WORKERS,
      kind: WORKERS,
      keepMounted: true,
      title: () => "Workers",
    }),
  );
  ctx.slots.inject("sidebar.right.pane.tab", () =>
    ctx.slots.register(
      {
        name: "sidebar.right.pane.tab",
        key: WORKERS,
        locale: "project-mode",
        inject: shared,
      },
      WorkersPanel,
    ),
  );
  ctx.slots.inject("conversation.session.header.views.actions", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.views.actions",
        id: "project-mode.open-panels",
        locale: "project-mode",
      },
      function OpenPanels({
        onDismiss,
        t,
      }: PropsRuntime<"conversation.session.header.views.actions"> &
        PropsLocale<"project-mode">) {
        const sessionId = useSelected(
          ctx.sidebarRight.mounted.subscribe,
          ctx.sidebarRight.mounted.getSnapshot,
        );
        const project = useSelected(client.store.subscribe, () =>
          sessionId ? moaForSession(client, sessionId) : undefined,
        );
        if (!sessionId || project?.project.mode !== "enabled") return null;
        return (
          <>
            <MenuItemButton
              onSelect={() => {
                onDismiss();
                ctx.sidebarRight.openTabIn(sessionId, WORKERS);
              }}
            >
              Workers
            </MenuItemButton>
            <MenuItemButton
              onSelect={() => {
                onDismiss();
                ctx.sidebarRight.openResourceIn(
                  sessionId,
                  fileAddressFor(
                    project.project.coordinatorSessionId,
                    project.project.workspacePath,
                    project.project.paths.notes,
                  ),
                );
              }}
            >
              notes.md
            </MenuItemButton>
          </>
        );
      },
    ),
  );
  ctx.slots.inject("conversation.session.header.actions", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.actions",
        id: "project-mode.panels",
      },
      function Defaults({
        sessionId,
        useSession,
      }: PropsRuntime<"conversation.session.header.actions">) {
        const project = useSelected(client.store.subscribe, () =>
          moaForSession(client, sessionId),
        );
        const mounted = useSelected(
          ctx.sidebarRight.mounted.subscribe,
          ctx.sidebarRight.mounted.getSnapshot,
        );
        const openState = useSession((s) => s.openState);
        const types = useSelected(
          (listener) => ctx.sidebarRightTabs.subscribe(listener),
          () => ctx.sidebarRightTabs.entries(),
        );
        React.useEffect(() => {
          if (mounted !== sessionId || project?.project.mode !== "enabled")
            return;
          const marker = `project-mode.panels.v1.${sessionId}`;
          if (initialized.has(marker)) return;
          try {
            if (localStorage.getItem(marker)) return;
          } catch {
            /* In-memory native layout still works. */
          }
          const frame = requestAnimationFrame(() => {
            if (ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return;
            const existing = ctx.sidebarRight.tabsIn(sessionId),
              previous = ctx.sidebarRight.active();
            const guide =
              existing.length === 1 && existing[0].kind === "guide"
                ? existing[0]
                : undefined;
            const notes = fileAddressFor(
              project.project.coordinatorSessionId,
              project.project.workspacePath,
              project.project.paths.notes,
            );
            // File viewers register independently. Wait for their native claim.
            try {
              ctx.sidebarRightTabs.claim(notes);
            } catch {
              return;
            }
            ctx.sidebarRight.openTabIn(
              sessionId,
              WORKERS,
              guide ? { replaceTab: guide.id } : {},
            );
            ctx.sidebarRight.openResourceIn(sessionId, notes);
            const tabs = ctx.sidebarRight.tabsIn(sessionId),
              workers = tabs.find((tab) => tab.kind === WORKERS);
            if (!workers || !tabs.some((tab) => tab.contentId === notes))
              return;
            initialized.add(marker);
            // Preserve an already-open user file; a fresh MoA starts on Workers.
            ctx.sidebarRight.focus(
              previous && !guide ? previous.id : workers.id,
            );
            try {
              localStorage.setItem(marker, "1");
            } catch {
              /* Never block native navigation on storage. */
            }
          });
          return () => cancelAnimationFrame(frame);
        }, [
          project?.project.id,
          project?.project.mode,
          project?.project.paths.notes,
          mounted,
          openState,
          sessionId,
          types,
        ]);
        return null;
      },
    ),
  );
}
