# Native application acceptance model fixture

This is a scripted **model adapter only** for the published DSH 0.2.1-rc.3 application. Add the `insert` block from `cordis.patch.yml` to the isolated profile’s `cordis.patch.yml` (the rc.3 Web CLI has no `--patch` option), install the product separately through the real Plugins interface, choose the **Standard** preset, select **MoA Acceptance (scripted model) / Acceptance — deterministic model only**, and enable MoA in a real workspace. This fixture never drives Agents, invokes tools, changes inboxes, fabricates Session events, or replaces frontend/Remote/storage code. It emits public `StreamChunk` tool calls; native tools execute them.

`cordis.patch.yml` uses the acceptance workspace and logs owned by this checkout. Its explicit config is `{ controlRoot, logRoot, chunkDelayMs: 35 }`. Override absolute paths if the checkout moves. No credentials or network connection are needed for this provider. Other provider plugins are outside this fixture and may need disabling in the isolated launch overlay if their catalog discovery requires credentials/network.

## Composer markers and gates

Remove a scenario's existing `release` file **before** repeating that scenario. Files control model response timing only. They never alter application state. A model streams visible worker progress, waits abortably, then streams its complete approximately 5 KB final. Each final has begin/end sentinels and 64 evidence lines. The coordinator checks the complete content of actual native `project-mode-result` messages before emitting `PM_MAIN_FINAL`.

| Composer prompt      | Native model requests                                                                                                                                                      | Release file under `controlRoot` |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `[PM ACCEPT normal]` | Two native `control_workers spawn` calls in one model response; two continuable children; coordinator interim after tool results; main final after two canonical results   | `normal/release`                 |
| `[PM ACCEPT queue]`  | Spawn one child; read its actual native receipt; send `delivery: queue`; two worker turns and two canonical finals in one intended coordinator turn                        | `queue/release`                  |
| `[PM ACCEPT stop]`   | Same dispatch/queue sequence; use real UI Stop while worker progress is gated and queue pending; release after stop to observe native late-result wakeup                   | `stop/release`                   |
| `[PM ACCEPT reuse]`  | In the **same coordinator chat** after a previous scenario, send a new queued assignment to its first existing worker; verifies another native child turn without spawning | `reuse/release`                  |
| `[PM ACCEPT probe]`  | Return effective routed tool names; native trace also snapshots all six delegation tools by Agent                                                                          | none                             |
| `[PM ACCEPT steer]`  | Spawn one child; read actual receipt; send `delivery: steer`; observe native next-step admission within the same child turn                                                | `steer/release`                  |

For example, release the normal workers by creating the directory and writing an empty file at `<controlRoot>/normal/release`. To observe the streaming/capsule interval, leave the file absent until two worker progress messages and coordinator interim are visible. A parent model response may finish while native turn closure must remain pending. When stopped, the fixture respects cancellation; it does not decide whether native children are cancelled or how a late result wakes the parent. Those are acceptance observations.

`steer` uses native next-step delivery at the next safe step. It does not cancel the model stream already in progress and does not promise two completed worker turns. The observed application scenario has two model requests in one child turn and returns that turn's final assistant message. Use `queue` for the two-turn, two-full-final requirement.

## Trace

`<logRoot>/trace.jsonl` contains model request identities, purpose/background flag, first-request role presence, source kinds, routed tool names, actual `ctx.tools.schemas(agent)` names, all six native delegation-tool booleans, native Session event types/seq/turn/message IDs/source kinds/reasons, worker start/final markers, gate waits, cancellation, and exact canonical-final containment checks. No credentials, environment, arbitrary workspace content, or full prompt content are logged. Tool snapshots on native creation/change and before each model request support coordinator isolation, child inheritance, and disable/restore checks.

Adapter scenario state lives in memory per session. Restarting the application during a scenario resets this state; start a fresh coordinator chat after a restart. Session event history and native child sessions remain owned by the application.

## Focused verification

`node --check tests/application/acceptance-provider/index.mjs` validates syntax. `npx vitest run tests/application/acceptance-provider/smoke.spec.ts` covers public chunk assembly, cancellation and actual native loop/tool/Project result integration through the existing host test harness. Host smoke results are not UI acceptance evidence. Browser screenshots, actual Plugins installation, capsule positioning/clicks/sidebar and Stop behavior must be recorded separately from the real application.
