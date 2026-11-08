# Native-call protocol tools under PTC

Status: independently reviewed and implemented against pinned rc.3 artifacts. This closes two reproduced Request/background failures: cold PTC startup before the first nested Request and a second urgent message while an interrupted Request receipt is being persisted. Scripted native evidence is separate from real-model/UI acceptance in [verification](verification.md).

## Responsibility

`SendMessage(mode=request)` is a protocol wait. Its own original Tool Call must return answered, interrupted, timeout, or downgraded; unrelated input must continue the same native turn. The broker owns reply matching, interruption, route persistence and late answers. Generic slow-tool background policy must not replace that original result with a placeholder.

Native PTC currently exposes only `run_code` and gives that program bindings for every visible tool. Its cold startup can exceed the background threshold before a nested Request exists. Its program can also remain open after the answer-wait map clears but before the Request's durable Tool Result returns. Inspecting the live wait graph cannot cover either boundary. Predicting future JavaScript execution or holding owner-wide leases would add the wrong mechanism.

## Minimal interface

Add optional `nativeOnly?: boolean` to native `ToolDefinition` and `DefineToolOptions`. Only the exact value `true` opts in; default behavior remains unchanged. `defineTool` retains the flag internally; it never enters the model ToolSchema fields or Session event data.

The plugin marks **SendMessage only** as nativeOnly. It remains one tool with Notify, Request and explicit reply_to; no second communication API or new message protocol.

| Native registry path | nativeOnly tool | Other tools |
| --- | --- | --- |
| Native function-call presentation | Ordinary visible native schema and execution | Existing behavior |
| PTC function-call presentation | Native schema beside run_code | Existing run_code presentation |
| PTC SDK declarations and program bindings | Omitted | Existing typed binding |
| Direct native dispatch in PTC | Allowed through existing policy/output pipeline | Existing collapse to run_code |
| Nested/program dispatch | Rejected before body as UNKNOWN_TOOL, with direct-call instruction | Existing dispatch |

PTC `wireSchemas.knownNames` includes `run_code` and known nativeOnly names, so `toolOrder` accepts SendMessage. Collect nativeOnly names before visibility masks, respecting nearest own-definition shadows; hiding or restricting a known nativeOnly tool must not make its configured order invalid. Ordinary collapsed SDK tool names remain invalid in PTC `toolOrder`, preserving the current mode contract. This is a derived field of the existing registry view, not another registry.

Visibility, scoped suppressions, restrictions, permissions, output validation, cancellation and finalization still apply. Native-only does not grant access to an otherwise hidden tool. An old captured or manually forged nested binding is rejected by native execution resolution as well as being absent from new SDKs.

PTC instructions must describe the actual surface: use run_code for SDK capabilities; any separately supplied native schema is called directly and is absent from the SDK. No JS parsing, timing heuristic or per-model special case.

## Original-result ownership

The plugin's existing direct SendMessage/request exclusion in background.ts remains active for the complete native activity. It does not depend on live broker wait-map membership, so route/receipt writes and finalizers remain covered. Hard Stop and cancellation remain native.

Remove the transient `MoAMessageBroker.hasPendingRequest` helper and Host-to-background callback added in b173dec. They no longer arbitrate composite roots. Ordinary run_code work retains the existing background strategies. Notify and explicit Notify replies remain eligible for ordinary background transfer as their own native calls.

A model attempting `tools.SendMessage` in an old PTC program receives an ordinary tool/program error without sending a Request. The next inference sees the correct native schema. Persisted conversation history remains readable; programs are not replayed or rewritten. This is an unreleased branch change, not a migration of a released nested protocol API.

## Exact native scope

Only the already-patched `@deepseek-ai/dsh-tools` package needs changes:

- `lib/index.js`: metadata propagation; PTC wire schemas, SDK and bindings; shared direct/nested execution resolution; accurate rejection/instruction text.
- `lib/types/index.d.ts`: ToolDefinition optional metadata.
- `lib/types/schema.d.ts`: DefineToolOptions optional metadata.

Both exact npm and existing published legacy-tool-isolation preimages continue to target the same final bytes through the current compatibility manifest. Regenerate their runtime/full patches and hashes; no new package, scheduler, event type, service, registry, or profile-wide setting. Unknown bytes remain rejected; fresh install, idempotence, legacy upgrade and rollback must remain verified.

## Verification contract

1. Reproduce both reviewed failures before the change: cold PTC startup under AfterSeconds; and a second urgent message while interrupted Request receipt persistence is held.
2. Native-only tool in native and PTC Agents: schema/execution parity, absent SDK declarations/runtime bindings, nested attempt rejected with zero body calls, hidden scopes remain hidden. Unmarked ordinary PTC tools keep existing behavior and background transfer.
3. Actual Host + broker + enabled background with PTC composition: Request is a direct native call; answered and interrupted results remain the original Tool Result and same turn, including receipt-write delay and two urgent inputs. Late explicit reply is delivered once.
4. Notify and explicit Notify replies remain normally backgroundable. Existing broker timeout/cycle/recovery, cancellation, ordinary Bash/PTC background and canonical-result tests stay green.
5. Typechecks, exact patch consumer probes, then root-owned package refresh and real-model/DSH UI re-verification. Scripted tests must not be reported as real-model evidence.
