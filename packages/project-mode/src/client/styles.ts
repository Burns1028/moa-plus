import wordmark from "../../assets/moa-wordmark.png";

/** Only Project-owned controls; native sidebar rows keep all native styling. */
export const styles = `
.pm-toggle,.pm-capsules,.pm-readonly{color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.pm-capsule,.pm-readonly button,.pm-parent{font:inherit;color:inherit;border:0;background:transparent;border-radius:6px;padding:5px 7px;cursor:pointer}
.pm-capsule:hover,.pm-readonly button:hover,.pm-parent:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pm-capsule:focus-visible,.pm-mode-button:focus-visible,.pm-parent:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.pm-toggle [role=alert],.pm-toggle [role=status]{font-size:11px;margin-left:6px}
.pm-mode-button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);padding:6px 4px;cursor:pointer}
.pm-mode-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.pm-mode-button[aria-pressed=true],.pm-fixed{color:#526b00}
body[data-ds-dark-theme] .pm-mode-button[aria-pressed=true],body[data-ds-dark-theme] .pm-fixed{color:#cbff45}
.pm-mode-button:disabled{cursor:default;opacity:.65}
.pm-wordmark{display:inline-block;position:relative;width:44px;height:12px;flex:none;vertical-align:middle}
.pm-wordmark::before,.pm-wordmark::after{content:"";position:absolute;inset:0}
/* Keep the selected letter contours; application theme controls their contrast. */
.pm-wordmark::before{background:currentColor;mask:url("${wordmark}") center/contain no-repeat;clip-path:inset(0 22% 0 0)}
.pm-wordmark::after{background:url("${wordmark}") center/contain no-repeat;clip-path:inset(0 0 0 78%)}
.pm-mode-button[aria-pressed=false] .pm-wordmark::after{filter:grayscale(1) brightness(.5);opacity:.6}
.pm-parent{padding:0}
[data-slot="conversation.composer.bar"]:has(.pm-parent) [data-slot="conversation.input.permission"]{display:none!important}
.pm-fixed{display:inline-flex;align-items:center;padding:6px 4px}
.pm-capsules{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:8px 0}.pm-capsules>li{display:flex;min-width:0;max-width:100%}.pm-capsule{box-sizing:border-box;display:inline-flex;min-width:0;max-width:min(100%,240px);height:28px;gap:6px;align-items:center;text-align:left;border:1px solid var(--dsw-alias-border-l4);border-radius:999px;padding:4px 8px;font-size:12px;line-height:18px}.pm-capsule strong{min-width:0;max-width:104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.pm-progress{min-width:0;max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.pm-worker-icon{display:block;flex:0 0 auto;width:24px;height:24px}
.pm-capsule .pm-worker-icon{width:16px;height:16px}
.pm-agent-message{box-sizing:border-box;width:fit-content;max-width:min(calc(var(--dsh-chat-content-width,748px) * .702),82%);margin:12px 0 12px auto;padding:10px 16px;background:var(--dsw-specific-bubble);border-radius:var(--dsw-radius-xl);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;overflow-wrap:anywhere;min-width:0}
.pm-agent-message>header{color:var(--dsw-alias-label-secondary);font-size:12px;margin-bottom:6px}
.pm-agent-message .pm-axis-preview{margin-top:4px}.pm-agent-message .pm-axis-preview>summary{display:block;list-style:none;cursor:pointer}.pm-agent-message .pm-axis-preview>summary::-webkit-details-marker{display:none}.pm-agent-message .pm-axis-preview>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:3px}
.pm-agent-message .pm-axis-preview:not([open])>summary{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;color:var(--dsw-alias-label-secondary,#999)}
.pm-agent-empty{color:var(--dsw-alias-label-tertiary)}
`;
