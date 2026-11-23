#!/usr/bin/env node
import { runLauncher } from "./moa.mjs";
export { npmInvocation } from "./moa.mjs";

if (import.meta.main) await runLauncher();
