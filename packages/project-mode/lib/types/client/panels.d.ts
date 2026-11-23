import type { Context } from "@deepseek-ai/cordis";
import type { ProjectClient } from "./runtime.ts";
import { type WorkersPanelProps } from "./worker-timeline.tsx";
export declare function registerProjectPanels(ctx: Context, client: ProjectClient, open: WorkersPanelProps["open"]): void;
