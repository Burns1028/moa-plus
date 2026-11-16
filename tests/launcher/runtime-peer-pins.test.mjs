import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("isolated runtime directly pins every required plugin peer to its locked version", () => {
  const plugin = read("../../package.json");
  const runtime = read("../../runtime/rc3/package.json");
  const lock = read("../../runtime/rc3/package-lock.json");
  for (const name of Object.keys(plugin.peerDependencies)) {
    if (plugin.peerDependenciesMeta?.[name]?.optional) continue;
    const version = runtime.dependencies[name];
    assert.ok(
      version,
      `${name} must be a direct runtime dependency so plugin installation cannot select a newer peer`,
    );
    assert.match(
      version,
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `${name} must use an exact version`,
    );
    assert.equal(
      lock.packages[""].dependencies[name],
      version,
      `${name} root lock must match`,
    );
    assert.equal(
      lock.packages[`node_modules/${name}`].version,
      version,
      `${name} resolved lock must match`,
    );
  }
});
