# Try MoA+ in an isolated DSH Web runtime

The launcher prepares a separate DSH **0.2.1-rc.3** environment with the checked-out plugin and its exact compatibility manifest. It does not modify an installed Desktop app or reuse the personal `~/.dsh` profile. Requires **Node 24.9+**, npm, and Git.

## Choose the implementation

The published **v0.1.23** preview has persistent coordination and the original three compatibility extensions:

```sh
git clone --branch v0.1.23 https://github.com/Burns1028/moa-plus.git
cd moa-plus
node scripts/project-mode.mjs setup
node scripts/project-mode.mjs start
```

That version uses the **Project** label and earlier `control_workers` model interface. Its [Note Bundle recording](demo-workflow.md) is historical evidence for that version.

The **unreleased MoA runtime** adds the five primitives and wider reviewed native runtime. It is available on `main` following [PR #3](https://github.com/Burns1028/moa-plus/pull/3). Clone main, then prepare a new directory:

```sh
git clone --branch main --single-branch https://github.com/Burns1028/moa-plus.git
cd moa-plus
npm ci
node scripts/apply-native-compat.mjs --dry-run
node scripts/apply-native-compat.mjs --backup "$PWD/.superpowers/native-backup"
npm run build
node scripts/project-mode.mjs setup --dir /absolute/empty-moa-runtime
node scripts/project-mode.mjs start --dir /absolute/empty-moa-runtime
```

Use the same checkout's plugin build, runtime lockfile, and manifest. Do not install the current plugin into an older three-extension runtime. Full integration and real-model/UI acceptance for the current runtime are tracked in [verification](verification.md); these commands are not a new release announcement.

## Configure and start a conversation

The start command opens the native DSH Web UI locally. Configure your model using its native settings, create a conversation, and select **MoA+** before sending its first message. Mode identity remains fixed after starting. The older v0.1.23 UI instead says Project.

You can supply the provider's `DEEPSEEK_API_KEY` in the launching environment. The launcher does not copy keys from another profile. Native model and permission choices remain yours.

Setup explicitly creates a separate runtime directory containing its own `home/`, `agents/`, documents, native backups, and plugin archive. The default historical location is `~/.dsh-project-mode/rc3`; the directory/profile/package names remain compatibility identifiers. For current runtime testing, `--dir` makes it easy to keep a new runtime separate from an older trial.

## Check or choose the location

```sh
node scripts/project-mode.mjs doctor --dir /absolute/empty-moa-runtime
node scripts/project-mode.mjs start --dir /absolute/empty-moa-runtime -- --no-open --port 8080
```

Use an empty directory outside this checkout and the ordinary DSH home, then reuse the same `--dir` for setup, doctor, and start. Symlinked paths are refused; on macOS, the canonical temporary root is `/private/tmp` rather than `/tmp`.

`doctor` is read-only. It checks ownership, runtime lock/package versions, the plugin artifact, and applied native hashes. A dry-run preflight alone does not prepare an environment: all runtime changes from that checkout's manifest must already be applied.

The Web server listens on `127.0.0.1` by default and selects an available port. Ctrl+C stops it. Closing the browser tab does not stop the terminal process.

## First task

Use a new Git workspace for the current runtime's default isolated Workers. Give the Coordinator a complete goal and observable expected result. It can create specialists with Task, branch useful history with Fork, or continue existing Workers with SendMessage. For an assignment that should directly use the parent's directory, choose `workspace: "shared"` explicitly.

The public [Note Bundle starter](../examples/note-bundle) is a small task fixture with one intentional failing feature test. Copy it to a new workspace, initialize Git if using isolated Workers, and follow its feature request. The older [demo workflow](demo-workflow.md) illustrates the goal and human intervention, but its old tool names are not the current API. See [Tool API](tool-api.md) for current calls.

New workspaces contain `notes.md`, `archived.md`, and `context/index.md`; independent acceptance can publish `rubrics.md`. Context is shared even when execution uses separate worktrees. Same-cwd conversations share these files, so choose a separate workspace for an independent project.

## Restart and recovery

If downloading is interrupted, rerun the same setup. Only a directory carrying a valid launcher ownership marker can be retried. A prepared runtime is verified before reuse; a changed runtime template/plugin artifact needs a new empty directory. Existing native backups are retained and checked.

Native Session persistence and identified MoA admissions/results support interrupted work recovery. Cold Workers restore through their true parent chain without fake prompts. New input can continue a retained Worker; no browser credentials or personal sessions are needed to test this path.

To stop a trial, stop its terminal process and keep its directory if the work records are needed. See [compatibility](compatibility.md) for a manual runtime route and reversal. See [manual verification](manual-verification.md) for actual model/UI checks beyond installation.
