// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { nativeLoader } from "../client/native-loader.ts";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {} },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as any).__ModuleLoader__;
});

function bar(mode: "continuable" | "ephemeral" | null, locked = false) {
  const load = nativeLoader();
  load("@deepseek-ai/dsh-client-ui-renderer");
  const native = load<{ __test: { InputBar: React.ComponentType<any> } }>(
    "@deepseek-ai/dsh-client-ui-conversation",
    (source) =>
      source.replace(
        "exports.apply = apply;",
        "exports.__test = { InputBar }; exports.apply = apply;",
      ),
  );
  const addFiles = vi.fn(() => null);
  const state = {
    running: false,
    removed: false,
    subagent: mode ? { address: { mode }, parentAvailable: true } : null,
  };
  const input = { draft: "", phase: "plain", attachmentIds: [], queue: [] };
  const snapshot = (value: unknown) => (selector: (s: any) => unknown) =>
    selector(value);
  const view = render(
    <native.__test.InputBar
      sessionId="worker"
      useSession={snapshot(state)}
      useInput={snapshot(input)}
      useNotices={snapshot(undefined)}
      useBusyEnter={snapshot("queue")}
      useStopShortcut={snapshot([])}
      useMenuLauncher={snapshot(undefined)}
      useFileUploads={snapshot({})}
      useLexicon={snapshot(undefined)}
      useProjection={(_name: string, select?: (s: unknown) => unknown) =>
        select?.(undefined)
      }
      keyboard={{ editor: null, bindFilePicker: () => () => {} }}
      inputActions={{ pruneAttachments() {} }}
      renderSlot={() => null}
      resolveDraftAttachments={() => []}
      toggleCommandMenu={() => {}}
      addFiles={addFiles}
      t={(key: string) => key}
      disabled={locked}
    />,
  );
  return {
    ...view,
    addFiles,
    picker: view.container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement,
  };
}

it("lets a continuable Worker pick ordinary files through the native intake", () => {
  const f = bar("continuable");
  expect(f.picker.disabled).toBe(false);
  const file = new File(["worker input"], "input.txt", { type: "text/plain" });
  fireEvent.change(f.picker, { target: { files: [file] } });
  expect(f.addFiles).toHaveBeenCalledExactlyOnceWith([file], undefined);
});

it("keeps ordinary root file intake and the non-continuable child restriction", () => {
  const ordinary = bar(null);
  const file = new File(["ordinary input"], "input.txt", {
    type: "text/plain",
  });
  expect(ordinary.picker.disabled).toBe(false);
  fireEvent.change(ordinary.picker, { target: { files: [file] } });
  expect(ordinary.addFiles).toHaveBeenCalledExactlyOnceWith([file], undefined);
  ordinary.unmount();
  const child = bar("ephemeral");
  expect(child.picker.disabled).toBe(true);
  fireEvent.change(child.picker, { target: { files: [file] } });
  expect(child.addFiles).not.toHaveBeenCalled();
});

it("does not admit a file through a locked Worker's input", () => {
  const f = bar("continuable", true);
  fireEvent.change(f.picker, {
    target: { files: [new File(["input"], "input.txt")] },
  });
  expect(f.addFiles).not.toHaveBeenCalled();
});

it("forwards the staged-file receipt through native child Session.prompt", async () => {
  const load = nativeLoader();
  const {
    __test: { Session },
  } = load<any>("@deepseek-ai/dsh-api-session-controller", (source) =>
    source.replace(
      "exports.apply = apply;",
      "exports.__test = { Session }; exports.apply = apply;",
    ),
  );
  const prompt = vi.fn(async () => ({
    ok: true,
    value: { messageId: "accepted" },
  }));
  const session = new Session(
    "worker",
    { subagents: { prompt } },
    {
      address: {
        parentSessionId: "parent",
        childSessionId: "worker",
        mode: "continuable",
      },
      parentAvailable: true,
    },
  );
  const content = [{ type: "file", receiptId: "uploaded-for-worker" }];
  const result = await session.prompt(
    content,
    "queue",
    new AbortController().signal,
    "file-prompt",
  );
  expect(result.ok).toBe(true);
  expect(prompt).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: "file-prompt",
      parentSessionId: "parent",
      childSessionId: "worker",
      mode: "continuable",
      delivery: "queue",
      content,
    }),
    expect.any(AbortSignal),
  );
});
