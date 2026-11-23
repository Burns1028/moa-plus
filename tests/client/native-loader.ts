import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as cordis from "@deepseek-ai/cordis";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as reactDom from "react-dom";
import * as reactDomClient from "react-dom/client";
import * as store from "@deepseek-ai/dsh-client-store";
import * as slots from "@deepseek-ai/dsh-client-ui-slots";
import * as primitives from "@deepseek-ai/dsh-client-ui-primitives";
import * as gateway from "@deepseek-ai/dsh-api-gateway/client";
import * as fileReference from "@deepseek-ai/dsh-file-reference";
import * as utilValues from "@deepseek-ai/dsh-util-values";
import * as virtual from "@tanstack/react-virtual";
import * as zod from "zod";
const resolve = createRequire(import.meta.url).resolve;
export function nativeLoader() {
  const baseline = new Map<string, unknown>(
    Object.entries({
      "@deepseek-ai/cordis": cordis,
      react: React,
      "react/jsx-runtime": jsx,
      "react-dom": reactDom,
      "react-dom/client": reactDomClient,
      "@deepseek-ai/dsh-client-store": store,
      "@deepseek-ai/dsh-client-ui-slots": slots,
      "@deepseek-ai/dsh-client-ui-primitives": primitives,
      "@deepseek-ai/dsh-api-gateway/client": gateway,
      "@deepseek-ai/dsh-file-reference": fileReference,
      "@deepseek-ai/dsh-util-values": utilValues,
      "@tanstack/react-virtual": virtual,
      zod,
    }),
  );
  return function capture<T>(
    id: string,
    transform?: (source: string) => string,
  ): T {
    let registration: any;
    (window as any).__ModuleLoader__ = {
      load: (r: unknown) => (registration = r),
    };
    const source = readFileSync(resolve(id + "/client"), "utf8");
    new Function(transform ? transform(source) : source)();
    if (registration.id !== id) throw new Error("Wrong factory");
    const req: any = (s: string) => {
      if (!baseline.has(s)) throw new Error("Missing actual baseline " + s);
      return baseline.get(s);
    };
    req.asset = (s: string) => s;
    const exports = registration.factory(req);
    baseline.set(id, exports);
    baseline.set(id + "/client", exports);
    return exports;
  };
}
