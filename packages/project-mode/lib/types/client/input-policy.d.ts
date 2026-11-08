import type { ComposerSubmissionOverrides } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ProjectClient } from "./runtime.ts";
/** Bind enabled coordinators to the native composer's busy Steer preference. */
export declare function bindCoordinatorInputPolicy(client: ProjectClient, submission: ComposerSubmissionOverrides, sessions: ObservableSnapshot<Pick<SessionListState, "ids">>): () => void;
