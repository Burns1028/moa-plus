export const panelStyles = `
.pm-workers-panel{display:grid;grid-template-columns:minmax(128px,29%) minmax(0,1fr);height:100%;min-height:0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.pm-workers-panel *{box-sizing:border-box}
.pm-workers-panel-empty{display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}.pm-workers-panel-empty p{margin:0;max-width:28ch}
.pm-axis-preview{margin-top:4px}.pm-axis-preview>summary{display:block;list-style:none;cursor:pointer}.pm-axis-preview>summary::-webkit-details-marker{display:none}.pm-axis-preview>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:3px}
.pm-axis-preview:not([open])>summary{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;color:var(--dsw-alias-label-secondary,#999)}
.pm-workers-list{padding:12px 7px;border-right:1px solid var(--dsw-alias-border-primary,#8883);overflow:auto;min-width:0}
.pm-workers-list button{display:flex;align-items:center;gap:8px;width:100%;padding:9px 8px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
.pm-workers-list button:hover,.pm-workers-list button[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,#8882)}
.pm-panel-worker-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}.pm-panel-worker-icon .pm-panel-running{position:absolute;left:-3px;top:-3px;pointer-events:none}
.pm-panel-worker-icon>.pm-worker-icon{width:16px;height:16px}.pm-axis-files time{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.pm-worker-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pm-worker-copy{min-width:0;flex:1}.pm-worker-phase{font-size:11px;color:var(--dsw-alias-label-secondary,#999);display:block;margin-top:2px}
.pm-worker-axis{overflow:auto;padding:18px 20px;min-width:0}.pm-worker-axis header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.pm-worker-axis h3{font-size:14px;margin:0;font-weight:600;overflow-wrap:anywhere}
.pm-worker-axis button,.pm-worker-axis a{font:inherit;color:var(--dsw-alias-label-link,#80a9ee);cursor:pointer}.pm-worker-axis button{border:0;background:transparent;padding:3px 0;text-align:left}
.pm-axis-turn{position:relative;border-left:1px solid var(--dsw-alias-border-primary,#8884);padding:0 0 24px 18px;margin-left:4px}.pm-axis-turn:before{content:"";position:absolute;left:-4px;top:5px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-secondary,#999)}
.pm-axis-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:14px}.pm-axis-head strong{font-weight:600}.pm-axis-head time,.pm-axis-message time{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}.pm-axis-outcome{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.pm-axis-section{margin-top:14px}.pm-axis-section h4{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary,#999);margin:0 0 6px}.pm-axis-message{overflow-wrap:anywhere;margin:5px 0 12px;line-height:1.65}.pm-axis-message p:first-child{margin-top:4px}.pm-axis-files{list-style:none;padding:0;margin:0}.pm-axis-files li{margin:5px 0}.pm-axis-files small{display:block;color:var(--dsw-alias-label-secondary,#999);margin-top:3px;overflow-wrap:anywhere}
.pm-axis-empty{color:var(--dsw-alias-label-secondary,#999);padding:4px 0;line-height:1.6}.pm-axis-more{margin-left:22px}.pm-axis-error{color:var(--dsw-alias-label-secondary,#999);overflow-wrap:anywhere}
`;
