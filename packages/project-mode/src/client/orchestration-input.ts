import type {
  InputTriggerServiceContract,
  InputTriggerSource,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { orchestrationPacks } from "../shared/orchestration.ts";
import type { ProjectClient } from "./runtime.ts";

/** Native @ completions expand to editable text; the native composer still owns sending. */
export function bindOrchestrationInput(
  client: ProjectClient,
  triggers: Pick<InputTriggerServiceContract, "registerSource">,
): () => void {
  const packs = Object.values(orchestrationPacks);
  const names = packs.map((pack) => pack.title);
  const enabled = (id: SessionId) => {
    const project = client.store.project(id)?.project,
      mode = client.mode(id).value;
    return mode && (!project || mode.revision >= project.revision)
      ? mode.role === "coordinator" && mode.enabled
      : project?.mode === "enabled";
  };
  const expansion = (id: SessionId, name: string) => {
    const pack = packs.find((pack) => pack.title === name);
    return enabled(id) && pack ? { text: `${pack.prompt}\n\n` } : undefined;
  };
  const source: InputTriggerSource = {
    trigger: "@",
    name: "MoA+",
    showGroupTitle: false,
    async candidates(session, request) {
      if (!enabled(session.sessionId) || request.quoted || request.drilled)
        return [];
      const query = request.query.toLowerCase();
      return packs
        .filter(
          (pack) =>
            pack.title.toLowerCase().includes(query) ||
            pack.description.toLowerCase().includes(query),
        )
        .map((pack) => ({
          name: pack.title,
          label: pack.title,
          description: pack.description,
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
