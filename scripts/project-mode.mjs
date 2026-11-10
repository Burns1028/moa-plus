#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeVersion = "0.2.1-rc.3";
const profileName = "project-mode";
const markerName = ".project-mode-runtime.json";
const lockName = ".project-mode-setup.lock";
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const stat = (path) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
};
const within = (path, root) => path === root || path.startsWith(root + sep);

function noSymlinks(path) {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (stat(cursor)?.isSymbolicLink())
      throw new Error(`Refusing symlink in runtime path: ${cursor}`);
  }
  return absolute;
}

function safeDirectory(path) {
  const directory = resolve(path);
  const protectedPaths = [
    join(homedir(), ".dsh"),
    join(homedir(), ".agents"),
    join(homedir(), ".ssh"),
    "/Applications",
    "/System",
    "/Library",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    repository,
  ];
  if (
    protectedPaths.some(
      (protectedPath) =>
        within(directory, protectedPath) || within(protectedPath, directory),
    )
  )
    throw new Error(`Refusing protected runtime directory: ${directory}`);
  noSymlinks(directory);
  if (stat(directory) && !stat(directory).isDirectory())
    throw new Error(`Runtime path is not a directory: ${directory}`);
  return directory;
}

function layout(directory) {
  return {
    directory,
    marker: join(directory, markerName),
    lock: join(directory, lockName),
    home: join(directory, "home"),
    agents: join(directory, "agents"),
    documents: join(directory, "workspace-documents"),
    profile: join(directory, "home/profiles", profileName),
    modules: join(directory, "home/profiles", profileName, "node_modules"),
    artifacts: join(directory, "artifacts"),
    backup: join(directory, "native-backup"),
  };
}

function readMarker(paths, optional = false) {
  noSymlinks(paths.marker);
  if (!stat(paths.marker)) {
    if (optional) return undefined;
    throw new Error("Missing runtime ownership marker; run setup first.");
  }
  let marker;
  try {
    marker = json(paths.marker);
  } catch {
    throw new Error("Malformed runtime ownership marker; no files changed.");
  }
  if (
    !stat(paths.marker).isFile() ||
    marker?.schemaVersion !== 1 ||
    marker.kind !== "dsh-project-mode-runtime" ||
    marker.directory !== paths.directory ||
    marker.profile !== profileName ||
    marker.runtimeVersion !== runtimeVersion ||
    !["preparing", "failed", "ready"].includes(marker.status)
  )
    throw new Error("Invalid runtime ownership marker; no files changed.");
  for (const path of [
    paths.home,
    paths.agents,
    paths.documents,
    paths.profile,
    paths.modules,
    paths.artifacts,
    paths.backup,
  ])
    noSymlinks(path);
  return marker;
}

function baseMarker(paths) {
  return {
    schemaVersion: 1,
    kind: "dsh-project-mode-runtime",
    directory: paths.directory,
    profile: profileName,
    runtimeVersion,
  };
}

function writeMarker(paths, marker, exclusive = false) {
  noSymlinks(paths.marker);
  writeFileSync(paths.marker, JSON.stringify(marker, null, 2) + "\n", {
    flag: exclusive ? "wx" : "w",
    mode: 0o600,
  });
}

function templates() {
  const directory = join(repository, "runtime/rc3");
  const packagePath = join(directory, "package.json");
  const lockPath = join(directory, "package-lock.json");
  const packageJson = json(packagePath);
  const lock = json(lockPath);
  const lockedDependencies = lock.packages?.[""]?.dependencies ?? {};
  if (
    packageJson.name !== "dsh-profile-project-mode" ||
    packageJson.dependencies?.["@deepseek-ai/dsh"] !== runtimeVersion ||
    lock.packages?.[""]?.name !== packageJson.name ||
    Object.keys(lockedDependencies).length !==
      Object.keys(packageJson.dependencies).length ||
    !Object.entries(packageJson.dependencies).every(
      ([name, version]) => lockedDependencies[name] === version,
    )
  )
    throw new Error("Runtime template and exact dependency lock do not agree.");
  const bundles = packageJson.dsh?.profile?.bundles;
  if (
    !Array.isArray(bundles) ||
    ![
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "dsh-plugin-project-mode",
    ].every((name) => bundles.includes(name))
  )
    throw new Error(
      "Runtime template is missing the official Web profile bundles.",
    );
  return {
    packagePath,
    lockPath,
    packageJson,
    packageSha256: hash(packagePath),
    lockSha256: hash(lockPath),
  };
}

function run(
  command,
  args,
  paths,
  { cwd = paths.profile, capture = false } = {},
) {
  const invocation =
    command === "npm" ? npmInvocation(args) : { command, args };
  const child = spawnSync(invocation.command, invocation.args, {
    cwd,
    env: {
      ...process.env,
      DSH_HOME: paths.home,
      DSH_AGENTS_HOME: paths.agents,
    },
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    shell: false,
  });
  if (child.error)
    throw new Error(
      `Cannot run ${command}: ${child.error.code ?? child.error.message}`,
    );
  if (child.status !== 0) {
    if (capture && child.stderr) process.stderr.write(child.stderr);
    throw new Error(`${command} failed (${child.signal ?? child.status}).`);
  }
  return child.stdout ?? "";
}

export function npmInvocation(
  args,
  {
    platform = process.platform,
    execPath = process.execPath,
    env = process.env,
  } = {},
) {
  if (platform !== "win32") return { command: "npm", args };
  const directories = [
    dirname(execPath),
    ...(env.PATH ?? env.Path ?? "")
      .split(";")
      .filter(Boolean)
      .map((path) => path.replace(/^"(.*)"$/, "$1")),
    ...(env.APPDATA ? [join(env.APPDATA, "npm")] : []),
  ];
  for (const directory of directories) {
    for (const candidate of [
      join(directory, "node_modules/npm/bin/npm-cli.js"),
      resolve(directory, "../lib/node_modules/npm/bin/npm-cli.js"),
      join(directory, "npm-cli.js"),
    ]) {
      if (stat(candidate)?.isFile())
        return { command: execPath, args: [candidate, ...args] };
    }
  }
  throw new Error(
    "Cannot locate npm-cli.js; install Node with npm or add the npm installation directory to PATH.",
  );
}

function requireNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 24 || (major === 24 && minor < 9))
    throw new Error("Node 24.9 or newer is required.");
}

function prerequisites(paths) {
  requireNode();
  for (const command of ["npm", "git"])
    run(command, ["--version"], paths, { cwd: repository, capture: true });
}

function nativeEntries() {
  return json(join(repository, "compat/rc3/manifest.json")).filter(
    (entry, index, entries) =>
      entry.variant !== "desktop" &&
      entries.findIndex((other) => other.package === entry.package) === index,
  );
}

function checkPackage(paths, name, version) {
  const root = join(paths.modules, name);
  noSymlinks(root);
  noSymlinks(join(root, "package.json"));
  if (json(join(root, "package.json")).version !== version)
    throw new Error(`Unsupported ${name} version; expected ${version}.`);
  return root;
}

function verifyNative(paths) {
  nativeLocations(paths);
  for (const entry of nativeEntries()) {
    const root = checkPackage(paths, entry.package, entry.version);
    for (const file of entry.files) {
      const target = noSymlinks(join(root, file.file));
      if (hash(target) !== file.after)
        throw new Error(
          `Runtime is unpatched, altered or incomplete; native compatibility hash mismatch: ${entry.package}/${file.file}`,
        );
    }
  }
  // A successful helper preflight can mean the runtime is still entirely unpatched.
  const output = run(
    process.execPath,
    [
      join(repository, "scripts/apply-native-compat.mjs"),
      "--modules",
      paths.modules,
      "--dry-run",
    ],
    paths,
    { capture: true },
  );
  if (!/Preflight passed for 0 native package patches;/.test(output))
    throw new Error(
      "Runtime is unpatched or incomplete; setup must apply all reviewed native compatibility extensions.",
    );
}

function nativeLocations(paths) {
  for (const entry of nativeEntries()) {
    const root = checkPackage(paths, entry.package, entry.version);
    for (const file of entry.files) noSymlinks(join(root, file.file));
  }
}

function initializeProfile(paths) {
  for (const path of [paths.profile, paths.agents, paths.documents]) {
    noSymlinks(path);
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const patch = noSymlinks(join(paths.profile, "cordis.patch.yml"));
  if (!stat(patch))
    writeFileSync(
      patch,
      JSON.stringify(
        [
          {
            id: "workspace-controller",
            config: { documentsDirectory: paths.documents },
          },
        ],
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  if (!stat(patch).isFile())
    throw new Error("Profile patch must be a regular file.");
}

function verifyFiles(paths, marker, source) {
  for (const path of [paths.agents, paths.documents])
    if (!stat(path)?.isDirectory())
      throw new Error(
        "Runtime isolation directories are missing; run setup again.",
      );
  const profilePatch = noSymlinks(join(paths.profile, "cordis.patch.yml"));
  if (!stat(profilePatch)?.isFile())
    throw new Error(
      "Runtime workspace isolation patch is missing; run setup again.",
    );
  for (const name of ["package.json", "package-lock.json"])
    noSymlinks(join(paths.profile, name));
  if (
    hash(join(paths.profile, "package.json")) !== source.packageSha256 ||
    hash(join(paths.profile, "package-lock.json")) !== source.lockSha256 ||
    marker.runtimePackageSha256 !== source.packageSha256 ||
    marker.runtimeLockSha256 !== source.lockSha256
  )
    throw new Error(
      "Runtime package or lock integrity changed; use a fresh --dir for another runtime template.",
    );
  for (const [name, version] of Object.entries(source.packageJson.dependencies))
    checkPackage(paths, name, version);
  const archive = marker.pluginArchive;
  if (
    !archive ||
    typeof archive.file !== "string" ||
    isAbsolute(archive.file) ||
    !within(resolve(paths.directory, archive.file), paths.artifacts) ||
    typeof archive.sha256 !== "string"
  )
    throw new Error("Invalid plugin archive metadata in runtime marker.");
  const archivePath = noSymlinks(resolve(paths.directory, archive.file));
  if (hash(archivePath) !== archive.sha256)
    throw new Error("Plugin archive integrity changed.");
  if (marker.pluginVersion !== json(join(repository, "package.json")).version)
    throw new Error(
      "Plugin source version differs from the prepared runtime; use a fresh --dir to set up this version.",
    );
  checkPackage(paths, "dsh-plugin-project-mode", marker.pluginVersion);
  noSymlinks(join(paths.modules, "@deepseek-ai/dsh/lib/bin.js"));
  if (!stat(join(paths.modules, "@deepseek-ai/dsh/lib/bin.js"))?.isFile())
    throw new Error("Official DSH CLI is missing.");
}

function inspect(paths) {
  const marker = readMarker(paths);
  if (marker.status !== "ready")
    throw new Error(
      `Runtime setup is incomplete (${marker.status}); run setup again before start.`,
    );
  requireNode();
  verifyFiles(paths, marker, templates());
  verifyNative(paths);
  return marker;
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error(
      "Invalid setup lock PID; inspect the owned runtime before retrying.",
    );
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

function acquireLock(paths) {
  noSymlinks(paths.lock);
  if (stat(paths.lock)) {
    let lock;
    try {
      lock = json(paths.lock);
    } catch {
      throw new Error(
        "Malformed setup lock; inspect the owned runtime before retrying.",
      );
    }
    if (lock.directory !== paths.directory || processAlive(lock.pid))
      throw new Error(
        "Another setup process owns this runtime; wait for it to finish.",
      );
    unlinkSync(paths.lock);
  }
  writeFileSync(
    paths.lock,
    JSON.stringify({ directory: paths.directory, pid: process.pid }),
    { flag: "wx", mode: 0o600 },
  );
}

function verifyRetry(paths, source) {
  for (const [name, expected] of [
    ["package.json", source.packageSha256],
    ["package-lock.json", source.lockSha256],
  ]) {
    const path = noSymlinks(join(paths.profile, name));
    if (stat(path) && hash(path) !== expected)
      throw new Error(
        `Refusing to overwrite changed owned profile ${name}; use a fresh --dir.`,
      );
  }
  const variants = json(join(repository, "compat/rc3/manifest.json")).filter(
    (entry) => entry.variant !== "desktop",
  );
  for (const entry of nativeEntries())
    for (const file of entry.files) {
      const path = noSymlinks(join(paths.backup, entry.package, file.file));
      if (
        stat(path) &&
        !variants
          .filter((candidate) => candidate.package === entry.package)
          .some((candidate) =>
            candidate.files.some(
              (preimage) =>
                preimage.file === file.file && preimage.before === hash(path),
            ),
          )
      )
        throw new Error(
          "Original native backup integrity changed; refusing to overwrite it.",
        );
    }
  noSymlinks(join(paths.backup, "native-compat.json"));
}

function setup(paths) {
  const existing = readMarker(paths, true);
  if (existing?.status === "ready") {
    initializeProfile(paths);
    inspect(paths);
    console.log(`MoA+ runtime is ready: ${paths.directory}`);
    return;
  }
  if (!existing && stat(paths.directory) && readdirSync(paths.directory).length)
    throw new Error(
      "Refusing populated directory without a valid ownership marker; choose an empty --dir.",
    );
  const source = templates();
  prerequisites(paths);
  if (existing) verifyRetry(paths, source);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  if (!existing)
    writeMarker(paths, { ...baseMarker(paths), status: "preparing" }, true);
  acquireLock(paths);
  let stage = "dependencies";
  try {
    writeMarker(paths, { ...baseMarker(paths), status: "preparing", stage });
    initializeProfile(paths);
    mkdirSync(paths.artifacts, { recursive: true, mode: 0o700 });
    for (const [origin, name] of [
      [source.packagePath, "package.json"],
      [source.lockPath, "package-lock.json"],
    ]) {
      const target = noSymlinks(join(paths.profile, name));
      if (!stat(target)) copyFileSync(origin, target, constants.COPYFILE_EXCL);
    }
    run("npm", ["ci", "--no-audit", "--no-fund"], paths);
    stage = "plugin";
    const packDirectory = mkdtempSync(join(paths.artifacts, "pack-"));
    const packed = JSON.parse(
      run(
        "npm",
        [
          "pack",
          "--ignore-scripts",
          "--workspaces=false",
          "--json",
          "--pack-destination",
          packDirectory,
        ],
        paths,
        { cwd: repository, capture: true },
      ),
    );
    const pluginVersion = json(join(repository, "package.json")).version;
    const filename = packed[0]?.filename;
    if (
      packed.length !== 1 ||
      packed[0].name !== "dsh-plugin-project-mode" ||
      packed[0].version !== pluginVersion ||
      typeof filename !== "string" ||
      filename !== filename.split(/[\\/]/).pop()
    )
      throw new Error("Unexpected npm pack result.");
    const archive = noSymlinks(join(packDirectory, filename));
    run(
      "npm",
      [
        "install",
        archive,
        "--no-save",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      paths,
    );
    stage = "compatibility";
    verifyRetry(paths, source);
    nativeLocations(paths);
    run(
      process.execPath,
      [
        join(repository, "scripts/apply-native-compat.mjs"),
        "--modules",
        paths.modules,
        "--backup",
        paths.backup,
      ],
      paths,
    );
    const ready = {
      ...baseMarker(paths),
      status: "ready",
      pluginVersion,
      pluginArchive: {
        file: relative(paths.directory, archive),
        sha256: hash(archive),
      },
      runtimePackageSha256: source.packageSha256,
      runtimeLockSha256: source.lockSha256,
    };
    stage = "verification";
    verifyFiles(paths, ready, source);
    verifyNative(paths);
    writeMarker(paths, ready);
    console.log(`MoA+ runtime is ready: ${paths.directory}`);
    console.log(
      "Run the start command with --dir set to the runtime directory shown above.",
    );
  } catch (error) {
    writeMarker(paths, { ...baseMarker(paths), status: "failed", stage });
    throw error;
  } finally {
    unlinkSync(paths.lock);
  }
}

async function start(paths, args) {
  inspect(paths);
  const defaults = [];
  for (const [option, value] of [
    ["--host", "127.0.0.1"],
    ["--port", "0"],
  ])
    if (!args.some((arg) => arg === option || arg.startsWith(`${option}=`)))
      defaults.push(option, value);
  const child = spawn(
    process.execPath,
    [
      join(paths.modules, "@deepseek-ai/dsh/lib/bin.js"),
      "--profile",
      profileName,
      ...defaults,
      ...args,
    ],
    {
      cwd: paths.profile,
      env: {
        ...process.env,
        DSH_HOME: paths.home,
        DSH_AGENTS_HOME: paths.agents,
      },
      stdio: "inherit",
    },
  );
  const forward = (signal) => {
    if (child.exitCode === null) child.kill(signal);
  };
  const onInterrupt = () => forward("SIGINT");
  const onTerminate = () => forward("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try {
    return await new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        accept(
          code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1),
        ),
      );
    });
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

async function main(argv) {
  const split = argv.indexOf("--");
  const options = split < 0 ? argv : argv.slice(0, split);
  const forwarded = split < 0 ? [] : argv.slice(split + 1);
  if (
    options.includes("--help") ||
    options.includes("-h") ||
    options.length === 0
  ) {
    console.log(
      "Usage: node scripts/project-mode.mjs setup|start|doctor [--dir PATH] [-- WEB_ARGS]\n\nRequires Node 24.9+; setup also requires npm and Git. Default: ~/.dsh-project-mode/rc3\nsetup  Install the pinned Web runtime and the reviewed compatibility extensions.\nstart  Check and launch the isolated official DSH Web runtime.\ndoctor Check ownership, exact native versions, lock, archive and applied patch hashes.\n\nArguments after -- are forwarded to start; --host defaults to 127.0.0.1 and --port to 0.\nAll child processes use the isolated DSH_HOME; personal ~/.dsh and applications are untouched.",
    );
    return 0;
  }
  const command = options.shift();
  if (!["setup", "start", "doctor"].includes(command))
    throw new Error("Expected setup, start or doctor. Use --help for usage.");
  let directory = join(homedir(), ".dsh-project-mode/rc3");
  if (options.length) {
    if (
      options.length !== 2 ||
      options[0] !== "--dir" ||
      !options[1] ||
      options[1].startsWith("--")
    )
      throw new Error("Expected --dir PATH. Use --help for usage.");
    directory = options[1];
  }
  if (forwarded.length && command !== "start")
    throw new Error("Only start accepts arguments after --.");
  if (
    forwarded.some(
      (arg) =>
        arg === "--profile" ||
        arg.startsWith("--profile=") ||
        arg === "-p" ||
        arg.startsWith("-p="),
    )
  )
    throw new Error(
      "Cannot override --profile; start always uses the isolated project-mode profile.",
    );
  const paths = layout(safeDirectory(directory));
  if (command === "setup") setup(paths);
  if (command === "doctor") {
    inspect(paths);
    console.log(
      `MoA+ runtime is ready; all reviewed native extensions are applied: ${paths.directory}`,
    );
  }
  return command === "start" ? start(paths, forwarded) : 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`Project Mode: ${error.message}`);
    process.exitCode = 1;
  }
}
