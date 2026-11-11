# Run MoA+ in an isolated DSH Web runtime

Set up **MoA+ v0.2.7** in a separate local Web environment. Requires **Node 24.9+**, npm, and Git, plus the matching **DSH 0.2.1-rc.3 compatibility runtime**. Its explicit manifest extends **22 native packages across 50 file paths**; stock rc.3 and runtimes prepared from another plugin revision cannot be substituted.

The same release also provides an audited **DSH 0.2.2-rc.1 / DSH Next 2.0.22-next** profile. The launcher here remains pinned to rc.3; use the separate [native compatibility instructions](native-compatibility.md) to prepare Desktop Next with a full application backup.

## Install and start

Choose a new empty directory outside this checkout and your ordinary DSH home. Replace `/absolute/empty-moa-runtime` below and reuse the same `--dir` for setup, doctor, and start.

```sh
git clone --branch v0.2.7 --single-branch https://github.com/Burns1028/moa-plus.git
cd moa-plus
npm ci
node scripts/apply-native-compat.mjs --dry-run
node scripts/apply-native-compat.mjs --backup "$PWD/.superpowers/native-backup"
npm run build
node scripts/project-mode.mjs setup --dir /absolute/empty-moa-runtime
node scripts/project-mode.mjs start --dir /absolute/empty-moa-runtime
```

The compatibility command backs up the changed files before extending this checkout's dependencies. Setup installs the locked runtime and this plugin build in the chosen directory, with its own `home/`, `agents/`, configuration, documents, native backups, and plugin archive. It does not modify an installed Desktop app or reuse your personal `~/.dsh` profile.

Worker record protection requires the matching native filesystem and shell providers. macOS uses Seatbelt; on Linux, install bubblewrap and make sure its user namespaces are available. Landlock-only, Windows ACL and unaudited custom runners cannot execute protected Worker shell commands with this path-specific policy. Windows native file inspection remains available. If a Verifier encounters that unavailable shell while commands are optional, it removes the tool for the current review and continues with actual file or candidate inspection. Required command execution still fails explicitly and waits for native cleanup. See [compatibility](compatibility.md) for the exact limits.

Keep the plugin build, runtime lockfile, and compatibility manifest from the same checkout. A dry-run preflight does not apply changes. The [compatibility guide](compatibility.md) covers manual installation and rollback.

## Configure a conversation

The start command opens the native DSH Web UI locally. Configure your model using its native settings, create a conversation, and select **MoA+** before sending its first message. Mode identity remains fixed after starting.

You can supply the provider's `DEEPSEEK_API_KEY` in the launching environment. The launcher does not copy keys from another profile. Choose model and permissions in the native settings.

The Web server listens on `127.0.0.1` by default and selects an available port. Ctrl+C stops it; closing the browser tab leaves the terminal process running.

## Check or choose the location

```sh
node scripts/project-mode.mjs doctor --dir /absolute/empty-moa-runtime
node scripts/project-mode.mjs start --dir /absolute/empty-moa-runtime -- --no-open --port 8080
```

`doctor` is read-only. It checks ownership, runtime lock/package versions, the plugin artifact, and applied native hashes. Symlinked paths are refused; on macOS, the canonical temporary root is `/private/tmp` rather than `/tmp`.

The default location, `~/.dsh-project-mode/rc3`, and the profile/package names remain compatibility identifiers. An explicit `--dir` keeps this runtime separate from earlier installations.

## Give the team its first task

Use a Git workspace for default isolated Workers. Give the Coordinator a complete goal and observable expected result. It can create specialists with `Task`, branch useful history with `Fork`, or continue existing Workers with `SendMessage`. To work directly in the parent's directory, choose `workspace: "shared"` explicitly. See the [Tool API](tool-api.md) for current calls.

The [Note Bundle starter](../examples/note-bundle) is a small task fixture with one intentionally failing feature test. Copy it to a new workspace, initialize Git if using isolated Workers, and follow its feature request.

Click a Worker capsule to enter its native conversation, give it instructions directly, and use Back to return to the Coordinator. Each finished Worker turn returns its complete final AI message to its designated reporting Agent; its conversation remains available for another assignment.

New workspaces contain `notes.md`, `archived.md`, and `context/index.md`; independent acceptance can publish `rubrics.md`. Coordinator and Workers share Context even across isolated worktrees. Conversations in the same directory share these files, so use a separate workspace for an independent project. See [roles and common flows](moa-architecture.md) for the collaboration model.

For an optional collaboration prompt, type `@` and choose **并行攻坚**, **多方会审**, **协同探索**, **迭代精修**, or **统筹推进**. Selection inserts editable text; add the actual task and send normally. A simple chat acknowledgement or clarification does not require a team or workspace investigation. See the [orchestration guide](orchestration.md).

## Restart and recovery

If downloading is interrupted, rerun setup with the same directory. Only a directory carrying a valid launcher ownership marker can be retried. Setup verifies a prepared runtime before reuse and retains its checked native backups. A changed runtime template or plugin artifact needs a new empty directory.

Native Session persistence preserves collaboration and result-delivery records for interrupted work. Retained Workers can continue with new input. See [verification](verification.md) for current-runtime evidence and [manual verification](manual-verification.md) for model/UI checks beyond installation.

To stop a trial, stop its terminal process. Keep its directory if you need the work records; [compatibility](compatibility.md) explains reversal.

## Earlier published Project Mode

For the **v0.1.23** tag, follow its [installation instructions](https://github.com/Burns1028/moa-plus/tree/v0.1.23#quick-start). It uses the Project label, the earlier `control_workers` interface, and three compatibility extensions. Use that tag's build and runtime together. Its [demo recording](demo-workflow.md) illustrates that version's workflow; current tool contracts are documented separately in the [Tool API](tool-api.md).
