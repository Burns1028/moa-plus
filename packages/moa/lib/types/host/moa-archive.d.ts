import type { Context } from "@deepseek-ai/cordis";
import type { Domain } from "@deepseek-ai/dsh-storage-domain";
import { SessionId } from "@deepseek-ai/dsh-session";
import { domainSpec, type RecordState } from "./state.ts";
/** Mirror MoA archival through the native registry, including native Undo. */
export declare function bindMoAArchives(ctx: Context, domain: Domain<typeof domainSpec>, update: (id: SessionId, change: (record: RecordState) => RecordState) => Promise<void>): import("@deepseek-ai/cordis").Fiber & PromiseLike<import("@deepseek-ai/cordis").Fiber>;
