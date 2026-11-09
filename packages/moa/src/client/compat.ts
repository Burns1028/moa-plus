import type { TypertClientRemote } from "@deepseek-ai/dsh-typert-protocol";
import type {} from "dsh-plugin-project-mode/remote";

// Retain the native wire namespace so cached clients and installed Hosts agree.
export const moaRemoteDependency = "remote.projectMode";
export type MoARemote = TypertClientRemote["projectMode"];
export const moaRemote = (remote: TypertClientRemote): MoARemote =>
  remote.projectMode;
