import type {
  InputTriggerServiceContract,
  InputTriggerSource,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import {
  orchestrationPacks,
  type OrchestrationPackId,
} from "../shared/orchestration.ts";
import type { ProjectClient } from "./runtime.ts";

/** Native @ completions expand to editable text; the native composer still owns sending. */
export function bindOrchestrationInput(
  client: ProjectClient,
  triggers: Pick<InputTriggerServiceContract, "registerSource">,
): () => void {
  const names = Object.keys(orchestrationPacks) as OrchestrationPackId[];
  const enabled = (id: SessionId) => {
    const project = client.store.project(id)?.project,
      mode = client.mode(id).value;
    return mode && (!project || mode.revision >= project.revision)
      ? mode.role === "coordinator" && mode.enabled
      : project?.mode === "enabled";
  };
  const expansion = (id: SessionId, name: string) =>
    enabled(id) && Object.hasOwn(orchestrationPacks, name)
      ? {
          text: `${orchestrationPacks[name as OrchestrationPackId].prompt}\n\n`,
        }
      : undefined;
  const source: InputTriggerSource = {
    trigger: "@",
    name: "MoA+",
    showGroupTitle: false,
    async candidates(session, request) {
      if (!enabled(session.sessionId) || request.quoted || request.drilled)
        return [];
      const query = request.query.toLowerCase();
      return names
        .filter((name) => name.includes(query))
        .map((name) => ({
          name,
          label: orchestrationPacks[name].title,
          description: orchestrationPacks[name].description,
          section: "MoA+",
        }));
    },
    onPick: ({ session, candidate }) =>
      expansion(session.sessionId, candidate.name),
    lexicon: (session) => (enabled(session.sessionId) ? names : []),
    subscribeLexicon(session, listener) {
      let previous = enabled(session.sessionId);
      const changed = () => {
        const next = enabled(session.sessionId);
        if (next === previous) return;
        previous = next;
        listener();
      };
      const offStore = client.store.subscribe(changed),
        offModes = client.subscribeModes(changed);
      return () => {
        offStore();
        offModes();
      };
    },
  };
  return triggers.registerSource(source);
}
