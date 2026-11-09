#!/usr/bin/env node
// Compatibility entry for existing checkouts and documented launch commands.
export * from "./moa.mjs";
import { main } from "./moa.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`MoA+: ${error.message}`);
    process.exitCode = 1;
  }
}
