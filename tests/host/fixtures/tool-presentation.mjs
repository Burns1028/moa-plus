export const name = "tool-presentation";
export const inject = ["tools"];
export function apply(ctx, config) {
  ctx.tools.presentAs(config.mode);
}
