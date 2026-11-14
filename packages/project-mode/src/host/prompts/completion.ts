import { moaToolNames as tools } from "../../shared/tool-names.ts";

/** Helper instructions only; original inputs and review state stay with the gate. */
export function buildChecklistInstructions(requirementsJson: string): string {
  return `Derive acceptance criteria using only the original human requirements and supplied source snapshots. Anchor each criterion to a requirement or source passage. Read inputs chronologically: later clarifications supersede conflicting clauses while unaffected requirements remain. Instructions about subsequent actions take effect from arrival unless explicitly retroactive. sourceVersions associates each snapshot with its 1-based requirement position (null for legacy snapshots); sources holds remaining unversioned inputs. Apply each source revision from its associated requirement. Retain every explicit artifact, build and test requirement.

Pre-end scope: current task deliverables. The Host owns inbox, resource exit and final turn closure.

For input with no actionable goal or unfinished requirement, a brief acknowledgement or ordinary clarification is a complete deliverable. Base missing-input limitations on explicitly referenced unavailable snapshots, and record them separately from task-deliverable criteria. Combine duplicate criteria and retain independent obligations.

Submit the Markdown rubric through ${tools.publishChecklist}, your sole tool. Set tests_required true whenever the original requirements or specifications require build or test execution; otherwise false.\n${requirementsJson}`;
}

export function buildDeliveryReviewInstructions(rubricPath: string): string {
  return `Independently verify current deliverables against this rubric. Interpret anchored requirements chronologically: later clarifications supersede conflicts, and instructions about subsequent actions take effect from arrival unless explicitly retroactive.

Pre-end scope: task deliverables available before the parent closes. The Host owns inbox, resource exit and final turn closure.

Judge the requested deliverables. A brief acknowledgement or clarification can satisfy input with no actionable goal or unfinished requirement. Base missing-specification gaps on explicitly referenced unavailable sources and report genuine ambiguity in your verdict.

Read this candidate's complete frozen answer with ${tools.readDelivery} and the current rubric with ${tools.readChecklist}. For a chat deliverable, inspect that answer directly. Use native glob, grep and read for file and directory inspection. Use native Bash or PowerShell when verification requires command execution, and personally run every required build or test. Preserve all explicit artifact and test obligations. Support factual claims with actual inspection or execution results, and establish each rubric obligation before Pass.

Choose checks that establish the requested properties; finish when the evidence is sufficient. Repeat a successful check for a relevant change or an unresolved concern. For each defect, cite its original requirement and an observed counterexample in the deliverable. Diagnose failed validation scripts against that same contract. Report source conflicts as ambiguity and tool/environment limitations as specific verification gaps.

Submit ${tools.submitReview} with status Pass, Partial or Block and a string array of concrete issues (empty for Pass). When protocol and Host prerequisites are satisfied, this submission ends the review. Resolve any returned protocol or evidence gap within this same candidate, then submit a fresh verdict. Rubric file: ${rubricPath}`;
}
