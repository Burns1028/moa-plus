import { moaToolNames as tools } from "../../shared/tool-names.ts";

/** Helper instructions only; original inputs and review state stay with the gate. */
export function buildChecklistInstructions(requirementsJson: string): string {
  return `Independently derive task-deliverable criteria only from the original human requirements and source snapshots below. Anchor each criterion to exact requirement/source passages; never derive standards from implementation output. Read inputs chronologically: later clarifications supersede conflicts while unaffected earlier requirements remain. sourceVersions contains captured documents with each explicit reference's 1-based requirement position (null for legacy snapshots); sources contains remaining unversioned inputs, not duplicate document bodies. Apply revisions from their associated requirement. Instructions about subsequent actions apply from arrival unless explicitly retroactive. Preserve explicit artifact, build and test requirements.

This review runs before the parent turn closes. The Host enforces inbox, resource exit and actual closure. Do not require this review's completed record or the later parent turn/end to already exist as task deliverables.

Without an actionable goal or earlier unfinished concrete requirement, a brief acknowledgement or ordinary chat clarification is a valid deliverable; it need not wait for a new human task. A missing-input limitation requires an explicitly referenced unavailable snapshot; empty source collections alone do not establish missing specifications. Do not fill unavailable inputs from implementation or invent generic testing requirements.

Combine duplicate requirements, retain independent obligations, and add no process, record-keeping or review artifacts absent from the original request. Report unavailable input snapshots as limitations; they do not create new author deliverables.

Submit the Markdown rubric through ${tools.publishChecklist}, your only tool. Set tests_required true whenever original requirements/specs require build or test execution; otherwise false. No file, shell or delegation tools are needed. Plain text does not submit a rubric.\n${requirementsJson}`;
}

export function buildDeliveryReviewInstructions(rubricPath: string): string {
  return `Independently verify actual deliverables against this rubric. Interpret the anchored requirements chronologically: later clarifications supersede conflicting earlier instructions, and instructions about subsequent actions apply from their arrival unless explicitly retroactive.

This is a pre-end review: the parent remains open until the Host enforces inbox, resource exit and closure. Your own completed record and the later parent turn/end cannot already exist here; do not reject deliverables for those later lifecycle events.

Judge only requested deliverables. Without an actionable goal or unfinished concrete requirement, an appropriate acknowledgement or ordinary clarification can pass without another human reply, workspace exploration or shell execution. Do not infer missing specs from an empty sources map or add requirements. Report genuine ambiguity through your verdict instead of blocking on a question to the human.

Use ${tools.readDelivery} to inspect this attempt's frozen final-answer text; earlier candidate reads belong to earlier attempts. For an answer delivered in chat, that text is the actual artifact and does not require a shell merely to inspect it. Prefer native glob, grep and read for file and directory inspection. Use the native shell (Bash or PowerShell) only when the verification responsibility requires command execution, builds or tests, and personally perform required execution. Candidate factual claims still require evidence; claims about files or tests are not evidence. Preserve all explicit artifact and test requirements. A pass requires actual tool-backed inspection. Use ${tools.readChecklist} to read the rubric from disk.

Choose checks that establish the requested properties and stop once those properties have evidence. Repeat a successful check only after a relevant change or for a concrete unresolved concern. Each reported defect needs an anchored requirement and observed counterexample; a suggested improvement is not a failed requirement. A validation-script failure is not by itself an artifact defect: inspect the cause, decoded data types and actual requirement before reporting a mismatch. Preserve the original contract when checking or revising checks. Report conflicting source requirements as ambiguity, not a confident replacement contract. Distinguish a tool/environment limitation from a deliverable error; report a specific unresolved gap instead of adding tests without a purpose.

Finish by calling ${tools.submitReview} with status Pass, Partial or Block and a string array of concrete issues (empty for Pass). This requests native completion: when the protocol and Host prerequisites are satisfied, the review ends without another model response. Otherwise, correct the precise protocol or evidence gap in this same review; submission does not replace inspection or required tests. Rubric file: ${rubricPath}`;
}
