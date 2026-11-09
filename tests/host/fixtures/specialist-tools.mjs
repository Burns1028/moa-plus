export const name = "specialist-tools";
export const inject = ["tools"];
export function apply(ctx) {
  for (const name of ["read", "grep", "glob", "write", "bash", "web_search", "web_fetch"])
    ctx.tools.register({
      name,
      description: "Preset execution capability",
      parameters: { type: "object", properties: {} },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      execute: async () => name,
    });
}
