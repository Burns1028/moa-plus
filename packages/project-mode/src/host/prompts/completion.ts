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

Work through this attempt in order:

1. Read the authoritative rubric from disk with ${tools.readChecklist} and this attempt's frozen final answer with ${tools.readDelivery}. Earlier candidate reads belong to earlier attempts. The frozen text is the actual artifact for a chat answer; claims about files or tests still require independent evidence. Judge requested deliverables only. An acknowledgement or ordinary clarification can satisfy a request with no actionable goal or unfinished concrete requirement. Empty source collections do not establish missing specifications.

2. Turn each rubric obligation into an acceptance question and identify the tool evidence needed to answer it. Keep this working state within the review; it is not another deliverable. Prefer native glob, grep and read for inspection. Use native Bash or PowerShell only when the acceptance question requires execution; personally perform every required command, build or test. A passing test suite does not establish unrelated artifact requirements, and candidate claims do not replace inspection. Initial necessary checks need no prior failure.

3. Use each result to resolve the corresponding question. Before any additional check, identify which still-unresolved rubric question it can answer and how its result could change the verdict. Check only that gap. Reuse sufficient evidence from this attempt; repeat a successful check after a relevant change or when a specific unanswered contract property needs it. Git/history, version checks and broader exploration need the same connection to a remaining question. General uncertainty or an optional improvement does not reopen a supported requirement. A validation-script failure alone is not an artifact defect: check its cause, decoded data types and the original contract. Report a defect with an anchored requirement and observed counterexample; report conflicting sources as ambiguity. Preserve the contract when revising checks.

4. Once every rubric obligation has sufficient evidence, immediately call ${tools.submitReview} with Pass and an empty issues array. If a concrete obligation fails, or relevant available checks cannot establish it, submit Partial or Block with the anchored defect, ambiguity or missing evidence; do not replace the verdict with open-ended investigation or a question to the human. Distinguish a tool/environment limitation from a deliverable error, setting runtime_blocked only when an unavailable runtime capability prevents verification. Submission ends this review without another model response. It does not replace actual inspection or required successful execution. Rubric file: ${rubricPath}`;
}
