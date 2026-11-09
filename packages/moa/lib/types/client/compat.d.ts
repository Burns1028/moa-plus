import type { TypertClientRemote } from "@deepseek-ai/dsh-typert-protocol";
export declare const moaRemoteDependency = "remote.projectMode";
export type MoARemote = TypertClientRemote["projectMode"];
export declare const moaRemote: (remote: TypertClientRemote) => MoARemote;
