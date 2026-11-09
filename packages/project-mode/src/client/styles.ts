/** Only Project-owned controls; native sidebar rows keep all native styling. */
export const styles = `
.pm-toggle,.pm-capsules,.pm-readonly{color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.pm-capsule,.pm-readonly button,.pm-parent{font:inherit;color:inherit;border:0;background:transparent;border-radius:6px;padding:5px 7px;cursor:pointer}
.pm-capsule:hover,.pm-readonly button:hover,.pm-parent:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pm-capsule:focus-visible,.pm-toggle input:focus-visible,.pm-parent:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.pm-toggle label{display:inline-flex;gap:4px;align-items:center;cursor:pointer}.pm-toggle [role=alert],.pm-toggle [role=status]{font-size:11px;margin-left:6px}
.pm-parent{padding:0}
[data-slot="conversation.composer.bar"]:has(.pm-parent) [data-slot="conversation.input.permission"]{display:none!important}
.pm-fixed{display:inline-flex;align-items:center;gap:4px}
.pm-capsules{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:8px 0}.pm-capsules>li{display:flex;min-width:0;max-width:100%}.pm-capsule{box-sizing:border-box;display:inline-flex;min-width:0;max-width:min(100%,240px);height:28px;gap:6px;align-items:center;text-align:left;border:1px solid var(--dsw-alias-border-l4);border-radius:999px;padding:4px 8px;font-size:12px;line-height:18px}.pm-capsule strong{min-width:0;max-width:104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.pm-progress{min-width:0;max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.pm-worker-icon{display:block;flex:0 0 auto;width:24px;height:24px}
.pm-capsule .pm-worker-icon{width:16px;height:16px}
.pm-agent-message{margin:12px 0;color:var(--dsw-alias-label-primary);font:inherit;min-width:0}
.pm-agent-message>header{color:var(--dsw-alias-label-secondary);font-size:12px;margin-bottom:6px}
.pm-agent-message .pm-axis-preview{margin-top:4px}.pm-agent-message .pm-axis-preview>summary{display:block;list-style:none;cursor:pointer}.pm-agent-message .pm-axis-preview>summary::-webkit-details-marker{display:none}.pm-agent-message .pm-axis-preview>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:3px}
.pm-agent-message .pm-axis-preview:not([open])>summary{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;color:var(--dsw-alias-label-secondary,#999)}
.pm-agent-empty{color:var(--dsw-alias-label-tertiary)}
`;
