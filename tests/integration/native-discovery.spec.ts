import { it, expect } from "vitest";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import Registry from "@deepseek-ai/dsh-typert-registry";
import * as TypertLoader from "@deepseek-ai/dsh-typert-loader";
import Gateway from "@deepseek-ai/dsh-api-gateway";
import Access from "@deepseek-ai/dsh-api-remote-access";
import { Peer } from "@deepseek-ai/dsh-client-connection";
import { fixture } from "../host/fixture.ts";

it("auto-discovers the compiled bare package through public native Loader and withdraws its descriptors on removal", async () => {
  const f = await fixture();
  try {
    await f.plugin.dispose();
    f.ctx.baseUrl = pathToFileURL(resolve("cordis.yml")).href;
    await f.ctx.plugin(Registry);
    await f.ctx.plugin(Loader);
    const id = await f.ctx.loader.create({ name: "dsh-plugin-project-mode" });
    await f.ctx.loader.await();
    expect(f.ctx.loader.resolve(id).fiber).toBeDefined();
    await f.ctx.plugin(TypertLoader);
    await f.ctx.plugin(Access);
    await f.ctx.plugin(Gateway);
    expect(
      f.ctx.typert
        .listPackages()
        .filter((p) => p.package === "dsh-plugin-project-mode"),
    ).toHaveLength(1);
    expect(
      f.ctx.typert.local.list().filter((p) => p.namespace === "projectMode"),
    ).toHaveLength(9);
    const peer = new Peer(f.ctx, { principal: { kind: "owner" } });
    expect(
      await f.ctx.typertGateway.invoke({
        namespace: "projectMode",
        method: "catalog",
        args: {},
        peer,
      }),
    ).toEqual([]);
    f.ctx.loader.remove(id);
    await f.ctx.loader.await();
    await expect
      .poll(() => f.ctx.typert.getPackage("dsh-plugin-project-mode"))
      .toBeUndefined();
    expect(
      f.ctx.typert.local.list().filter((p) => p.namespace === "projectMode"),
    ).toHaveLength(0);
  } finally {
    await f.dispose();
  }
});
