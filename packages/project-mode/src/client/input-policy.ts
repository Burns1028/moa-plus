import type { ComposerSubmissionOverrides } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ProjectClient } from "./runtime.ts";

/** Bind enabled coordinators to the native composer's busy Steer preference. */
export function bindCoordinatorInputPolicy(
  client: ProjectClient,
  submission: ComposerSubmissionOverrides,
  sessions: ObservableSnapshot<Pick<SessionListState, "ids">>,
): () => void {
  if (typeof submission?.register !== "function")
    throw new Error(
      "MoA+ requires the native composer submission compatibility API; apply the approved local DSH compatibility patch before enabling the plugin.",
    );
  const installed = new Map<SessionId, () => void>();
  const reconcile = () => {
    const candidates = new Set([
      ...sessions.getSnapshot().ids,
      ...client.store.projects().map((p) => p.project.coordinatorSessionId),
    ]);
    const enabled = new Set<SessionId>();
    for (const id of candidates) {
      const project = client.store.project(id)?.project,
        mode = client.mode(id).value;
      // Mode responses and stream frames share the durable project revision.
      // A stale catalog must not reverse a newer disable or enable response.
      const active =
        mode && (!project || mode.revision >= project.revision)
          ? mode.role === "coordinator" && mode.enabled
          : project?.mode === "enabled";
      if (active) enabled.add(id);
    }
    for (const [id, restore] of installed) {
      if (enabled.has(id)) continue;
      restore();
      installed.delete(id);
    }
    for (const id of enabled)
      if (!installed.has(id))
        installed.set(id, submission.register(id, "steer"));
  };
  const unsubscribe = [
    client.store.subscribe(reconcile),
    client.subscribeModes(reconcile),
    sessions.subscribe(reconcile),
  ];
  reconcile();
  return () => {
    for (const off of unsubscribe) off();
    for (const restore of installed.values()) restore();
    installed.clear();
  };
}
