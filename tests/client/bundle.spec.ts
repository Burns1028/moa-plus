// @vitest-environment jsdom
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { nativeLoader } from "./native-loader.ts";
it("ships a lazy public factory with own generated Remote descriptor inline and only host baseline requires", () => {
  const capture = nativeLoader();
  const plugin = capture<{ apply: Function; inject: string[] }>(
    "dsh-plugin-project-mode",
  );
  expect(typeof plugin.apply).toBe("function");
  expect(plugin.inject).toContain("remote");
  expect(plugin.inject).not.toContain("remote.projectMode");
  const source = readFileSync(
    createRequire(import.meta.url).resolve("dsh-plugin-project-mode/client"),
    "utf8",
  );
  const requires = [
    ...new Set([...source.matchAll(/require\("([^\"]+)"\)/g)].map((m) => m[1])),
  ].sort();
  expect(requires).toEqual([
    "@deepseek-ai/dsh-client-ui-primitives",
    "react",
    "react/jsx-runtime",
    "zod",
  ]);
  expect(source).not.toContain("/src/client/");
  // Native factories have no relative image URL base. The mode artwork must
  // travel inside the same browser bundle for every installation form.
  expect(source).toContain("data:image/png;base64,");
  delete (window as any).__ModuleLoader__;
});
