import { readFileSync, writeFileSync, mkdirSync, copyFileSync, realpathSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const modules = resolve(option("--modules") ?? join(here, "../node_modules"));
const backup = option("--backup");
const dryRun = args.includes("--dry-run");
const runtimeOnly = args.includes("--runtime-only");
const profilesRoot = resolve(here, "../compat");
const profiles = readdirSync(profilesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(profilesRoot, entry.name))
  .filter((directory) => existsSync(join(directory, "manifest.json")))
  .map((directory) => ({
    directory,
    manifest: JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")),
  }));
const agentVersion = JSON.parse(readFileSync(join(modules, "@deepseek-ai/dsh-agent/package.json"), "utf8")).version;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const hash = (path) =>
  digest(readFileSync(path));
const packageFingerprint = (installed) => digest(JSON.stringify(Object.fromEntries(
  ["type", "main", "exports", "imports", "dsh"]
    .filter((field) => Object.hasOwn(installed, field))
    .map((field) => [field, installed[field]]),
)));

function fingerprintMatches(entry, root, installed) {
  const fingerprint = entry.runtimeFingerprint;
  if (!fingerprint || !Array.isArray(fingerprint.files) || fingerprint.package !== packageFingerprint(installed)) return false;
  // An empty declaration-only patch is not evidence about its runtime ABI.
  if (!entry.files.some((file) => file.file.endsWith(".js")) && !fingerprint.files.some((file) => file.file.endsWith(".js"))) return false;
  return fingerprint.files.every((file) => hash(join(root, file.file)) === file.sha256);
}

// Build the complete plan without writing. A cross-version candidate must
// prove every package against one profile; packages from different profiles
// cannot be assembled into a synthetic compatible runtime.
function preflight({ directory: compat, manifest }, crossVersion = false) {
 const plans = [];
 const compatible = [];
 for (const name of [...new Set(manifest.map((entry) => entry.package))]) {
  const root = realpathSync(join(modules, name));
  const installed = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const variants = manifest.filter((entry) => entry.package === name && (crossVersion || entry.version === installed.version));
  if (!variants.length)
    throw new Error(
      `Unsupported ${name} version ${installed.version}; no files changed`,
    );
  const selected = variants
    .map((entry) => ({
      ...entry,
      files: entry.files.filter(
        (file) => !runtimeOnly || file.file.endsWith(".js"),
      ),
    }))
    .find((entry) =>
      (!crossVersion || fingerprintMatches(entry, root, installed)) && entry.files.every((file) =>
        [file.before, file.after].includes(hash(join(root, file.file))),
      ),
    );
  if (!selected)
    throw new Error(`Unrecognized ${name} bytes; no files changed`);
  if (
    selected.files.every((file) => hash(join(root, file.file)) === file.after)
  ) {
    compatible.push(`${name}: compatible (${selected.variant})`);
    continue;
  }
  if (
    !selected.files.every((file) => hash(join(root, file.file)) === file.before)
  )
    throw new Error(
      `Mixed ${name} patch state; restore its backup before retrying`,
    );
  const patchFile = join(
    compat,
    runtimeOnly ? selected.runtimePatch : selected.patch,
  );
  // Git checkouts on Windows may convert patch files to CRLF. The audited
  // package bytes and unified diffs use LF; feed the normalized diff on stdin.
  const patch = readFileSync(patchFile, "utf8").replaceAll("\r\n", "\n");
  execFileSync(
    "git",
    ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "apply", "--check", "--unsafe-paths", `--directory=${root}`, "-"],
    { cwd: parse(root).root, input: patch, stdio: "pipe" },
  );
  plans.push({ ...selected, root, patch });
 }
 return { plans, compatible };
}

const exact = profiles.find(({ manifest }) => manifest.some((entry) =>
  entry.package === "@deepseek-ai/dsh-agent" && entry.version === agentVersion,
));
let selected;
let exactFailure;
if (exact) {
  try { selected = preflight(exact); }
  catch (error) { exactFailure = error; }
}
if (!selected) for (const profile of profiles) {
  try { selected = preflight(profile, true); break; }
  catch { /* Try another complete audited profile; no candidate has written. */ }
}
if (!selected) {
  if (exactFailure) throw exactFailure;
  const supported = [...new Set(profiles.flatMap(({ manifest }) =>
    manifest.filter((entry) => entry.package === "@deepseek-ai/dsh-agent").map((entry) => entry.version),
  ))];
  throw new Error(`Unsupported DSH runtime ${agentVersion}; no complete audited runtime fingerprint matched; available compatibility profiles: ${supported.join(", ")}; no files changed`);
}
const { plans, compatible } = selected;
for (const message of compatible) console.log(message);
if (dryRun) {
  console.log(
    `Preflight passed for ${plans.length} native package patches; no files changed.`,
  );
  process.exit(0);
}
if (plans.length && !backup)
  throw new Error(
    "Pass an explicit --backup directory before applying native changes",
  );
const saved = [];
try {
  for (const plan of plans)
    for (const file of plan.files) {
      const target = join(plan.root, file.file);
      if (hash(target) !== file.before)
        throw new Error(`Native file changed after preflight: ${target}`);
      const destination = resolve(backup, plan.package, file.file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(target, destination);
      saved.push({
        target,
        destination,
        before: file.before,
        after: file.after,
      });
    }
  for (const plan of plans) {
    execFileSync(
      "git",
      ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "apply", "--unsafe-paths", `--directory=${plan.root}`, "-"],
      { cwd: parse(plan.root).root, input: plan.patch, stdio: "pipe" },
    );
    for (const file of plan.files)
      if (hash(join(plan.root, file.file)) !== file.after)
        throw new Error(`Post-patch hash mismatch: ${file.file}`);
    console.log(
      `${plan.package}: patched ${plan.files.length} files (${plan.variant})`,
    );
  }
  if (saved.length)
    writeFileSync(
      resolve(backup, "native-compat.json"),
      JSON.stringify(saved, null, 2) + "\n",
    );
} catch (error) {
  for (const file of saved) copyFileSync(file.destination, file.target);
  throw error;
}
