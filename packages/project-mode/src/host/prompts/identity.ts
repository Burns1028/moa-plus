import { moaToolNames as tools } from "../../shared/tool-names.ts";
import { isAbsolute } from "node:path";

export interface MoAIdentity {
  id: string;
  workdir: string;
  isolated: boolean;
  reportTo: string;
  reportingInstructions: string;
}

/** Identity is dialogue content; it never personalizes the system prompt. */
export function identityMessage(identity: MoAIdentity): string {
  if (!isAbsolute(identity.workdir))
    throw new Error("project-mode/workdir-not-absolute");
  return `Agent ID: ${identity.id}\nWorkdir: ${identity.workdir} (${identity.isolated ? "Isolated" : "Shared"})\nReport to: ${identity.reportTo}\nReporting instructions: ${identity.reportingInstructions}`;
}

export function workerReportingInstructions(
  contextIndex: string,
  notes: string,
  archived: string,
): string {
  return `Use ${tools.message} to report results and request help when blocked. Shared context index: ${contextIndex}. Read that index before loading relevant context files. Maintain valuable reusable knowledge through ${tools.context}. Notes ${notes} and archive ${archived} are Coordinator-owned and read-only for you.`;
}
