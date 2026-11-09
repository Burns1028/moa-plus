import ts from "typescript";
import { cp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
/** Exact published declaration mirrors for rc.3's workspace-only symbol recognizer. Never shipped. */
export async function withProtocolWorkspace(run) {
  const aggregate = resolve("tsconfig.host.json"),
    before = await readFile(aggregate, "utf8"),
    created = [];
  const config = JSON.parse(before);
  // Start from the normal host compiler program. Unrelated installed Client
  // packages never become roots of the build-only declaration workspace.
  const parsed = ts.getParsedCommandLineOfConfigFile(
    resolve("packages/moa/tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        );
      },
    },
  );
  if (!parsed) throw new Error("Cannot load host compiler configuration");
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  const dependencies = new Set(
    program
      .getSourceFiles()
      .map(
        (file) =>
          file.fileName.match(/node_modules\/@deepseek-ai\/(dsh-[^/]+)\//)?.[1],
      )
      .filter(Boolean),
  );
  config.compilerOptions = {
    target: "ES2024",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    skipLibCheck: true,
    types: ["node"],
    paths: {},
  };
  try {
    for (const name of [...dependencies].sort()) {
      const source = resolve("node_modules/@deepseek-ai", name),
        native = JSON.parse(
          await readFile(join(source, "package.json"), "utf8"),
        );
      if (!name.startsWith("dsh-")) continue;
      const dir = resolve("packages", `_build-${name}`);
      await mkdir(dir);
      created.push(dir);
      await cp(join(source, "lib"), join(dir, "declarations/lib"), {
        recursive: true,
        filter: async (path) =>
          (await stat(path)).isDirectory() || path.endsWith(".d.ts"),
      });
      const exports = {};
      for (const [key, value] of Object.entries(native.exports ?? {})) {
        const type =
          typeof value === "object" && value !== null
            ? value.types
            : typeof value === "string" && value.endsWith(".d.ts")
              ? value
              : undefined;
        if (typeof type !== "string") continue;
        const target = `./declarations/${type.replace(/^\.\//, "")}`;
        exports[key] = { types: target, default: target };
        config.compilerOptions.paths[
          `${native.name}${key === "." ? "" : key.slice(1)}`
        ] = [join(dir, target)];
      }
      // Preserve exact public type exports and native face metadata. The public
      // analyzer selects only our package for emission, never these mirrors.
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: native.name,
          version: native.version,
          type: "module",
          exports,
          dsh: native.dsh,
        }),
      );
      await writeFile(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { composite: true, skipLibCheck: true },
          files: Object.entries(exports)
            .filter(
              ([key]) =>
                key !== "./client" &&
                !key.startsWith("./client/") &&
                key !== "./remote",
            )
            .map(([, value]) => value.types),
        }),
      );
      config.references.push({ path: dir });
    }
    await writeFile(aggregate, JSON.stringify(config, null, 2));
    return await run();
  } finally {
    await writeFile(aggregate, before);
    for (const dir of created) await rm(dir, { recursive: true, force: true });
  }
}
