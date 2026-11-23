import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(join(root, "packages/project-mode/src/host/native.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext },
}).outputText.replace('"./state.ts"', '"./state.mjs"');

/** Real Node ESM resolution distinguishes the requested adapter from its dependencies. */
function runNativeFixture(options: {
  tools?: string;
  internal?: string;
  internalTarget?: string;
  script: string;
}) {
  const directory = mkdtempSync(join(tmpdir(), "moa-native-adapter-"));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  try {
    write(join(directory, "native.mjs"), compiled);
    write(join(directory, "state.mjs"), "export const projection = {};\n");
    const tools = join(directory, "node_modules/@deepseek-ai/dsh-tools");
    write(join(tools, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
    write(join(tools, "index.js"), options.tools ?? 'export const TOOL_RUNTIME_SCHEDULER = Symbol("native-test-scheduler");\n');
    const subagents = join(directory, "node_modules/@deepseek-ai/dsh-subagent");
    write(join(subagents, "package.json"), JSON.stringify({
      type: "module",
      exports: { ".": "./index.js", ...options.internalTarget ? { "./internal": options.internalTarget } : {} },
    }));
    write(join(subagents, "index.js"), "export class SubagentError extends Error {}\n");
    if (options.internal !== undefined) write(join(subagents, "internal.js"), options.internal);
    const dependency = join(directory, "node_modules/adapter-dependency");
    write(join(dependency, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
    write(join(dependency, "index.js"), "export {};\n");
    write(join(directory, "check.mjs"), 'import assert from "node:assert/strict";\nimport * as native from "./native.mjs";\n' + options.script);
    const result = spawnSync(process.execPath, [join(directory, "check.mjs")], {
      encoding: "utf8", timeout: 5000,
    });
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
  } finally {
    // directory is the exact absolute path just reserved under the system temp root.
    rmSync(directory, { recursive: true, force: true });
  }
}

it("loads without the scheduler export and reports the missing native APIs", () => {
  runNativeFixture({ tools: "export {};\n", script: `
    const agent = { ctx: { get: () => ({}) } };
    assert.throws(() => native.requireNativeBackground({ tools: {} }, agent), error => {
      assert.match(error.message, /missing jobs.supportsProducerNotices/);
      assert.match(error.message, /dsh-tools.TOOL_RUNTIME_SCHEDULER/);
      assert.match(error.message, /agent.enableToolBackground/);
      assert.match(error.message, /agent.cancelAndJoin/);
      return true;
    });
  ` });
});

it("reports an unavailable Host admission subpath only when that operation is requested", () => {
  runNativeFixture({ script: `
    assert.equal(typeof native.queueHostSubagentPrompt, "function");
    await assert.rejects(native.queueHostSubagentPrompt(), error => {
      assert.match(error.message, /native-host-prompt-admission-incompatible: missing @deepseek-ai\\/dsh-subagent\\/internal/);
      assert.equal(error.cause.code, "ERR_PACKAGE_PATH_NOT_EXPORTED");
      return true;
    });
  ` });
});

it("identifies a missing file mapped by exactly the Host admission subpath", () => {
  runNativeFixture({ internalTarget: "./missing-internal.js", script: `
    await assert.rejects(native.queueHostSubagentPrompt(), error => {
      assert.match(error.message, /native-host-prompt-admission-incompatible/);
      assert.equal(error.cause.code, "ERR_MODULE_NOT_FOUND");
      assert.match(error.cause.url, /missing-internal.js$/);
      return true;
    });
  ` });
});

it("preserves a transitive missing-module failure instead of misdiagnosing admission", () => {
  runNativeFixture({ internalTarget: "./internal.js", internal: 'import "./missing-dependency.js";\n', script: `
    await assert.rejects(native.queueHostSubagentPrompt(), error => {
      assert.equal(error.code, "ERR_MODULE_NOT_FOUND");
      assert.match(error.url, /missing-dependency.js$/);
      assert.doesNotMatch(error.message, /native-host-prompt-admission-incompatible/);
      return true;
    });
  ` });
});

it("preserves a transitive package-export failure", () => {
  runNativeFixture({ internalTarget: "./internal.js", internal: 'import "adapter-dependency/internal";\n', script: `
    await assert.rejects(native.queueHostSubagentPrompt(), error => {
      assert.equal(error.code, "ERR_PACKAGE_PATH_NOT_EXPORTED");
      assert.match(error.message, /adapter-dependency/);
      assert.doesNotMatch(error.message, /native-host-prompt-admission-incompatible/);
      return true;
    });
  ` });
});

it("delegates exact arguments and preserves loaded native returns and synchronous failures", () => {
  runNativeFixture({ internalTarget: "./internal.js", internal: `
    export const accepted = Promise.resolve("accepted-native-id");
    export function queueHostSubagentPrompt(...args) { globalThis.received = args; return accepted; }
    export function steerHostSubagentPrompt() { throw globalThis.nativeFailure; }
  `, script: `
    const adapters = await import("@deepseek-ai/dsh-subagent/internal");
    const args = [{}, {}, "child", [], {}, new AbortController().signal];
    assert.equal(await native.queueHostSubagentPrompt(...args), "accepted-native-id");
    assert.deepEqual(globalThis.received, args);
    assert.equal(native.queueHostSubagentPrompt(...args), adapters.accepted);
    globalThis.nativeFailure = Object.assign(new Error("native admission failure"), { code: "ERR_MODULE_NOT_FOUND" });
    assert.throws(() => native.steerHostSubagentPrompt(...args), error => error === globalThis.nativeFailure);
  ` });
});

it("names a missing admission function without substituting another delivery path", () => {
  runNativeFixture({ internalTarget: "./internal.js", internal: "export {};\n", script: `
    await assert.rejects(native.steerHostSubagentPrompt(), /missing @deepseek-ai\\/dsh-subagent\\/internal.steerHostSubagentPrompt/);
  ` });
});

it("preserves a native callback rejection on the first lazy admission", () => {
  runNativeFixture({ internalTarget: "./internal.js", internal: `
    export function queueHostSubagentPrompt() { return Promise.reject(globalThis.nativeFailure); }
  `, script: `
    globalThis.nativeFailure = Object.assign(new Error("native admission rejected"), { code: "ERR_MODULE_NOT_FOUND" });
    await assert.rejects(native.queueHostSubagentPrompt(), error => error === globalThis.nativeFailure);
  ` });
});
