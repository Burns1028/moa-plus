# Promptless native child residency

This supplements the reviewed background/cancellation contract for the pinned published DSH 0.2.1-rc.3 runtime. It is limited to the existing subagent manager and a Host-only adapter. It is not a model tool, Remote method, scheduler or new Agent driver.

## Concrete missing path

`SendMessage` must address any active MoA member, including a retained nested Worker whose direct parent is also cold. A completion can likewise target a cold `reportTo` Worker. Native cold continuation currently requires an exact live direct parent and always admits a prompt. An invented prompt to hydrate intermediate parents would create false work, turns and completions. Resuming them as independent roots would lose native lineage, delegated policy and capacity ownership.

## Capability

The internal subagent subpath exposes `withResidentSubagent(runtime, parent, childId, signal, use)` backed by a symbol-keyed Host operation. It returns the result of the asynchronous `use(agent)` callback. The callback runs outside the per-child admission lock. The callback does not receive a permanent ownership handle.

The manager verifies the exact live parent and durable direct-parent lineage, supported continuable descriptor and selected preset. It reuses the same reconstruction routine as cold prompt delivery: model options, persona, tool filter, delegated policy, cwd, inherited history, native capacity, startup cancellation and teardown all remain native-owned. The cold-resume routine is split into reconstruction and prompt admission rather than copied into a second restoration implementation.

While a callback uses the activation, a small activation-local borrower count prevents natural settlement. The count is incremented under the existing child lock before returning the Agent and released in `finally`; it does not block another child, turn or tool. Explicit teardown still cancels and joins the activation through the existing native disposal path. A closing activation is awaited before retrying under the existing cutoff semantics.

A promptless reconstruction emits no `subagent/start` or `subagent/end` task event and no settlement message. It appends no user input, Agent turn or completion. If actual input is subsequently admitted, the ordinary observer starts once and normal settlement follows. On callback release, the existing settlement watcher runs: an idle parent stays resident while its native owned children run, then releases its slot and handle. A parent used solely to reach another child returns to cold without fabricating a task result.

## Plugin use

`withManagedAgent(host, id, signal, use)` verifies enabled project membership and reads actual durable parent headers. It resolves the ordinary Coordinator through the existing session controller, recursively borrows the true parent chain and then borrows the target through the Host adapter. Already live targets still receive a callback-scoped residency hold. The plugin does not infer parentage from a requested `reportTo` or Fork source.

The real message or completion is admitted once inside the callback, preserving its stable source/message identity and requested steer/queue destination. Native persistence is flushed before returning acceptance. Intermediate parent sessions receive no synthetic message. The existing per-turn completion outbox remains authoritative.

## Required evidence

- Three-level persisted family, all Workers cold: peer message reaches the true target; intermediate parent has no new input or turn; original header lineage, policy and cwd remain.
- A callback held across an await cannot lose the target to natural settlement; callback failure/cancellation releases the hold.
- Explicit teardown during hydration leaves no Agent handle, capacity slot or startup hold behind.
- Cold `reportTo` consumes the exact final AI result once; reopening/recovery cannot duplicate it.
- Ordinary native child delivery and capacity remain covered by their existing contracts.
- Exact runtime/declaration hashes, backup and rollback are added to the explicit compatibility manifest. No unmanifested native mutation.
