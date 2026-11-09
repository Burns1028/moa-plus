import type { Context } from "@deepseek-ai/cordis";
import type { MoAClient } from "./runtime.ts";
import { type WorkersPanelProps } from "./worker-timeline.tsx";
export declare function registerMoAPanels(ctx: Context, client: MoAClient, open: WorkersPanelProps["open"]): void;
