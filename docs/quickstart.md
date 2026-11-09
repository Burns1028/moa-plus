# Try MoA+ in an isolated Web runtime

This is the recommended first-run route for the unofficial preview. It prepares DSH **0.2.1-rc.3** with the three audited compatibility extensions and the repository-built plugin. It does not modify an installed Desktop app or reuse `~/.dsh`.

MoA+ was previously called Project Mode. The commands below install the current source preview from `main`, whose session control is **MoA**. Published v0.1.23 still shows **Project Mode / Project** and uses `scripts/project-mode.mjs`. That legacy launcher remains supported; package IDs and runtime/data directories stay compatible.

## Install and start

Requires **Node 24.9+**, npm and Git on your PATH. The first setup downloads the locked native dependencies.

```sh
git clone https://github.com/Burns1028/moa-plus.git
cd moa-plus
node scripts/moa.mjs setup
node scripts/moa.mjs start
```

The start command opens the native DSH Web UI on a local address. Configure your model through its native settings, create a conversation, and select **MoA** before sending the first message. You may also supply your provider's `DEEPSEEK_API_KEY` in the launching environment; the launcher does not copy keys from another profile.

Setup is explicit: there is no npm install hook. It creates a private directory at `~/.dsh-project-mode/rc3` containing the runtime, its separate `home/` and `agents/`, the original native-file backups and the plugin archive. The default documents/workspace directory is also inside it. Your normal DSH conversations, workspaces, global Agent instructions and Desktop application stay in their existing locations.

## Check or choose the location

```sh
node scripts/moa.mjs doctor
node scripts/moa.mjs setup --dir /absolute/empty-directory
node scripts/moa.mjs start --dir /absolute/empty-directory
```

Use an empty directory outside this checkout and your normal DSH home. Symlinked paths are refused; on macOS the canonical temporary root is `/private/tmp`, while `/tmp` is a system symlink. Always reuse the same `--dir` for setup, doctor and start. To test changed plugin source, choose a new empty directory even when its version is unchanged: setup verifies and reuses an already prepared runtime instead of reinstalling changed source.

`doctor` is read-only. It checks the runtime lock, expected package versions, the built plugin archive and the applied native file hashes. A successful dry-run patch preflight alone is not considered a prepared runtime: all three extensions must already be present.

Extra native Web arguments go after `--`, for example:

```sh
node scripts/moa.mjs start -- --no-open --port 8080
```

By default the server listens on `127.0.0.1` and selects an available port. Ctrl+C stops the Web runtime. Closing its browser tab does not stop the terminal process.

## First project

Copy [the public Note Bundle starter](../examples/note-bundle) to a new workspace and follow [the demo task](demo-workflow.md). No package installation is needed for the sample itself. Its initial suite intentionally has one failing test for the requested feature; the task is to implement it, update it after a human requirement change, and prove the final output.

## Recovery and boundaries

If a download is interrupted, rerun the same setup command. Only a directory carrying this launcher's valid ownership marker can be retried. A prepared runtime is reused after verification; a different runtime template or plugin version needs a new empty directory. Existing native backups are preserved and checked.

Use the ordinary native DSH settings for model and permission choices. The launcher only assembles the existing runtime and plugin; it does not add task routing rules or a separate scheduler. Removing or archiving a Coordinator conversation follows native/plugin behavior.

To stop using this preview, stop its terminal process and keep its directory if you want the project records. You do not need to uninstall or restore your normal Desktop application. See [Compatibility](compatibility.md) for manually preparing another runtime; stock rc.3 remains incompatible.
