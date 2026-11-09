import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { Completion, NativeReceipt } from "./state.ts";
/**
 * rc.3 native notices have no child turn ID. Bind a committed notice to the
 * unique last child turn finished at its ORIGINAL inbox admission, then verify
 * the complete native payload. Never use consumption time or text similarity
 * to select a turn; queued notices can be read after another turn finishes.
 */
export declare function consumedNativeReceipts(completions: readonly Completion[], events: readonly SessionEvent[]): Map<string, NativeReceipt>;
