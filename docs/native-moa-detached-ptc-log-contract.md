# Detached PTC trace records

Status: independently reviewed and implemented as a minimal correction to the existing rc.3 tools patch, following a real-model AfterSeconds failure. Scripted native persistence evidence is separate from the final real-model re-run in [verification](verification.md).

## Reproduced boundary

A foreground `run_code` awaits a native Bash subcall. AfterSeconds transfers the outer call to background and returns its placeholder. The Agent acknowledges the transfer and ends its turn. When Bash finishes, the program bridge appends a required `tool/ptc-dispatch` result after `turn/end`. Native session-format validation correctly rejects that turn-bound event outside an open turn. The Worker did finish, but its next cold observation fails; the Coordinator cannot safely close.

Do not treat the failed observation as idle or weaken required-event validation. The writer must preserve the native log contract.

## Correction

Change only the already-manifested `@deepseek-ai/dsh-tools/lib/index.js` bridge. When appending a PTC subcall start or result, inspect its existing `exec.background.detached` capability. If detached, use native `appendPluginRecord` with `plugin:tools/ptc-dispatch-start` or `plugin:tools/ptc-dispatch` and the same canonical payload. Otherwise keep the ordinary native `tool/ptc-dispatch-start` / `tool/ptc-dispatch` event unchanged.

The decision is made at the append boundary, after asynchronous result shaping, so a background transfer during shaping cannot append a stale required event. A detached program can start another subcall after the original turn ended; its start uses the same envelope. These trace records belong to the original root/parent/subcall IDs and must not be reassigned to a later foreground turn.

Native plugin records are already ignorable, durable and valid outside turns. This adds no event to the format's required-event whitelist and does not change tool execution, result validation, producer ownership, cancellation, or permissions. The outer placeholder and full canonical background result retain their existing ownership and exactly-once delivery paths. Detached traces remain available as raw plugin records; native chat projection does not fold those envelopes into the original nested tool cards. The outer placeholder and full background notice remain the visible authority. Job queries and process output continue to use native Jobs, independently of these trace records. This correction does not add another chat result or a new UI surface.

Both npm and legacy-tool-isolation variants must target the same final tools bytes. Regenerate only their full/runtime patches and existing manifest hash. No additional package or file is required.

## Verification

- Actual native PTC tool awaits a held subcall; outer call transfers and its foreground turn completes before the subcall is released.
- Release it, preserve the complete canonical subcall/program value, and verify the detached trace record.
- Add another subcall after the awaited result to verify late starts also use the ignorable envelope.
- Correlate the original foreground start and detached settlement by unchanged root/parent/subcall IDs; preserve canonical content, failure data and metadata. Correlate the later detached start and settlement the same way.
- Flush and read through native durable persistence, then cold-observe in a fresh native runtime; the completed Worker and inbox must remain readable.
- Ordinary foreground PTC retains its original required trace events; unrelated unknown required events remain rejected.
- Repeat the real-model timer scenario in a fresh synthetic Worker before accepting closure; earlier malformed unreleased logs are evidence, not silently rewritten.
