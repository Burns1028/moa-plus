# Verification

## Current branch: unreleased MoA runtime

The current checkout contains the six-chapter MoA runtime work. Its new capabilities and wider native compatibility manifest must be verified together. **Whole-branch acceptance is still in progress; the historical results below do not prove the new runtime.** The existing package version is not a release announcement.

The regression sources exercise these separate boundaries:

| Boundary | Evidence source |
| --- | --- |
| Task/Fork, role identity, actual reporting target, nested permission, and explicit shared/isolated workspaces | `tests/host/moa-agents.spec.ts`, `moa-controls-integration.spec.ts`, `moa-workspace-integration.spec.ts` |
| Dirty-state Git snapshots, scoped management, and owned cleanup | `tests/host/moa-workspaces.spec.ts` |
| Request/ReplyTo, waiting interruption, cycles, late results, and durable receipt recovery | `tests/host/moa-messages.spec.ts` |
| True cold parent-chain hydration without synthetic intermediate input/task events | `tests/host/moa-residency.spec.ts` |
| Full per-inference notes, progressive context, and common short native judge | `tests/host/moa-memory.spec.ts`, `project-memory.spec.ts`, `moa-judge.spec.ts` |
| Timer/message/judge transfer, sibling barriers, real Bash producer/exit, canonical results, cancellation, and recovery | `tests/native-contract/moa-background.spec.ts` |
| Task-scoped Ralph, independent original sources, tool-backed verdicts, rework, queue semantics, and restart | `tests/host/moa-completion.spec.ts` |
| Existing result/turn/capsule/native UI contracts | Host receipt/provenance tests, Client tests, and native sidebar/tool contracts listed in [Contributing](../CONTRIBUTING.md) |

Most model requests in these tests use scripted adapters over the actual native loop. Some cases execute the locked native Bash/subprocess/jobs implementation. Those executions prove the corresponding tool/resource behavior; they do not constitute real-model task ownership or visible application acceptance.

Before this branch is described as fully accepted, record:

- Production build and Host/Client typechecks against the final native manifest.
- Whole Host/Client/integration, native-contract, and launcher results.
- Fresh npm/forwarding/committed-Git consumers plus clean-checkout `npm ci`.
- A fresh isolated DSH runtime and real configured model tasks, with actual artifacts and independently rerun checks.
- Native UI/trajectory inspection of turn closure, message timing, capsule provenance, scoped tools, input previews, status, and existing layout.
- Independent final branch review and any unresolved limitations.

Use [manual verification](manual-verification.md) for the full runtime scenarios. Keep credentials, profiles, conversations, raw trajectories, and private screenshots outside Git; publish a factual version/task/result summary. Component tests are useful evidence, not a substitute for these final checks.

## Published preview evidence

The sections below concern the earlier tagged releases. They used DSH 0.2.1-rc.3 with the original three extensions, not the current branch's expanded runtime. The v0.1.23 change added isolated onboarding and public task evidence; its coordination behavior was unchanged from v0.1.22.

## 0.1.23 isolated runtime and real workflow

A fresh isolated Web runtime was prepared on macOS arm64 with Node 24.19.0. Setup installed the locked native dependency tree, installed the repository-built 0.1.23 archive, applied exactly the existing three extensions with backups, and passed `doctor`. Its DSH home, Agent configuration and default workspace documents live inside the new directory. No existing Desktop application or personal DSH profile was used.

Fresh verification passed the production build, Host/Client typechecks, 142 Host/Client/integration tests, 8 native contracts and 19 launcher tests. The launcher checks include ownership/path refusal, retry after partial preparation, dependency and native-hash mismatch, fresh artifact paths, and starting an already prepared runtime without npm or Git. macOS and Linux launcher checks are also configured in CI. A full Windows setup has not been verified.

The [Note Bundle workflow](demo-workflow.md) ran against a real configured model and the native UI. The Coordinator dispatched Exporter and Docs. A human changed the accepted ordering directly in Exporter while it was busy; native input queued the instruction for its next turn. The Coordinator received the ended-turn result, checked Worker state, aligned Docs, reviewed the result and closed. A later task reused the same Workers and accepted context to add Cherries without restating the sort order. The final output is Pears, Cherries, Bananas, apples; all 9 tests were independently rerun against the [published result files](demo-result).

After the runtime restarted, both Workers remained idle and the completed Coordinator turn stayed closed. The [60-second edit](media/project-workflow.mp4) uses normal-speed excerpts with waits omitted and labeled; it is not a completion-time benchmark. The prompts explicitly request delegation and reuse, so this demonstrates the coordination chain rather than unrestricted model judgment. The historical timeline Retry limitation below has not been fixed or declared resolved by this onboarding change.

## Maintenance fixes

- A real native regression reproduces a one-time Project A recovery read failure, then verifies Project B and Project A can finish later turns normally. A second regression verifies current Worker work still holds closure until its canonical result is consumed after a background warning.
- Native capacity rejection leaves an internal failed-provisioning record, but Coordinator list and public snapshots now omit it. A real Worker whose model execution fails remains an active, visible member.
- Host event bindings, mode lifecycle and pure snapshot assembly are separated; native mode locking, permissions, dispatch, Stop, result recovery and capsule anchors are exercised by the existing integration regressions.

The earlier audit confirmed both defects in 0.1.21; those findings are now covered by the above fix regressions. Fresh production build and **35 files / 142 tests**, Host/Client typechecks, and **2 files / 8 native contracts** passed. Fresh npm, Git-forwarder and Git consumers passed native loading, Remote roundtrips, declarations and disposal; clean-checkout npm ci also passed. An independent source review found no actionable issues and confirmed generated Remote descriptors were unchanged apart from source-location metadata.

## Desktop 0.1.22 real-model smoke

A separately installed 0.1.22 bundle ran in a new temporary workspace under Desktop 0.2.1-rc.3. The Coordinator called list then spawn; one Worker wrote two reusable facts and updated the shared index. The full final committed Worker AI payload matched the canonical received result exactly. There was one Worker turn, one Coordinator turn, one canonical result and a completed native Coordinator closure after 50 seconds, with result consumption before closure. The Coordinator independently read the index/facts and updated notes/archived. The visible capsule and collapsed Markdown timeline were inspected.

The initial timeline observation briefly returned a native session-not-found error for the newly created Worker; the existing Retry action recovered the timeline. This UI read timing issue remains a limitation and is separate from the fixed turn/error-isolation path. The task explicitly requested delegation, so it does not establish general natural-delegation quality. No test prompt was sent to an existing user conversation.

## 0.1.21 historical verification

Baseline: DSH 0.2.1-rc.3 with the repository's three explicit compatibility extensions; Node 24.19.0. Version: 0.1.21.

- Production build and 34 Host/Client/integration files: 139 tests passed.
- Host and Client typechecks passed.
- 2 native-contract files: 8 tests passed, using real native loader/renderer and original workspace browser.
- New regressions cover missing legacy context indexes, permission-denied nonblocking backfill, scoped native filesystem usage, shared Worker index updates, idle sidebar spacing, collapsed Markdown and the single empty panel state.
- A real Desktop model task in an isolated Project dispatched a Worker, wrote two reusable facts and updated the shared index. The Coordinator received the canonical final reply, checked the index/facts and updated notes/archived. One native Coordinator turn closed after 58 seconds.

The real model task explicitly asked for Worker delegation. It proves the memory and completion chain, not reliable unrestricted natural delegation. Natural task ownership remains model-dependent. UI-only polish was checked separately after installation. Public package verification uses fresh npm and Git-forwarder consumers; raw private acceptance logs and screenshots are intentionally not distributed.

See manual-verification.md for checks to repeat on a new runtime. Stock rc.3 refusal and successful explicit compatibility installation are both expected package-consumer checks.
