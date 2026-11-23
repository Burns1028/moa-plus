import * as React from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { type SharedProps } from "./components.tsx";
import type { ProjectClient } from "./runtime.ts";
export declare function registerFirstRunGuide(ctx: Context, client: ProjectClient): (p: PropsRuntime<"conversation.input.left"> & PropsLocale<"project-mode"> & Omit<SharedProps, "t">) => React.JSX.Element;
