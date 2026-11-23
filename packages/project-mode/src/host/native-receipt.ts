import { isDeepStrictEqual } from "node:util";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { Completion, NativeReceipt } from "./state.ts";

/**
 * rc.3 native notices have no child turn ID. Bind a committed notice to the
 * unique last child turn finished at its ORIGINAL inbox admission, then verify
 * the complete native payload. Never use consumption time or text similarity
 * to select a turn; queued notices can be read after another turn finishes.
 */
export function consumedNativeReceipts(
  completions: readonly Completion[],
  events: readonly SessionEvent[],
): Map<string, NativeReceipt> {
  const admissions = new Map<string, { seq: number; time: number }>();
  for (const e of events)
    if (e.type === "agent/inbox/spliced")
      for (const message of e.data.inserted ?? [])
        if (!admissions.has(message.id))
          admissions.set(message.id, { seq: e.seq, time: e.time });
  const receipts = new Map<string, NativeReceipt>();
  for (const e of events) {
    if (e.type !== "user/message" || e.surfaceOp !== "append") continue;
    const source = e.data.source;
    if (source.kind !== "subagent-settled") continue;
    const admission = admissions.get(e.data.id);
    if (!admission || admission.seq >= e.seq) continue;
    const candidates = completions.filter(
      (c) =>
        c.workerId === source.senderSessionId && c.settledAt <= admission.time,
    );
    const lastTime = Math.max(...candidates.map((c) => c.settledAt));
    const latest = candidates.filter((c) => c.settledAt === lastTime);
    if (latest.length !== 1) continue;
    const completion = latest[0];
    const blocks = completion.lastAssistant?.content;
    // Internal reasoning is not a closing answer in the native contract. Keep
    // it in Completion, but require every deliverable block (including media)
    // to have been received; native text-only notices cannot acknowledge media.
    if (
      !blocks?.length ||
      blocks.some((b) => b.type !== "text" && b.type !== "reasoning")
    )
      continue;
    const closing = blocks.filter(
      (b) => b.type === "text" && b.text.length > 0,
    );
    if (!closing.length) continue;
    const subject = `Background subagent ${completion.workerId}`;
    const endings = {
      completed:
        "finished and will do no further work unless you send it more.",
      aborted: "was stopped before it finished.",
      error: "failed before it finished.",
      "max-tokens": "ran out of room before it finished.",
      refusal: "declined the task.",
    };
    const expected = [
      { type: "text", text: `${subject} ${endings[completion.outcome]}` },
      { type: "text", text: "Its closing message:" },
      ...closing,
    ];
    if (!isDeepStrictEqual(e.data.content, expected)) continue;
    if (!receipts.has(completion.id))
      receipts.set(completion.id, {
        messageId: e.data.id,
        seq: e.seq,
        admissionSeq: admission.seq,
        workerTurnEndSeq: completion.turnEndSeq,
      });
  }
  return receipts;
}
