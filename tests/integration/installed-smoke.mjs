// Copied into a disposable consumer by verify-package.mjs. All package imports
// below resolve from that consumer, never from this repository's node_modules.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { Context } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import Registry from "@deepseek-ai/dsh-typert-registry";
import * as TypertLoader from "@deepseek-ai/dsh-typert-loader";
import Gateway from "@deepseek-ai/dsh-api-gateway";
import Access from "@deepseek-ai/dsh-api-remote-access";
import { Peer } from "@deepseek-ai/dsh-client-connection";
import * as ClientRegistry from "@deepseek-ai/dsh-typert-registry/client";
import * as ClientGateway from "@deepseek-ai/dsh-api-gateway/client";
import { fixture } from "./native-fixture.mjs";
const id = "dsh-plugin-project-mode";
const req = createRequire(import.meta.url);
const manifestPath = req.resolve(id + "/package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.name, id);
async function verifyExports(value) {
  if (typeof value === "string") {
    assert.ok(value.startsWith("./"));
    await readFile(join(dirname(manifestPath), value.replace("*", "en")));
  } else for (const child of Object.values(value)) await verifyExports(child);
}
await verifyExports(manifest.exports);
const patch = await readFile(
  join(dirname(manifestPath), manifest.dsh.bundle.patch),
  "utf8",
);
assert.equal(
  [...patch.matchAll(/name: dsh-plugin-project-mode\s*$/gm)].length,
  1,
);
const icon = await readFile(req.resolve(id + "/icon"), "utf8");
assert.match(icon, /<svg/);
assert.doesNotMatch(icon, /<script|(?:href|src)=["\x27](?:https?:|data:)/);
for (const file of [
  "LICENSE",
  "README.md",
  "README.zh.md",
  "THIRD_PARTY_NOTICES.md",
  "CHANGELOG.md",
  "docs/verification.md",
  "docs/manual-verification.md",
]) {
  assert.ok((await readFile(join(dirname(manifestPath), file))).length > 100);
}

const host = await import(id);
assert.equal(typeof host.default, "function");
assert.equal((await import(id + "/typert")).TYPERT.package, id);
const info = (await import(id + "/remote")).default;
assert.equal(info.package, id);
await import(id + "/shared");
for (const subpath of [
  "/icon",
  "/locale/en.json",
  "/locale/zh.json",
  "/client",
])
  req.resolve(id + subpath);
// ClientModules follows the Host module URL to the nearest matching manifest.
let nearest = dirname(req.resolve(id));
for (;;) {
  try {
    const child = JSON.parse(
      await readFile(join(nearest, "package.json"), "utf8"),
    );
    if (child.name === id) {
      assert.deepEqual(child.dsh.client, manifest.dsh.client);
      assert.ok(child.exports["./client"]);
      break;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const parent = dirname(nearest);
  assert.notEqual(parent, nearest);
  nearest = parent;
}
const clientSource = await readFile(req.resolve(id + "/client"), "utf8");
assert.deepEqual(
  [
    ...new Set(
      [...clientSource.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]),
    ),
  ].sort(),
  [
    "@deepseek-ai/dsh-client-ui-primitives",
    "react",
    "react/jsx-runtime",
    "zod",
  ],
);
assert.doesNotMatch(clientSource, /(?:from|require\()\s*["'][^"']*\/src\//);
let registration;
runInNewContext(clientSource, {
  window: {
    __ModuleLoader__: {
      load: (value) => {
        registration = value;
      },
    },
  },
});
assert.equal(registration.id, id);
// The consumer is Node, not the desktop's browser platform. Its native UI
// seed must stay lazy here; real UI exports are exercised by Client/browser
// tests and Desktop acceptance, rather than importing CSS through Node.
const browserRequire = (name) =>
  name === "@deepseek-ai/dsh-client-ui-primitives"
    ? new Proxy(
        {},
        {
          get() {
            throw new Error(
              "Browser UI accessed during lazy factory construction",
            );
          },
        },
      )
    : req(name);
assert.equal(typeof registration.factory(browserRequire).apply, "function");
const f = await fixture();
const client = new Context();
try {
  await f.plugin.dispose();
  f.ctx.baseUrl = pathToFileURL(join(process.cwd(), "cordis.yml")).href;
  await f.ctx.plugin(Registry);
  await f.ctx.plugin(Loader);
  const entry = await f.ctx.loader.create({ name: id });
  await f.ctx.loader.await();
  assert.ok(f.ctx.loader.resolve(entry).fiber);
  await f.ctx.plugin(TypertLoader); // No explicit package list or manual register.
  await f.ctx.plugin(Access);
  await f.ctx.plugin(Gateway);
  assert.equal(
    [...f.ctx.loader.entries()].filter((e) => e.options.name === id).length,
    1,
  );
  assert.equal(
    f.ctx.typert.listPackages().filter((p) => p.package === id).length,
    1,
  );
  assert.equal(
    f.ctx.typert.local.list().filter((p) => p.namespace === "projectMode")
      .length,
    9,
  );
  const peer = new Peer(f.ctx, { principal: { kind: "owner" } });
  const calls = [];
  await client.plugin(ClientRegistry);
  // Public passive Connection carrier: the real generated Client codecs call the
  // real Host Gateway in process. This is not a browser transport/UI test.
  await client.provide("connection", {
    interactions: "none",
    isLoopback: true,
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
    rpc: {
      open: async function* () {
        throw new Error("Streaming is outside this install smoke");
      },
      call: async (channel, endpoint, payload) => {
        const wire = JSON.parse(JSON.stringify(payload));
        calls.push([channel, endpoint, wire]);
        const [namespace, method] = endpoint.split("/");
        return {
          ok: true,
          value: await f.ctx.typertGateway.invoke({
            namespace,
            method,
            args: wire.args,
            peer,
          }),
        };
      },
    },
  });
  await client.plugin(ClientGateway);
  const withdraw = await client.remote.$mount(info);
  assert.deepEqual(await client.remote.projectMode.catalog(), {
    ok: true,
    value: [],
  });
  assert.deepEqual(calls, [["/api", "projectMode/catalog", { args: {} }]]);
  await withdraw();
  assert.equal(client.get("remote.projectMode"), undefined);
  f.ctx.loader.remove(entry);
  await f.ctx.loader.await();
  const until = Date.now() + 3000;
  while (f.ctx.typert.getPackage(id) && Date.now() < until)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(f.ctx.typert.getPackage(id), undefined);
  assert.equal(
    f.ctx.typert.local.list().filter((p) => p.namespace === "projectMode")
      .length,
    0,
  );
  console.log(
    JSON.stringify({
      installed: id,
      version: manifest.version,
      nearestManifest: nearest.slice(process.cwd().length + 1),
      host: true,
      factory: true,
      autoDiscoveredEndpoints: 9,
      clientGatewayRoundtrip: true,
      disposal: true,
    }),
  );
} finally {
  await client.fiber.dispose();
  await f.dispose();
}
