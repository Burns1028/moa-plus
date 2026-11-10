import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  rmSync,
  chmodSync,
  existsSync,
  copyFileSync,
  lstatSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/project-mode.mjs");
const markerName = ".project-mode-runtime.json";
const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
function temporary(t) {
  const path = realpathSync(
    mkdtempSync(join(tmpdir(), "project-mode-launcher-")),
  );
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function cli(...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}
function marker(directory, status = "preparing") {
  return {
    schemaVersion: 1,
    kind: "dsh-project-mode-runtime",
    directory,
    profile: "project-mode",
    runtimeVersion: "0.2.1-rc.3",
    status,
  };
}

function readyFixture(t, { stock = false } = {}) {
  const directory = temporary(t);
  const profile = join(directory, "home/profiles/project-mode");
  const modules = join(profile, "node_modules");
  mkdirSync(modules, { recursive: true });
  mkdirSync(join(directory, "agents"));
  mkdirSync(join(directory, "workspace-documents"));
  writeFileSync(
    join(profile, "cordis.patch.yml"),
    JSON.stringify([
      {
        id: "workspace-controller",
        config: { documentsDirectory: join(directory, "workspace-documents") },
      },
    ]),
  );
  const template = JSON.parse(
    readFileSync(join(root, "runtime/rc3/package.json"), "utf8"),
  );
  for (const [name, version] of Object.entries(template.dependencies)) {
    mkdirSync(join(modules, name), { recursive: true });
    writeFileSync(
      join(modules, name, "package.json"),
      JSON.stringify({ name, version }),
    );
  }
  for (const name of ["package.json", "package-lock.json"])
    copyFileSync(join(root, "runtime/rc3", name), join(profile, name));
  const manifest = JSON.parse(
    readFileSync(join(root, "compat/rc3/manifest.json"), "utf8"),
  ).filter(
    (entry, index, entries) =>
      entry.variant !== "desktop" &&
      entries.findIndex((other) => other.package === entry.package) === index,
  );
  const source = stock
    ? join(root, "runtime/rc3/node_modules")
    : join(root, "node_modules");
  for (const entry of manifest) {
    const packageRoot = join(modules, entry.package);
    mkdirSync(packageRoot, { recursive: true });
    copyFileSync(
      join(source, entry.package, "package.json"),
      join(packageRoot, "package.json"),
    );
    for (const file of entry.files) {
      const target = join(modules, entry.package, file.file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(source, entry.package, file.file), target);
      if (stock)
        assert.equal(
          digest(target),
          file.before,
          "stock test requires npm ci --prefix runtime/rc3",
        );
    }
  }
  if (!stock) {
    const patched = spawnSync(
      process.execPath,
      [
        join(root, "scripts/apply-native-compat.mjs"),
        "--modules",
        modules,
        "--backup",
        join(directory, "native-backup"),
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(patched.status, 0, patched.stderr);
  }
  const version = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  mkdirSync(join(modules, "dsh-plugin-project-mode"));
  writeFileSync(
    join(modules, "dsh-plugin-project-mode/package.json"),
    JSON.stringify({ name: "dsh-plugin-project-mode", version }),
  );
  mkdirSync(join(modules, "@deepseek-ai/dsh/lib"));
  writeFileSync(
    join(modules, "@deepseek-ai/dsh/lib/bin.js"),
    "console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),home:process.env.DSH_HOME,agents:process.env.DSH_AGENTS_HOME,keyPresent:!!process.env.DEEPSEEK_API_KEY}));process.exit(Number(process.env.PROJECT_MODE_TEST_EXIT||0));\n",
  );
  mkdirSync(join(directory, "artifacts"));
  const archive = "artifacts/plugin.tgz";
  writeFileSync(join(directory, archive), "fixture plugin archive");
  const ready = {
    ...marker(directory, "ready"),
    pluginVersion: version,
    pluginArchive: { file: archive, sha256: digest(join(directory, archive)) },
    runtimePackageSha256: digest(join(profile, "package.json")),
    runtimeLockSha256: digest(join(profile, "package-lock.json")),
  };
  writeFileSync(join(directory, markerName), JSON.stringify(ready));
  return { directory, profile, modules };
}

function snapshot(path) {
  return readdirSync(path, { recursive: true })
    .sort()
    .map((name) => {
      const file = join(path, name);
      const info = lstatSync(file);
      return [name, info.mtimeMs, info.isFile() ? digest(file) : "directory"];
    });
}

test("help describes all commands without creating an installation", () => {
  const result = cli("--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /setup\|start\|doctor/);
  assert.match(result.stdout, /--dir/);
  assert.match(result.stdout, /24\.9/);
});

test("setup refuses a populated foreign directory without modifying it", (t) => {
  const directory = temporary(t);
  writeFileSync(join(directory, "keep.txt"), "owned by someone else");
  const result = cli("setup", "--dir", directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /populated|nonempty/i);
  assert.deepEqual(readdirSync(directory), ["keep.txt"]);
  assert.equal(
    readFileSync(join(directory, "keep.txt"), "utf8"),
    "owned by someone else",
  );
});

test("setup rejects a symlink and a directory reached through a symlink", (t) => {
  const directory = temporary(t);
  const target = join(directory, "target");
  mkdirSync(target);
  symlinkSync(target, join(directory, "link"), "dir");
  for (const path of [
    join(directory, "link"),
    join(directory, "link", "child"),
  ]) {
    const result = cli("setup", "--dir", path);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink/i);
  }
  assert.deepEqual(readdirSync(target), []);
});

test("setup rejects personal DSH and application paths before writing", (t) => {
  const bin = temporary(t);
  const fakeNpm = join(bin, "npm");
  writeFileSync(fakeNpm, `#!${process.execPath}\nprocess.exit(97);\n`);
  chmodSync(fakeNpm, 0o755);
  for (const directory of [
    join(homedir(), ".dsh"),
    join(homedir(), ".dsh", "isolated"),
    join(homedir(), ".agents", "isolated"),
    "/Applications/ProjectMode.app/runtime",
  ]) {
    const result = spawnSync(
      process.execPath,
      [script, "setup", "--dir", directory],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /protected/i);
  }
});

test("malformed or relocated ownership markers cannot authorize writes", (t) => {
  const directory = temporary(t);
  const path = join(directory, markerName);
  for (const contents of [
    "{broken",
    JSON.stringify({
      ...marker(directory),
      directory: join(directory, "elsewhere"),
    }),
    JSON.stringify({ ...marker(directory), schemaVersion: 99 }),
  ]) {
    writeFileSync(path, contents);
    const result = cli("setup", "--dir", directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /marker|ownership/i);
    assert.equal(readFileSync(path, "utf8"), contents);
    assert.deepEqual(readdirSync(directory), [markerName]);
  }
});

test("start refuses incomplete setup and leaves its marker unchanged", (t) => {
  const directory = temporary(t);
  const contents = JSON.stringify(marker(directory));
  writeFileSync(join(directory, markerName), contents);
  const result = cli("start", "--dir", directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /incomplete|ready/i);
  assert.equal(readFileSync(join(directory, markerName), "utf8"), contents);
});

test("doctor is read-only for missing and incomplete installations", (t) => {
  const directory = temporary(t);
  const missing = join(directory, "missing");
  assert.notEqual(cli("doctor", "--dir", missing).status, 0);
  assert.deepEqual(readdirSync(directory), []);
  const contents = JSON.stringify(marker(directory, "failed"));
  writeFileSync(join(directory, markerName), contents);
  const result = cli("doctor", "--dir", directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /incomplete|ready/i);
  assert.deepEqual(readdirSync(directory), [markerName]);
  assert.equal(readFileSync(join(directory, markerName), "utf8"), contents);
});

test("start rejects profile overrides in forwarded arguments", (t) => {
  const directory = temporary(t);
  const result = cli("start", "--dir", directory, "--", "--profile", "desktop");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /profile.*override|--profile/i);
  assert.deepEqual(readdirSync(directory), []);
});

test("failed dependency setup stays unready and can retry without losing home data", (t) => {
  const directory = temporary(t);
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const log = join(directory, "npm-calls.jsonl");
  const fake = join(bin, "npm");
  writeFileSync(
    fake,
    `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nif(process.argv[2]==='--version'){console.log('11.0.0');process.exit(0)}\nappendFileSync(${JSON.stringify(log)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),home:process.env.DSH_HOME,agents:process.env.DSH_AGENTS_HOME})+'\\n');\nprocess.exit(37);\n`,
  );
  chmodSync(fake, 0o755);
  const setup = join(directory, "runtime");
  const invoke = () =>
    spawnSync(process.execPath, [script, "setup", "--dir", setup], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
  const result = invoke();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm.*37|dependencies.*failed/i);
  const failed = JSON.parse(readFileSync(join(setup, markerName), "utf8"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.pluginArchive, undefined);
  assert.equal(failed.runtimeLockSha256, undefined);
  const personal = join(setup, "home", "keep-settings.json");
  writeFileSync(personal, "preserve me");
  const patchPath = join(setup, "home/profiles/project-mode/cordis.patch.yml");
  assert.deepEqual(JSON.parse(readFileSync(patchPath, "utf8")), [
    {
      id: "workspace-controller",
      config: { documentsDirectory: join(setup, "workspace-documents") },
    },
  ]);
  const customPatch = "# user-managed config\n[]\n";
  writeFileSync(patchPath, customPatch);
  assert.notEqual(invoke().status, 0);
  assert.equal(readFileSync(personal, "utf8"), "preserve me");
  assert.equal(readFileSync(patchPath, "utf8"), customPatch);
  assert.ok(lstatSync(join(setup, "agents")).isDirectory());
  assert.ok(lstatSync(join(setup, "workspace-documents")).isDirectory());
  const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.args[0], "ci");
    assert.equal(call.cwd, join(setup, "home/profiles/project-mode"));
    assert.equal(call.home, join(setup, "home"));
    assert.equal(call.agents, join(setup, "agents"));
  }
  assert.notEqual(cli("start", "--dir", setup).status, 0);
  assert.equal(existsSync(join(setup, ".project-mode-setup.lock")), false);
});

test("doctor and repeated setup preserve every ready runtime file", (t) => {
  const { directory } = readyFixture(t);
  const before = snapshot(directory);
  for (const command of ["doctor", "setup"]) {
    const result = cli(command, "--dir", directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ready/i);
    assert.deepEqual(snapshot(directory), before);
  }
});

test("ready doctor and start work without npm or Git on PATH", (t) => {
  const { directory } = readyFixture(t);
  const emptyPath = temporary(t);
  const before = snapshot(directory);
  for (const command of ["doctor", "start"]) {
    const result = spawnSync(
      process.execPath,
      [script, command, "--dir", directory],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: emptyPath },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(snapshot(directory), before);
  }
});

test("Windows npm discovery uses Node and a real CLI file without executing npm.cmd", async (t) => {
  const { npmInvocation } = await import(pathToFileURL(script).href);
  assert.equal(typeof npmInvocation, "function");
  for (const location of ["node", "path", "appdata"]) {
    const directory = temporary(t);
    const node = join(directory, "Program Files", "nodejs", "node.exe");
    const pathEntry = join(directory, "custom npm path");
    const appData = join(directory, "Roaming");
    const npmBase =
      location === "node"
        ? dirname(node)
        : location === "path"
          ? pathEntry
          : join(appData, "npm");
    const npmCli = join(npmBase, "node_modules/npm/bin/npm-cli.js");
    mkdirSync(dirname(npmCli), { recursive: true });
    writeFileSync(
      npmCli,
      "console.log(JSON.stringify(process.argv.slice(2)));\n",
    );
    writeFileSync(
      join(npmBase, "npm.cmd"),
      "this wrapper must not be executed",
    );
    const args = [
      "install",
      join(directory, "plugin-$(literal)-`literal`.tgz"),
      "--no-save",
    ];
    const invocation = npmInvocation(args, {
      platform: "win32",
      execPath: node,
      env: { Path: pathEntry, APPDATA: appData },
    });
    assert.equal(invocation.command, node);
    assert.deepEqual(invocation.args, [npmCli, ...args]);
    const result = spawnSync(process.execPath, invocation.args, {
      encoding: "utf8",
      shell: false,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  }
  const directory = temporary(t);
  assert.throws(
    () =>
      npmInvocation([], {
        platform: "win32",
        execPath: join(directory, "node.exe"),
        env: {},
      }),
    /npm-cli\.js.*Node|npm-cli\.js.*npm/i,
  );
});

test("successful setup never embeds its runtime path in a shell command", (t) => {
  const source = readyFixture(t);
  const directory = temporary(t);
  const setup = join(directory, "runtime-$(literal)-`literal`");
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const fake = join(bin, "npm");
  const version = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  const filename = `dsh-plugin-project-mode-${version}.tgz`;
  writeFileSync(
    fake,
    `#!${process.execPath}\nimport{cpSync,writeFileSync}from'node:fs';import{join}from'node:path';const args=process.argv.slice(2);if(args[0]==='ci')cpSync(${JSON.stringify(source.modules)},join(process.cwd(),'node_modules'),{recursive:true});else if(args[0]==='pack'){writeFileSync(join(args[args.indexOf('--pack-destination')+1],${JSON.stringify(filename)}),'fixture archive');console.log(JSON.stringify([{name:'dsh-plugin-project-mode',version:${JSON.stringify(version)},filename:${JSON.stringify(filename)}}]));}else if(args[0]==='--version')console.log('11.0.0');\n`,
  );
  chmodSync(fake, 0o755);
  const result = spawnSync(
    process.execPath,
    [script, "setup", "--dir", setup],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(setup));
  assert.doesNotMatch(
    result.stdout,
    /node scripts\/project-mode\.mjs start --dir/,
  );
  assert.match(result.stdout, /start command.*--dir/);
});

test("start forwards Web arguments with isolated environment and preserves child exit", (t) => {
  const { directory, profile } = readyFixture(t);
  const result = spawnSync(
    process.execPath,
    [script, "start", "--dir", directory, "--", "--port", "12345"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: "launcher-fixture-secret",
        PROJECT_MODE_TEST_EXIT: "23",
      },
    },
  );
  assert.equal(result.status, 23, result.stderr);
  const launched = JSON.parse(result.stdout);
  assert.deepEqual(launched.args, [
    "--profile",
    "project-mode",
    "--host",
    "127.0.0.1",
    "--port",
    "12345",
  ]);
  assert.equal(launched.home, join(directory, "home"));
  assert.equal(launched.agents, join(directory, "agents"));
  assert.equal(launched.cwd, profile);
  assert.equal(launched.keyPresent, true);
  assert.doesNotMatch(result.stdout + result.stderr, /launcher-fixture-secret/);
});

test("doctor rejects changed archive and runtime lock without repairing them", (t) => {
  for (const target of [
    "artifacts/plugin.tgz",
    "home/profiles/project-mode/package-lock.json",
  ]) {
    const { directory } = readyFixture(t);
    writeFileSync(join(directory, target), "tampered");
    const before = snapshot(directory);
    const result = cli("doctor", "--dir", directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /integrity/i);
    assert.deepEqual(snapshot(directory), before);
  }
});

test("doctor rejects unsupported native versions and altered audited bytes", (t) => {
  for (const target of ["package.json", "lib/index.js"]) {
    const { directory, modules } = readyFixture(t);
    writeFileSync(
      join(modules, "@deepseek-ai/dsh-tools", target),
      target.endsWith("json")
        ? JSON.stringify({ version: "0.2.1-rc.4" })
        : "unknown native code",
    );
    const before = snapshot(directory);
    const result = cli("doctor", "--dir", directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported|Unrecognized|hash/i);
    assert.deepEqual(snapshot(directory), before);
  }
});

test(
  "successful unpatched helper preflight is not a compatible runtime",
  {
    skip:
      !existsSync(
        join(
          root,
          "runtime/rc3/node_modules/@deepseek-ai/dsh-tools/lib/index.js",
        ),
      ) && "run npm ci --prefix runtime/rc3 for stock-runtime fixture",
  },
  (t) => {
    const { directory } = readyFixture(t, { stock: true });
    const before = snapshot(directory);
    const result = cli("doctor", "--dir", directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unpatched|incomplete/i);
    assert.deepEqual(snapshot(directory), before);
  },
);

test("retry never overwrites a file through an existing artifact symlink", (t) => {
  const directory = temporary(t);
  const setup = join(directory, "runtime");
  mkdirSync(join(setup, "artifacts"), { recursive: true });
  writeFileSync(
    join(setup, markerName),
    JSON.stringify(marker(setup, "failed")),
  );
  const outside = join(directory, "keep.txt");
  writeFileSync(outside, "unrelated data");
  const version = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  const filename = `dsh-plugin-project-mode-${version}.tgz`;
  symlinkSync(outside, join(setup, "artifacts", filename));
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const fake = join(bin, "npm");
  writeFileSync(
    fake,
    `#!${process.execPath}\nimport{writeFileSync}from'node:fs';import{join}from'node:path';const args=process.argv.slice(2);if(args[0]==='pack'){writeFileSync(join(args[args.indexOf('--pack-destination')+1],${JSON.stringify(filename)}),'packed');console.log(JSON.stringify([{name:'dsh-plugin-project-mode',version:${JSON.stringify(version)},filename:${JSON.stringify(filename)}}]));}else if(args[0]==='install')process.exit(37);else console.log('11.0.0');\n`,
  );
  chmodSync(fake, 0o755);
  const result = spawnSync(
    process.execPath,
    [script, "setup", "--dir", setup],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    },
  );
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(outside, "utf8"), "unrelated data");
});

test("setup retry validates one original backup per package despite upgrade preimages", (t) => {
  for (const variant of ["npm", "moa-0.2.0"]) {
    const { directory } = readyFixture(t);
    writeFileSync(
      join(directory, markerName),
      JSON.stringify(marker(directory, "failed")),
    );
    const entry = JSON.parse(
      readFileSync(join(root, "compat/rc3/manifest.json"), "utf8"),
    ).find(
      (entry) =>
        entry.package === "@deepseek-ai/dsh-client-ui-conversation" &&
        entry.variant === variant,
    );
    const stock = join(directory, "stock");
    mkdirSync(join(stock, "lib"), { recursive: true });
    copyFileSync(
      join(root, "node_modules", entry.package, "lib/client.js"),
      join(stock, "lib/client.js"),
    );
    const reverse = spawnSync(
      "git",
      [
        "apply",
        "--reverse",
        "--unsafe-paths",
        `--directory=${stock}`,
        join(root, "compat/rc3", entry.runtimePatch),
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(reverse.status, 0, reverse.stderr);
    const backup = join(
      directory,
      "native-backup",
      entry.package,
      "lib/client.js",
    );
    mkdirSync(dirname(backup), { recursive: true });
    copyFileSync(join(stock, "lib/client.js"), backup);
    const bin = join(directory, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "npm"),
      `#!${process.execPath}\nif(process.argv[2]==='--version')console.log('11.0.0');else process.exit(37);\n`,
    );
    chmodSync(join(bin, "npm"), 0o755);
    const result = spawnSync(
      process.execPath,
      [script, "setup", "--dir", directory],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /npm.*37/);
    assert.equal(
      digest(backup),
      entry.files.find((file) => file.file === "lib/client.js").before,
    );
    writeFileSync(backup, "not an audited native preimage");
    const rejected = spawnSync(
      process.execPath,
      [script, "setup", "--dir", directory],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );
    assert.match(rejected.stderr, /backup integrity changed/);
  }
});

test(
  "Ctrl+C reaches the native child and the launcher exits with it",
  { timeout: 10_000 },
  async (t) => {
    const { directory, modules } = readyFixture(t);
    writeFileSync(
      join(modules, "@deepseek-ai/dsh/lib/bin.js"),
      "process.on('SIGINT',()=>{console.log('native stopped');process.exit(130)});console.log('native-ready:'+process.pid);setInterval(()=>{},1000);\n",
    );
    const child = spawn(
      process.execPath,
      [script, "start", "--dir", directory],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let nativePid;
    t.after(() => {
      child.kill("SIGKILL");
      if (nativePid) {
        try {
          process.kill(nativePid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    });
    const exit = await new Promise((accept, reject) => {
      child.on("error", reject);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        const ready = stdout.match(/native-ready:(\d+)/);
        if (ready && !nativePid) {
          nativePid = Number(ready[1]);
          child.kill("SIGINT");
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("exit", (code) => accept(code));
    });
    assert.equal(exit, 130, stderr);
    assert.match(stdout, /native stopped/);
    assert.throws(() => process.kill(nativePid, 0), { code: "ESRCH" });
  },
);
