import { expect, it } from "vitest";
import { consumedNativeReceipts } from "../../packages/moa/src/host/native-receipt.ts";

const completion = (
  turn: number,
  settledAt: number,
  content: any[] = [{ type: "text", text: "same result" }],
) => ({
  id: `project:worker:${turn * 10}`,
  workerId: "worker",
  workerTurn: turn,
  turnEndSeq: turn * 10,
  assignmentIds: [],
  outcome: "completed" as const,
  settledAt,
  lastAssistant: { messageId: `final-${turn}`, seq: turn * 10 - 1, content },
});
const message = () => ({
  id: "native-message",
  role: "user",
  source: { kind: "subagent-settled", senderSessionId: "worker" },
  content: [
    {
      type: "text",
      text: "Background subagent worker finished and will do no further work unless you send it more.",
    },
    { type: "text", text: "Its closing message:" },
    { type: "text", text: "same result" },
  ],
});
const events = (m = message()) =>
  [
    {
      type: "agent/inbox/spliced",
      seq: 5,
      time: 25,
      data: { target: "next-step", inserted: [m] },
    },
    // Reading is delayed until after another worker turn ended.
    { type: "user/message", seq: 20, time: 60, surfaceOp: "append", data: m },
  ] as any;

it("binds by original native admission, preserving a later turn with identical output", () => {
  const receipts = consumedNativeReceipts(
    [completion(1, 20), completion(2, 40)],
    events(),
  );
  expect([...receipts.keys()]).toEqual(["project:worker:10"]);
  expect(receipts.get("project:worker:10")).toEqual({
    messageId: "native-message",
    seq: 20,
    admissionSeq: 5,
    workerTurnEndSeq: 10,
  });
});

it("does not acknowledge an earlier queued turn with a notice for the activation's last turn", () => {
  const receipts = consumedNativeReceipts(
    [completion(1, 10), completion(2, 20)],
    events(),
  );
  expect([...receipts.keys()]).toEqual(["project:worker:20"]);
});

it("keeps ambiguous or incomplete evidence eligible for full canonical delivery", () => {
  expect(
    consumedNativeReceipts([completion(1, 20), completion(2, 20)], events())
      .size,
  ).toBe(0);
  expect(
    consumedNativeReceipts([completion(1, 20)], events().slice(1)).size,
  ).toBe(0);
  expect(
    consumedNativeReceipts([completion(1, 20)], events().slice(0, 1)).size,
  ).toBe(0);
  const truncated = message();
  truncated.content[2].text = "same";
  expect(
    consumedNativeReceipts([completion(1, 20)], events(truncated)).size,
  ).toBe(0);
  const unrelated = message();
  unrelated.source.senderSessionId = "another-worker";
  expect(
    consumedNativeReceipts([completion(1, 20)], events(unrelated)).size,
  ).toBe(0);
  expect(
    consumedNativeReceipts(
      [{ ...completion(1, 20), outcome: "aborted" }],
      events(),
    ).size,
  ).toBe(0);
});

it("does not substitute native text-only or omitted output for a full worker result", () => {
  const rich = completion(1, 20, [
    { type: "text", text: "same result" },
    { type: "image", source: {} },
  ]);
  expect(consumedNativeReceipts([rich], events()).size).toBe(0);
  const omitted = message();
  omitted.content = [
    omitted.content[0],
    {
      type: "text",
      text: "It sent you a message just before finishing, so its closing message is omitted.",
    },
  ];
  expect(
    consumedNativeReceipts([completion(1, 20)], events(omitted)).size,
  ).toBe(0);
});

it("recognizes the real DeepSeek final text when the assistant also has an internal reasoning block", () => {
  const c = completion(1, 20, [
    { type: "reasoning", text: "internal reasoning" },
    { type: "text", text: "same result" },
  ]);
  expect([...consumedNativeReceipts([c], events()).keys()]).toEqual([c.id]);
});
