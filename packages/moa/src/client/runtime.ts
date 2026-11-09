import type { RemoteStreamHandle } from "@deepseek-ai/dsh-typert-protocol";
import type { MoARemote } from "./compat.ts";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionModeView, MoAFrame } from "../shared/index.ts";
import { MoAStore, reuse } from "./store.ts";
export interface ModeState {
  value?: SessionModeView;
  busy: boolean;
  error?: string;
}
const INITIAL: ModeState = { busy: false };
/** Remote namespace is generated from the actual Host FaceModel. */
export class MoAClient {
  readonly store = new MoAStore();
  private frameVersions = new Map<SessionId, number>();
  private generation = 0;
  private catalogRequest = 0;
  private roots = new Set<SessionId>();
  private feeds = new Map<
    SessionId,
    {
      abort: AbortController;
      stream?: RemoteStreamHandle<MoAFrame, never>;
      retry?: ReturnType<typeof setTimeout>;
    }
  >();
  private modes = new Map<SessionId, ModeState>();
  private modeListeners = new Set<() => void>();
  private requests = new Map<SessionId, number>();
  private stopped = false;
  error: string | undefined;
  catalogState: "loading" | "ready" | "error" = "loading";
  modeVersion = 0;
  connectionVersion = 0;
  constructor(private readonly remote: MoARemote) {}
  subscribeModes = (listener: () => void) => {
    this.modeListeners.add(listener);
    return () => {
      this.modeListeners.delete(listener);
    };
  };
  mode = (id: SessionId) => this.modes.get(id) ?? INITIAL;
  private setMode(id: SessionId, state: ModeState) {
    this.modeVersion++;
    this.modes.set(id, reuse(this.modes.get(id), state));
    for (const l of this.modeListeners) l();
  }
  async refreshMode(id: SessionId, actionError?: string) {
    if (this.stopped || this.mode(id).busy) return;
    const request = (this.requests.get(id) ?? 0) + 1;
    this.requests.set(id, request);
    if (actionError)
      this.setMode(id, { ...this.mode(id), busy: true, error: actionError });
    try {
      const r = await this.remote.mode(id);
      if (this.stopped || this.requests.get(id) !== request) return;
      this.setMode(
        id,
        r.ok
          ? {
              value: r.value,
              busy: false,
              ...(actionError ? { error: actionError } : {}),
            }
          : {
              ...this.mode(id),
              busy: false,
              error: actionError ?? r.error.message,
            },
      );
    } catch (e) {
      if (!this.stopped && this.requests.get(id) === request)
        this.setMode(id, {
          ...this.mode(id),
          busy: false,
          error: actionError ?? message(e),
        });
    }
  }
  async toggle(id: SessionId, enabled: boolean) {
    const state = this.mode(id);
    if (state.busy || !state.value?.canToggle) return;
    this.requests.set(id, (this.requests.get(id) ?? 0) + 1);
    this.setMode(id, { ...state, busy: true, error: undefined });
    try {
      const r = await this.remote.setEnabled(
        id,
        enabled,
        state.value.revision,
        crypto.randomUUID(),
      );
      if (this.stopped) return;
      this.setMode(
        id,
        r.ok
          ? { value: r.value, busy: false }
          : { ...state, busy: false, error: r.error.message },
      );
      if (r.ok) {
        await this.loadCatalog();
        await this.refreshMode(id);
      } else await this.refreshMode(id, r.error.message);
    } catch (e) {
      if (!this.stopped) {
        this.setMode(id, { ...state, busy: false, error: message(e) });
        await this.refreshMode(id, message(e));
      }
    }
  }
  watchRoots(ids: readonly SessionId[]) {
    this.roots = new Set(ids);
    this.reconcile();
  }
  private reconcile() {
    if (this.stopped) return;
    for (const [id, feed] of this.feeds)
      if (!this.roots.has(id)) {
        this.stopFeed(feed);
        this.feeds.delete(id);
      }
    for (const id of this.roots) if (!this.feeds.has(id)) this.startFeed(id);
  }
  private startFeed(id: SessionId) {
    const feed: {
      abort: AbortController;
      stream?: RemoteStreamHandle<MoAFrame, never>;
      retry?: ReturnType<typeof setTimeout>;
    } = { abort: new AbortController() };
    this.feeds.set(id, feed);
    void (async () => {
      try {
        feed.stream = this.remote.follow(id, feed.abort.signal);
        for await (const frame of feed.stream) {
          if (feed.abort.signal.aborted || this.stopped) return;
          this.frameVersions.set(id, (this.frameVersions.get(id) ?? 0) + 1);
          this.store.push(frame.value);
          this.error = undefined;
        }
      } catch (e) {
        if (!feed.abort.signal.aborted && !this.stopped)
          this.error = message(e);
      } finally {
        feed.stream?.dispose();
        if (!feed.abort.signal.aborted && !this.stopped && this.roots.has(id))
          feed.retry = setTimeout(() => {
            this.feeds.delete(id);
            this.startFeed(id);
          }, 1000);
      }
    })();
  }
  async loadCatalog() {
    const generation = this.generation,
      request = ++this.catalogRequest,
      observed = new Map(this.frameVersions);
    const current = () =>
      !this.stopped &&
      generation === this.generation &&
      request === this.catalogRequest;
    try {
      const result = await this.remote.catalog();
      if (!current()) return;
      if (!result.ok) {
        this.error = result.error.message;
        this.catalogState = "error";
        for (const l of this.modeListeners) l();
        return;
      }
      this.catalogState = "ready";
      this.error = undefined;
      for (const s of result.value) {
        const id = s.project.coordinatorSessionId;
        if ((observed.get(id) ?? 0) === (this.frameVersions.get(id) ?? 0))
          this.store.accept(s);
      }
      for (const l of this.modeListeners) l();
    } catch (e) {
      if (current()) {
        this.error = message(e);
        this.catalogState = "error";
        for (const l of this.modeListeners) l();
      }
    }
  }
  reconnect() {
    this.connectionVersion++;
    this.generation++;
    for (const f of this.feeds.values()) this.stopFeed(f);
    this.feeds.clear();
    this.reconcile();
    void this.loadCatalog();
    for (const id of this.modes.keys()) void this.refreshMode(id);
  }
  private stopFeed(feed: {
    abort: AbortController;
    stream?: RemoteStreamHandle<MoAFrame, never>;
    retry?: ReturnType<typeof setTimeout>;
  }) {
    feed.abort.abort();
    feed.stream?.dispose();
    if (feed.retry !== undefined) clearTimeout(feed.retry);
  }
  dispose() {
    this.stopped = true;
    for (const f of this.feeds.values()) this.stopFeed(f);
    this.feeds.clear();
    this.store.dispose();
    this.modeListeners.clear();
  }
}
export function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);
}
