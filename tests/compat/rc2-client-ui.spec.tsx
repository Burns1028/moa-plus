// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { nativeLoader } from "../client/native-loader.ts";

const modules = process.env.MOA_COMPAT_MODULES;
const nativeTest = it.skipIf(!modules);
const snapshot = (value: unknown) => (select: (state: any) => unknown) => select(value);
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(document, "fonts", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as any).__ModuleLoader__; });

function conversation() {
  const load = nativeLoader();
  load("@deepseek-ai/dsh-client-ui-renderer");
  return load<any>("@deepseek-ai/dsh-client-ui-conversation", () => readFileSync(resolve(modules!, "@deepseek-ai/dsh-client-ui-conversation/lib/client.js"), "utf8")
    .replace("exports.apply = apply;", "exports.__test = { InputBar, ComposerSubmissionPolicy }; exports.apply = apply;"));
}
function bar(mode: "continuable" | "ephemeral" | null, uploadAllowed = true, blocked = false) {
  const { __test: { InputBar } } = conversation();
  const addFiles = vi.fn();
  const view = render(<InputBar sessionId="worker" useSession={snapshot({ running: false, removed: false, subagent: mode ? { address: { mode }, parentAvailable: true } : null })}
    useInput={snapshot({ draft: "", phase: "plain", attachmentIds: [], queue: [] })} useNotices={snapshot(undefined)} useBusyEnter={snapshot("queue")}
    useStopShortcut={snapshot([])} useMenuLauncher={snapshot(undefined)} useFileUploads={snapshot({})} useLexicon={snapshot(undefined)}
    useAccess={(name: string) => name !== "fileUploads/upload" || uploadAllowed} useProjection={(_name: string, select?: (s: unknown) => unknown) => select?.(undefined)}
    keyboard={{ editor: null, bindFilePicker: () => () => {} }} inputActions={{ pruneAttachments() {} }} renderSlot={() => null}
    resolveDraftAttachments={() => []} toggleCommandMenu={() => {}} addFiles={addFiles} t={(key: string) => key} disabled={blocked} />);
  return { ...view, addFiles, picker: view.container.querySelector('input[type="file"]') as HTMLInputElement };
}

nativeTest("rc2 continuable Worker accepts native ordinary-file intake", () => {
  const f = bar("continuable"), file = new File(["contents"], "input.txt", { type: "text/plain" });
  expect(f.picker.disabled).toBe(false);
  fireEvent.change(f.picker, { target: { files: [file] } });
  expect(f.addFiles).toHaveBeenCalledExactlyOnceWith([file], undefined);
});

nativeTest("rc2 upload access, composer blocks, and non-continuable restrictions survive the port", () => {
  for (const [mode, allowed, blocked] of [["continuable", false, false], ["continuable", true, true], ["ephemeral", true, false]] as const) {
    const f = bar(mode, allowed, blocked);
    expect(f.picker.disabled).toBe(true);
    fireEvent.change(f.picker, { target: { files: [new File(["x"], "x.txt")] } });
    expect(f.addFiles).not.toHaveBeenCalled(); f.unmount();
  }
  const ordinary = bar(null);
  expect(ordinary.picker.disabled).toBe(false);
});

nativeTest("rc2 per-Session submission override is scoped, stacked, and reversible", () => {
  const { __test: { ComposerSubmissionPolicy } } = conversation();
  const policy = new ComposerSubmissionPolicy();
  const first = policy.register("worker", "steer"), second = policy.register("worker", "queue");
  expect(policy.forSession("worker").getSnapshot()).toBe("queue");
  second(); expect(policy.forSession("worker").getSnapshot()).toBe("steer");
  expect(policy.forSession("ordinary").getSnapshot()).toBe(policy.busyEnter.getSnapshot());
  first(); first(); expect(policy.forSession("worker").getSnapshot()).toBe(policy.busyEnter.getSnapshot());
  policy.dispose();
});

nativeTest("rc2 branch chain forwards the new native row controls and opens the actual child", () => {
  const load = nativeLoader();
  const native = load<any>("@deepseek-ai/dsh-client-ui-workspace", () => readFileSync(resolve(modules!, "@deepseek-ai/dsh-client-ui-workspace/lib/client.js"), "utf8")
    .replace("exports.apply = apply;", "exports.__test = { SessionNodeItem }; exports.apply = apply;"));
  const menu = vi.fn(), access = vi.fn(), contextMenu = vi.fn(), contextTarget = vi.fn(), open = vi.fn(), childOpen = vi.fn();
  let row: any;
  const Row = native.__test.SessionNodeItem;
  const view = render(<Row node={{ id: "parent" }} currentId="parent" openSessionMenu={menu} useSessionAccess={access}
    useContextMenu={contextMenu} useContextMenuTarget={contextTarget} onOpen={open}
    renderSlotChain={(name: string, props: any) => {
      expect(name).toBe("sidebar.workspaces.session.branch");
      row = props.renderRow(<button>expand</button>);
      return props.renderChild({ sessionId: "actual-child", title: "Worker", selected: false, onOpen: childOpen });
    }} />);
  expect(row.type.name).toBe("NativeSessionRow");
  expect(row.props).toMatchObject({ openSessionMenu: menu, useSessionAccess: access, useContextMenu: contextMenu, useContextMenuTarget: contextTarget, onOpen: open });
  fireEvent.click(view.getByRole("treeitem"));
  expect(childOpen).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
});
