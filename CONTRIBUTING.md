# Contributing

Start with [MOA responsibilities](docs/moa-architecture.md), the [code architecture and data model](docs/architecture.md), and the [tool contract](docs/tool-api.md). Preserve the Coordinator's existing judgment; do not add task-specific routing gates or human read/ack machinery.

## Local setup

Use Node 24.9+, npm and Git. This plugin targets DSH 0.2.1-rc.3 with the explicit native compatibility manifest in this checkout. The current unreleased runtime extends 13 native packages; v0.1.23 used three earlier extensions. Do not mix a plugin branch with an older runtime.

```sh
npm ci
node scripts/apply-native-compat.mjs --dry-run
node scripts/apply-native-compat.mjs --backup "$PWD/.superpowers/native-backup"
```

These commands modify only this checkout's native dependencies. They do not modify your installed DSH application. Read [compatibility](docs/compatibility.md) before preparing a separate runtime. Do not broaden or silently apply core patches. Additional native changes need a separately reviewed contract and exact runtime/declaration hashes in the manifest; see `docs/native-moa-contract.md` and `docs/native-moa-residency-contract.md`.

## Make a focused change

Edit `packages/project-mode/src`; generated `lib` artifacts are committed for Git installation. Build to regenerate them. Keep plugin state schemas separate from public view types, and keep execution state owned by DSH.

For behavior changes, add a regression covering a meaningful native or UI boundary, and run the relevant checks. Start with a focused test; before releasing, run the full integration and package checks:

```sh
npm test -- --maxWorkers=1
npm run typecheck
npm run test:native-contract
npm run test:launcher
npm run verify:package
```

The single-worker command is useful on a busy machine because several native integration fixtures use short bounded waits. Do not increase production timeouts or weaken assertions merely to conceal a failing test. For packaging changes, also run `npm run verify:package -- --git-ref=<commit-sha>` from a clean committed checkout; it checks actual Git installation and clean-checkout `npm ci` in addition to npm/forwarder artifacts.

`npm test` runs the production build first; the build also runs release preparation. There is no install/prepare lifecycle hook that patches a consumer's runtime.

## Test map

| Concern | Relevant tests |
| --- | --- |
| Scoped MoA controls, specialist roles, and native UI row contract | `tests/native-contract/standard-tool-isolation.spec.ts`, `sidebar-branch.spec.tsx` |
| Five primitives, role/identity/workspace/reporting integration | `tests/host/moa-agents.spec.ts`, `moa-controls-integration.spec.ts`, `moa-residency.spec.ts` |
| Request/ReplyTo, timeout, interruption, cycles, and recovery | `tests/host/moa-messages.spec.ts` |
| Native background transfer, canonical results, real Bash exit, and hard continuation | `tests/native-contract/moa-background.spec.ts` |
| Ralph and independent source/tool-backed completion gates | `tests/host/moa-completion.spec.ts` |
| Current-state Git snapshots and owned cleanup | `tests/host/moa-workspaces.spec.ts` |
| Background failure isolation and Worker membership | `tests/host/fault-isolation.spec.ts`, `review.spec.ts` |
| Same-turn closure, Stop and continuation | `tests/host/native.spec.ts`, `native-tool-continuation.spec.ts` |
| Result identity and recovery deduplication | `tests/host/native-receipt.spec.ts`, `native-receipt-recovery.spec.ts` |
| Capsule turn/segment ownership | `tests/host/capsule-provenance.spec.ts`, `tests/client/store.spec.ts` |
| Direct human operation of Workers | `tests/host/worker-sync.spec.ts` |
| Dialogue windows and final output | `tests/host/history-window.spec.ts`, `worker-timeline.spec.ts` |
| Shared progressive context and role prompts | `tests/host/project-memory.spec.ts`, `coordinator-guidance.spec.ts` |
| Mode lock, archival and parent retention | `tests/host/mode-lock.spec.ts`, `project-archive.spec.ts`, `tests/client/worker-parent.spec.ts` |
| Native right-side tabs and Markdown expansion | `tests/client/panels.spec.tsx` |
| Browser factory and native Remote discovery | `tests/client/boot.spec.ts`, `bundle.spec.ts`, `tests/integration/native-discovery.spec.ts` |
| Installation into fresh consumers | `scripts/verify-package.mjs` |
| Isolated runtime preparation, ownership, retry and verification | `tests/launcher/project-mode.test.mjs` |

Use [manual verification](docs/manual-verification.md) for real application changes. `tests/application/acceptance-provider` is a scripted model adapter, not proof of natural delegation quality. Do not send test prompts to an existing personal conversation.

## Documentation and releases

Keep README installation claims consistent with the compatibility helper. Separate unreleased branch capabilities from tagged v0.1.23 media and installation instructions; the existing package version does not announce a release. Update Tool API for transport changes and the architecture guide for ownership changes. Preserve published tags/assets; prepare a new release for runtime changes.

The optional first-run launcher lives in `scripts/project-mode.mjs`; its exact native dependency template and lockfile live in `runtime/rc3`. Keep preparation explicit, reuse the existing compatibility manifest, and verify setup in a new directory. Never use an existing personal profile as an installation fixture. The launcher CI exercises macOS and Linux; a full Windows installation has not been verified.

Keep contributions free of credentials, profiles, personal paths, conversations, private screenshots and raw application logs. Do not commit `.superpowers`, `node_modules` or consumer tarballs. Include the MIT license and third-party notices with redistributed bundles.
