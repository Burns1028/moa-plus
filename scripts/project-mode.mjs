#!/usr/bin/env node
import { runLauncher } from "./moa.mjs";
export { npmInvocation } from "./moa.mjs";

await runLauncher(import.meta.url);
