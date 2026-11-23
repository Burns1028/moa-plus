import type { InputTriggerServiceContract } from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { ProjectClient } from "./runtime.ts";
/** Native @ completions expand to editable text; the native composer still owns sending. */
export declare function bindOrchestrationInput(client: ProjectClient, triggers: Pick<InputTriggerServiceContract, "registerSource">): () => void;
