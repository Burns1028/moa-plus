import type { MoARemote } from "./compat.ts";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionModeView } from "../shared/index.ts";
import { MoAStore } from "./store.ts";
export interface ModeState {
    value?: SessionModeView;
    busy: boolean;
    error?: string;
}
/** Remote namespace is generated from the actual Host FaceModel. */
export declare class MoAClient {
    private readonly remote;
    readonly store: MoAStore;
    private frameVersions;
    private generation;
    private catalogRequest;
    private roots;
    private feeds;
    private modes;
    private modeListeners;
    private requests;
    private stopped;
    error: string | undefined;
    catalogState: "loading" | "ready" | "error";
    modeVersion: number;
    connectionVersion: number;
    constructor(remote: MoARemote);
    subscribeModes: (listener: () => void) => () => void;
    mode: (id: SessionId) => ModeState;
    private setMode;
    refreshMode(id: SessionId, actionError?: string): Promise<void>;
    toggle(id: SessionId, enabled: boolean): Promise<void>;
    watchRoots(ids: readonly SessionId[]): void;
    private reconcile;
    private startFeed;
    loadCatalog(): Promise<void>;
    reconnect(): void;
    private stopFeed;
    dispose(): void;
}
export declare function message(error: unknown): string;
