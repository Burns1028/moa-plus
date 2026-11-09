# A project across Workers, human input and a later turn

The [Note Bundle starter](../examples/note-bundle) is a small dependency-free CLI with an intentionally unfinished `--sort title` option. Work on a copy in a new MoA conversation using the [isolated quick start](quickstart.md).

1. Ask the Coordinator:

   > Finish TASK.md with two Workers: Exporter owns the CLI and tests; Docs owns docs/usage.md. Delegate both, then review their real results. Use concise English. Keep it local: no dependencies or commits. Have Exporter save the accepted CLI contract and test command in shared context and its index so we can reuse them next turn. Run the tests and generate dist/notes.md.

2. Open Exporter and send directly:

   > Change of requirement: --sort title must order titles Z to A, ignoring case. Keep filename order when the option is omitted. Update the feature test and TASK.md to this accepted order, save the decision in shared context and its index, and report the command and actual heading order you tested.

3. Use **Back** and tell the Coordinator:

   > I changed the requirement directly in Exporter's conversation. Check the latest Worker state and relevant history, bring the docs into line with the accepted decision, then run npm test and generate dist/notes.md. Show the tested heading order, result files, and saved shared-context entry.

4. After completion, send a later task:

   > Continue with the existing Exporter and the saved project context. Add notes/40-cherries.md with the title Cherries and one short paragraph, then regenerate dist/notes.md using the accepted ordering. Verify the tests and show the heading order. No new dependencies or commits. Close any remaining old to-dos when done.

The accepted output should contain `Pears`, `Bananas`, `apples`; after the later task it should contain `Pears`, `Cherries`, `Bananas`, `apples`. The default command without `--sort` must keep filename ordering.

Check the actual files and tests, not just the model's summary. In the Workers panel, the human instruction belongs to Exporter's conversation; each ended Worker turn returns its full final AI message automatically. The Coordinator can inspect current state and read committed user/AI history when needed. The shared index and linked decision file should capture the reusable sorting contract for the later task.

The fixture starts with three passing baseline tests and one intentionally failing feature test. This is a reproducible task, not a benchmark or a guarantee that every model run will make the same decisions.
