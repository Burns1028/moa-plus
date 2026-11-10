// @vitest-environment jsdom
import { Context } from "@deepseek-ai/cordis";
import { afterEach, expect, it, vi } from "vitest";
import type * as Trigger from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { InputTriggerSource } from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { SessionModeView } from "../../packages/project-mode/src/shared/index.ts";
import { ProjectClient } from "../../packages/project-mode/src/client/runtime.ts";
import { bindOrchestrationInput } from "../../packages/project-mode/src/client/orchestration-input.ts";
import { orchestrationPacks } from "../../packages/project-mode/src/shared/orchestration.ts";
import { nativeLoader } from "../client/native-loader.ts";
import { sid, snapshot } from "../client/fixture.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose();
  delete (window as any).__ModuleLoader__;
});

/** Real rc.3 trigger controller → scoped text-insert event → real Lexical composer shell. */
function bench(
  sessionId = "parent",
  fileCandidates: InputTriggerSource["candidates"] = async () => [
    { name: "report.md", icon: "file" },
  ],
) {
  const load = nativeLoader();
  load("@deepseek-ai/dsh-client-ui-renderer");
  const {
    __test: { SessionInputShell },
  } = load<any>("@deepseek-ai/dsh-client-ui-conversation", (source) =>
    source.replace(
      "exports.apply = apply;",
      "exports.__test = { SessionInputShell }; exports.apply = apply;",
    ),
  );
  const { InputTriggerController } = load<typeof Trigger>(
    "@deepseek-ai/dsh-client-ui-input-trigger",
  );
  const ctx = new Context();
  cleanups.push(() => ctx.fiber.dispose());
  const modes = new Map<string, SessionModeView>();
  const client = new ProjectClient({
    mode: vi.fn(async (id: string) => ({ ok: true, value: modes.get(id)! })),
  } as any);
  client.store.accept(snapshot());
  cleanups.push(() => client.dispose());
  const sources: InputTriggerSource[] = [
    {
      trigger: "@",
      name: "reference",
      candidates: fileCandidates,
      onPick: () => ({
        insert: {
          source: "reference",
          ref: "@report.md",
          label: "report.md",
          appearance: "file",
          clipboardText: "@report.md",
        },
      }),
      codec: {
        clipboardText: (ref) => ref,
        serialize: async (ref) => `<file>${ref}</file>`,
      },
    },
  ];
  cleanups.push(
    bindOrchestrationInput(client, {
      registerSource: (source) => {
        sources.push(source);
        return () => {
          sources.splice(sources.indexOf(source), 1);
        };
      },
    }),
  );
  const controller = new InputTriggerController({
    actx: ctx,
    sessionId: sid(sessionId),
    roster: {
      sources: (trigger) =>
        sources.filter((source) => source.trigger === trigger),
      all: () => sources,
    },
  });
  cleanups.push(() => controller.dispose());
  const sink = vi.fn(async () => ({ kind: "success" }));
  const shell = new SessionInputShell({
    actx: ctx,
    inputTriggers: () => controller,
    defaultSink: sink,
    commandAttachments: {
      serialize: vi.fn(),
      release: vi.fn(),
      unsupportedNotice: vi.fn(),
    },
  });
  cleanups.push(() => {
    shell.dispose();
  });
  ctx.on("slash/input-insert-text", (request) =>
    shell.insertText(request.text, request.span, request.continue === true)
      ? true
      : undefined,
  );
  ctx.on("slash/input-insert-reference", (request) =>
    shell.insertReference(request.reference, request.span) ? true : undefined,
  );
  const ready = async (source: string, name: string) => {
    await vi.waitFor(() =>
      expect(
        controller.menu
          .getSnapshot()
          .groups.find((group) => group.source === source)
          ?.items.some((item) => item.name === name),
      ).toBe(true),
    );
    return controller.menu
      .getSnapshot()
      .groups.find((group) => group.source === source)!
      .items.findIndex((item) => item.name === name);
  };
  return { controller, shell, sink, ready, sources, client, modes };
}

it.each([
  ["queue", "click"],
  ["steer", "enter"],
  ["queue", "tab"],
] as const)(
  "keeps file references and attachment receipts intact through native %s submission after %s selection",
  async (delivery, selection) => {
    const b = bench();
    b.shell.setDraft("Use @report");
    b.controller.pick("reference", await b.ready("reference", "report.md"));
    const file = b.shell.draftSnapshot.references[0];
    expect(file).toMatchObject({ source: "reference", ref: "@report.md" });
    b.shell.paste("\n@fan-out");
    b.shell.addAttachments(["image-draft", "file-receipt-draft"]);
    const packIndex = await b.ready("MoA+", "fan-out");
    if (selection !== "click") {
      b.controller.hover("MoA+", packIndex);
      expect(b.shell.arbitrate(selection, false)).toBe("pick-highlighted");
    } else b.controller.pick("MoA+", packIndex);
    expect(b.shell.snapshot.draft).toContain(
      orchestrationPacks["fan-out"].prompt,
    );
    expect(b.shell.draftSnapshot.references).toEqual([file]);
    expect(b.shell.snapshot.attachmentIds).toEqual([
      "image-draft",
      "file-receipt-draft",
    ]);
    expect(b.sink).not.toHaveBeenCalled();
    b.shell.submit(delivery);
    await vi.waitFor(() => expect(b.sink).toHaveBeenCalledOnce());
    expect(b.sink).toHaveBeenCalledWith(
      expect.stringContaining("<file>@report.md</file>"),
      ["image-draft", "file-receipt-draft"],
      delivery,
      expect.any(AbortSignal),
    );
    expect(b.sink.mock.calls[0]![0]).toContain(
      orchestrationPacks["fan-out"].prompt,
    );
  },
);

it.each([
  ["@fan-out", " task"],
  ['@"fan-out', ' report.md"'],
])(
  "keeps Space as ordinary text after %s through the native shell",
  async (prefix, suffix) => {
    const b = bench();
    b.shell.setDraft(prefix);
    expect(b.shell.space()).toBe(false);
    expect(b.shell.snapshot.draft).toBe(prefix);
    // The editor inserts the ordinary space when the shell declines to consume it.
    b.shell.paste(suffix);
    const text = `${prefix}${suffix}`;
    expect(b.shell.snapshot.draft).toBe(text);
    expect(b.shell.space()).toBe(false);
    b.shell.submit("queue");
    await vi.waitFor(() => expect(b.sink).toHaveBeenCalledOnce());
    expect(b.sink).toHaveBeenCalledWith(
      text,
      [],
      "queue",
      expect.any(AbortSignal),
    );
  },
);

it.each(["parent", "ordinary"])(
  "keeps a pending native file lookup alive in %s across unrelated MoA updates",
  async (sessionId) => {
    const pending = Promise.withResolvers<[]>();
    const signals: AbortSignal[] = [];
    const candidates = vi.fn((_session, request) => {
      signals.push(request.signal);
      return pending.promise;
    });
    const b = bench(sessionId, candidates);
    b.shell.setDraft("@report");
    expect(candidates).toHaveBeenCalledOnce();
    const signal = signals[0]!;
    b.client.store.accept({
      ...snapshot(),
      workers: [
        { ...snapshot().workers[0]!, progressText: "New live progress" },
      ],
    });
    b.modes.set("other", {
      sessionId: sid("other"),
      role: "coordinator",
      enabled: false,
      revision: 2,
      canToggle: true,
    });
    await b.client.refreshMode(sid("other"));
    b.modes.set("parent", {
      sessionId: sid("parent"),
      role: "coordinator",
      enabled: true,
      revision: 2,
      canToggle: true,
    });
    await b.client.refreshMode(sid("parent"));
    await Promise.resolve();
    expect(signal.aborted).toBe(false);
    expect(candidates).toHaveBeenCalledOnce();
    b.modes.set(sessionId, {
      sessionId: sid(sessionId),
      role: "coordinator",
      enabled: sessionId === "ordinary",
      revision: 3,
      canToggle: true,
    });
    await b.client.refreshMode(sid(sessionId));
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
    expect(candidates).toHaveBeenCalledTimes(2);
    pending.resolve([]);
  },
);
