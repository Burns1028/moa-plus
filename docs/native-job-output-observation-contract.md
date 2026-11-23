# Native job-output observation contract

Status: independently reviewed on 2026-11-14; the implementation and exact
upgrade paths below passed scripted native regressions, without a real model.

This additive contract targets the audited `@deepseek-ai/dsh-tool-jobs`
0.2.1-rc.3 SDK/runtime and 0.2.2-rc.1 Desktop Next runtime. The native jobs
registry, tool executor and existing invocation retain ownership. It adds no
scheduler, persistent record, timer, retry, cancellation or shell-text parser.

## Observation and model rendering

`job_output` keeps its required `text` and `job` fields and accepts an optional
`observation` object, so previously valid values still render. Live successful
reads supply:

| Field | Meaning |
| --- | --- |
| `jobElapsedMs` | Nonnegative wall-clock age at the consuming read; a finished job uses its native `finishedAt`. |
| `waitedMs` | Actual monotonic time spent in this invocation's existing native wait; zero when waiting was not requested. |
| `waitOutcome` | `not-requested`, `settled`, `timeout` or `interrupted`, determined at the wait boundary. |
| `outputTotalBytes` | The registry's cumulative UTF-8 output counter, including observer-only log bytes. |
| `noNewOutput` | This invocation returns no model-visible delta or one-time result, including any already-held completion text. |

The renderer displays these facts in one compact observation line beside the
existing status. `noNewOutput` concerns the existing consuming cursor; it does
not establish inactivity or a stuck process. The byte counter is not a progress
percentage. Native `job.progress`/`detail` keep their current status rendering.
There is no invented deadline or inference from console text.

The producer's existing output limit remains authoritative. The original body
and status are fitted with the original truncation policy first. The new line
is included only if the untruncated original body, status and observation all
fit the same limit. Otherwise it is omitted, without displacing stdout/stderr
or exceeding a small explicit cap. No extra context or second text block can
bypass that limit. Structured execution values retain the observation even
when the model-facing line does not fit.

## Wait, ownership and read semantics

The existing `jobs.wait` call retains its exact timeout/default/cap, caller and
signal. Its returned projection decides `settled` versus `timeout`; a job that
settles between timeout and the consuming read can therefore truthfully report
`waitOutcome: timeout` and a terminal current status. rc.2's existing handled
user-steering interruption reports `interrupted`, rather than claiming a timeout.
An external Stop or other wait failure follows the existing error path and is
not converted into a successful observation. rc.3 has no handled steering branch
and preserves its existing abort behavior.

Exactly one existing `jobs.read` consumes the cursor. The observation uses that
same read's projection, not an additional read or a replacement registry. Owner
checks, one-time results, pending completion notices, released-read settlement
suppression and joined cancellation are unchanged. `job_list` and `job_kill`
retain their existing contracts. Registry and tool declarations are audited;
no exported declaration signature changes because these tools expose their
structured result through the registered runtime schema.

## Versioned application and validation

Each profile keeps the audited stock preimage and adds an exact upgrade entry
from its previously published patched bytes to the same new final bytes. This
allows the existing whole-profile preflight helper to accept stock, previous
patched and new patched installations without mixing profiles or weakening hash
checks. The package set and changed file paths do not grow. No installed desktop
archive is edited as part of this implementation.

Scripted native fixtures must cover model-visible metadata, no-wait and empty
cursor reads, timeout/settlement and the boundary race, failed and killed jobs,
owner isolation, one-time results, steering/Stop, unchanged wait arguments, and
byte limits with Unicode output. Exact stock and upgrade patch application,
final hashes and reapplication are checked independently. These tests do not
claim reduced model reasoning or improved task scores.

### Audited bytes and declarations

Only `@deepseek-ai/dsh-tool-jobs/lib/index.js` changes. The SDK and runtime rc.3
patches have identical JavaScript targets. Each profile adds one accepted
previous-patched variant; its package set and unique file paths are unchanged.

| Profile | Stock SHA-256 | Previous patched SHA-256 | New final SHA-256 |
| --- | --- | --- | --- |
| rc.3 SDK/runtime | `de5707b43480ba37c8e141e6f67674978f3a46d87d58390c18eb1659bb17ec2f` | `9ea6ad2e6d99539b746e92196ea97a9725651266636fcce51eedd95c745f18f9` | `898f47bc6c85f414febb61c01e3475d495348ba8f4179476e26759083d8ef29a` |
| rc.2 Desktop runtime | `7461570ac5d29f85b27b228d551911f392e5082651e93b83723b77e9b87de0b6` | `81c4f9f7a31e99757ae90667e922298312fdc39b9a56f9d1b7994941c4a77928` | `636a0f147c77333d0850febefa1857895c15cd321b1c10570c2fb42c5e9438db` |

The unchanged package-export fingerprint is
`7a7de9f136bc27b3f690b894f9faeb6150a479016652f48725241860e1200bdd`.
Both profiles use `dsh-tool-jobs-observation-upgrade-runtime.patch` for the
previous-patched path. The stock paths retain their existing filenames.

The rc.3 SDK declarations were read and remain unchanged:

| Package/file | Audited SHA-256 |
| --- | --- |
| `dsh-tool-jobs/lib/types/index.d.ts` | `03f56e906dee56abaaa0cf7227b7cbedcf73af23a7cebf647972680ad37bf98d` |
| `dsh-tool-jobs/lib/types/render.d.ts` | `fd3e39e67f91b18ce2fd751447f921e40179dbc84b1cf263e72fc8fe0b3d42c6` |
| `dsh-jobs/lib/types/index.d.ts` | `80f70ad2252c07ef6783f4aadf101457e71832eeea24cb55c11489e4bd96f41c` |
| `dsh-jobs/lib/types/view.d.ts` | `f87f6ddac10f62d179b7bf34a0ddd3cfe2379670e5e39e7a7d4d47a898b1b602` |

The inspected rc.2 Desktop packages omit these declarations; this profile
targets their runtime, as the rc.2 execution contract already specifies.
`PublicJobSnapshot`, `JobView`, the registry methods and `apply` signatures do
not change. The new result member is declared by the native registered output
schema, rather than an invented exported TypeScript interface.

### Scripted verification

Run `node --test tests/compat/native-job-output*.test.mjs`; additionally set
`MOA_COMPAT_MODULES` to a disposable matching rc.2 runtime's `node_modules` to
exercise both families. The fixture copies only the audited tool implementation
into an owned temporary directory, resolves its real peers from the selected
runtime, and uses the actual native jobs registry and tool pipeline. It never
patches either supplied modules directory and does not run a model.

With the rc.3 SDK and the matching rc.2 runtime on 2026-11-14: 18 cases,
16 passed, two explicit skips for the rc.3 branches that do not implement
successful steering release or held inline-completion delivery. Exact helper
preflight/application/reapplication passes for stock, previous-patched and new
final bytes in each family. These are behavior and installation-contract checks;
full application acceptance remains separate.
