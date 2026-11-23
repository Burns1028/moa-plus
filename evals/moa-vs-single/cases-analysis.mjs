import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Only `files` and `prompt` are copied into the model's workspace. Reference
// calculations and graders stay outside it, and do not make model requests.
const json = value => JSON.stringify(value, null, 2) + '\n';
const csv = (header, rows) => [header.join(','), ...rows.map(row => row.join(','))].join('\n') + '\n';
const ordered = values => [...values].sort();
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const normalized = value => {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])]));
  return value;
};
const equal = (actual, expected) => same(normalized(actual), normalized(expected));
const requiredFields = (actual, expected) => actual && typeof actual === 'object'
  ? Object.fromEntries(Object.keys(expected).map(key => [key, actual[key]])) : actual;
const fieldsEqual = (actual, expected) => equal(requiredFields(actual, expected), expected);
const sameTime = (actual, expected) => typeof actual === 'string' && Date.parse(actual) === Date.parse(expected);
const rowsBy = (rows, key) => Array.isArray(rows) ? [...rows].sort((a, b) => String(a?.[key]).localeCompare(String(b?.[key]))) : rows;
const rowsEqual = (actual, expected, key) => Array.isArray(actual) && actual.length === expected.length
  && rowsBy(actual, key).every((row, index) => fieldsEqual(row, rowsBy(expected, key)[index]));
const result = entries => ({
  score: entries.reduce((total, entry) => total + (entry.passed ? entry.weight : 0), 0),
  checks: entries.map(({ weight, ...check }) => check),
});
const check = (name, passed, weight, detail) => ({ name, passed: Boolean(passed), weight, ...(detail ? { detail } : {}) });
async function readResult(project) {
  try { return { value: JSON.parse((await readFile(join(project, 'outputs/result.json'), 'utf8')).replace(/^\uFEFF/, '')) }; }
  catch (error) { return { value: null, error: String(error.message).slice(0, 200) }; }
}

// A realistic close-of-month job: split ledgers, retries, unsettled entries,
// old/future orders, refunds and partial payments. Integers are always cents.
function makeReconciliation() {
  const regions = ['east', 'north', 'west'];
  const orders = [], ledgers = [[], [], []];
  for (let i = 1; i <= 72; i++) {
    const order = {
      orderId: `O${String(i).padStart(3, '0')}`,
      region: regions[i % 3],
      placedAt: i % 19 === 0 ? '2026-09-30T23:30:00Z' : i % 23 === 0 ? '2026-11-01T00:00:00Z' : `2026-10-${String(1 + i % 27).padStart(2, '0')}T10:00:00Z`,
      status: i % 13 === 0 ? 'cancelled' : i % 17 === 0 ? 'draft' : 'fulfilled',
      grossCents: 1900 + (i * 379) % 13000,
    };
    orders.push(order);
    const capture = {
      transactionId: `T${String(i).padStart(3, '0')}C`, orderId: order.orderId, type: 'capture',
      amountCents: i % 5 === 0 ? Math.floor(order.grossCents / 2) : order.grossCents,
      postedAt: i % 11 === 0 ? '2026-11-01T00:00:00Z' : `2026-10-${String(1 + i % 27).padStart(2, '0')}T11:00:00Z`,
      status: i % 7 === 0 ? 'pending' : 'success',
    };
    ledgers[i % 3].push(capture);
    if (i % 6 === 0) ledgers[(i + 1) % 3].push({ ...capture });
    if (i % 9 === 0) ledgers[(i + 2) % 3].push({
      transactionId: `T${String(i).padStart(3, '0')}R`, orderId: order.orderId, type: 'refund',
      amountCents: 300 + (i * 13) % 600, postedAt: '2026-10-30T12:00:00Z', status: 'success',
    });
  }
  ledgers[0].push({ transactionId: 'TUNKNOWN1', orderId: 'O404', type: 'capture', amountCents: 9999, postedAt: '2026-10-20T12:00:00Z', status: 'success' });
  ledgers[2].push({ transactionId: 'TUNKNOWN2', orderId: 'O405', type: 'refund', amountCents: 1200, postedAt: '2026-10-22T12:00:00Z', status: 'success' });
  const inMonth = date => date >= '2026-10-01T00:00:00Z' && date < '2026-11-01T00:00:00Z';
  const eligible = orders.filter(order => order.status === 'fulfilled' && inMonth(order.placedAt));
  const byId = new Map(eligible.map(order => [order.orderId, order]));
  const seen = new Set(), duplicates = new Set(), unknown = new Set(), effective = [];
  const allOrderIds = new Set(orders.map(order => order.orderId));
  for (const row of ledgers.flat()) {
    if (seen.has(row.transactionId)) { duplicates.add(row.transactionId); continue; }
    seen.add(row.transactionId);
    if (!allOrderIds.has(row.orderId)) unknown.add(row.orderId);
    if (row.status === 'success' && inMonth(row.postedAt) && byId.has(row.orderId)) effective.push(row);
  }
  const summary = rows => {
    const ids = new Set(rows.map(order => order.orderId));
    const txs = effective.filter(tx => ids.has(tx.orderId));
    const capturedCents = txs.filter(tx => tx.type === 'capture').reduce((sum, tx) => sum + tx.amountCents, 0);
    const refundCents = txs.filter(tx => tx.type === 'refund').reduce((sum, tx) => sum + tx.amountCents, 0);
    return {
      orderCount: rows.length,
      grossCents: rows.reduce((sum, order) => sum + order.grossCents, 0),
      capturedCents, refundCents, netCashCents: capturedCents - refundCents,
      outstandingCents: rows.reduce((sum, order) => sum + Math.max(0, order.grossCents - txs.filter(tx => tx.orderId === order.orderId && tx.type === 'capture').reduce((a, tx) => a + tx.amountCents, 0)), 0),
    };
  };
  const expected = {
    version: 1, cutoffExclusive: '2026-11-01T00:00:00Z', overall: summary(eligible),
    byRegion: regions.map(region => ({ region, ...summary(eligible.filter(order => order.region === region)) })),
    outstanding: eligible.flatMap(order => {
      const cents = Math.max(0, order.grossCents - effective.filter(tx => tx.orderId === order.orderId && tx.type === 'capture').reduce((a, tx) => a + tx.amountCents, 0));
      return cents ? [{ orderId: order.orderId, cents }] : [];
    }),
    duplicateTransactionIds: ordered(duplicates), unknownOrderIds: ordered(unknown),
  };
  const fields = ['transactionId', 'orderId', 'type', 'amountCents', 'postedAt', 'status'];
  const files = {
    'inputs/orders.csv': csv(['orderId', 'region', 'placedAt', 'status', 'grossCents'], orders.map(order => [order.orderId, order.region, order.placedAt, order.status, order.grossCents])),
    'inputs/rules.md': `# October close rules\nAll money fields are integer cents and timestamps are UTC.\n1. Eligible orders: status=fulfilled and placedAt in [2026-10-01T00:00:00Z,2026-11-01T00:00:00Z). Other orders do not contribute any totals.\n2. Merge all ledger shards and deduplicate transactionId before any calculations. Exact repeats are transport retries, not extra money. List every repeated transactionId, even if the row is otherwise excluded.\n3. An effective transaction references an eligible order, has status=success, and postedAt in the same half-open window. Captures and refunds contain positive cents.\n4. grossCents sums eligible order amounts. capturedCents and refundCents sum effective transactions of each type. netCashCents=capturedCents-refundCents.\n5. An order's outstanding cents=max(0,order grossCents-effective captures). Refunds do NOT reopen receivables in this report. overall.outstandingCents is the sum of those amounts. Include only positive rows in outstanding.\n6. unknownOrderIds lists every order reference not present in orders.csv from the deduplicated ledger, independent of status/date. Exclude unknown references from financial totals.\n7. Each byRegion row uses exactly the same calculations for orders in that region. Include east,north,west, even if a total is zero.\n`,
  };
  for (let i = 0; i < ledgers.length; i++) files[`inputs/ledger-${i + 1}.csv`] = csv(fields, ledgers[i].map(row => fields.map(field => row[field])));
  return { files, expected };
}
const reconciliation = makeReconciliation();

// The gateway's short timeout has both positive causal evidence (config values,
// completed upstream requests, rollback) and negative controls. Unknown intent
// and financial loss must remain unknown rather than being guessed.
function makeIncident() {
  const gateways = [], apps = [], databases = [];
  const addRequest = (n, startedAt, region, fail, retry = false) => {
    const requestId = `R${String(n).padStart(3, '0')}`;
    const suffix = retry ? 'B' : 'A';
    const startMs = Date.parse(startedAt);
    const eventAt = (extra) => new Date(startMs + extra).toISOString().replace('.000Z', 'Z');
    gateways.push({ eventId: `G${n}${suffix}`, time: eventAt(fail ? 200 : 450), requestId, region, route: '/checkout', status: fail ? 504 : 200, timeoutMs: fail ? 200 : 2000, error: fail ? 'upstream_deadline_exceeded' : null, attempt: retry ? 2 : 1 });
    apps.push({ eventId: `A${n}${suffix}`, time: eventAt(450), requestId, region, status: 200, elapsedMs: 450, instance: 'checkout-7' });
    databases.push({ eventId: `D${n}${suffix}`, time: eventAt(90), requestId, status: 'ok', elapsedMs: 42, poolWaitMs: 0 });
  };
  addRequest(1, '2026-11-05T09:59:00Z', 'eu-west', false);
  addRequest(2, '2026-11-05T09:59:20Z', 'eu-west', false);
  const starts = ['10:00:05', '10:00:40', '10:01:10', '10:01:45', '10:02:20', '10:03:00', '10:03:40', '10:04:30'];
  for (let i = 0; i < starts.length; i++) addRequest(10 + i, `2026-11-05T${starts[i]}Z`, 'eu-west', true);
  addRequest(10, '2026-11-05T10:00:06Z', 'eu-west', true, true);
  addRequest(13, '2026-11-05T10:01:46Z', 'eu-west', true, true);
  for (let i = 0; i < 6; i++) addRequest(30 + i, `2026-11-05T10:0${i % 5}:15Z`, 'us-east', false);
  addRequest(40, '2026-11-05T10:05:01Z', 'eu-west', false);
  addRequest(41, '2026-11-05T10:05:20Z', 'eu-west', false);
  for (let i = 0; i < 24; i++) gateways.push({ eventId: `H${i}`, time: `2026-11-05T10:0${i % 6}:${String(i + 1).padStart(2, '0')}Z`, requestId: `HEALTH${i}`, region: i % 2 ? 'eu-west' : 'us-east', route: '/health', status: 200, timeoutMs: 2000, error: null, attempt: 1 });
  const ops = [
    { eventId: 'O1', time: '2026-11-05T09:58:00Z', action: 'deployment', service: 'gateway', region: 'eu-west', version: 'gw-4.12', result: 'success', note: 'binary deployment complete; checkout timeout still 2000ms' },
    { eventId: 'O2', time: '2026-11-05T10:00:00Z', action: 'config_applied', service: 'gateway', region: 'eu-west', route: '/checkout', key: 'upstream_timeout_ms', before: 2000, after: 200, changeId: 'CFG-88' },
    { eventId: 'O3', time: '2026-11-05T10:01:00Z', action: 'capacity_sample', dbCpuPct: 23, dbConnections: 14, dbConnectionLimit: 100, dbP95Ms: 43, checkoutCrashesSinceBoot: 0, checkoutUptimeSeconds: 81200 },
    { eventId: 'O4', time: '2026-11-05T10:02:00Z', action: 'dns_probe', region: 'eu-west', target: 'checkout.internal', result: 'success', latencyMs: 2, resolvedAddress: '10.2.7.10' },
    { eventId: 'O5', time: '2026-11-05T10:05:00Z', action: 'config_rolled_back', region: 'eu-west', route: '/checkout', key: 'upstream_timeout_ms', before: 200, after: 2000, changeId: 'CFG-88' },
    { eventId: 'O6', time: '2026-11-05T10:06:00Z', action: 'audit_note', text: 'Change audit identity was not captured. No payment settlement, chargeback, lost-sale or user compensation records are included in this bundle.' },
  ];
  const failed = gateways.filter(row => row.status >= 500);
  const unique = ordered(new Set(failed.map(row => row.requestId)));
  const files = {
    'inputs/gateway.jsonl': gateways.sort((a, b) => a.time.localeCompare(b.time)).map(row => JSON.stringify(row)).join('\n') + '\n',
    'inputs/application.jsonl': apps.sort((a, b) => a.time.localeCompare(b.time)).map(row => JSON.stringify(row)).join('\n') + '\n',
    'inputs/database.jsonl': databases.sort((a, b) => a.time.localeCompare(b.time)).map(row => JSON.stringify(row)).join('\n') + '\n',
    'inputs/operations.jsonl': ops.map(row => JSON.stringify(row)).join('\n') + '\n',
    'inputs/README.md': `# Incident bundle\nAll timestamps are UTC. The incident window is [2026-11-05T10:00:00Z,2026-11-05T10:05:00Z). These logs are the complete request records in that interval. A retry repeats requestId with attempt=2; count failed attempts and distinct failed requests separately. /health is not /checkout.\nUse positive evidence, control requests, operations history and upstream outcomes to distinguish hypotheses; timing alone does not establish a cause. Do not infer financial loss from HTTP errors.\nThe required four hypothesis keys are database_overload, application_crash, dns_failure, malicious_change. Verdict must be supported, contradicted, or undetermined according to this bundle. Evidence IDs must reference actual events; application and DB event IDs refer to the associated requestId.\nRoot cause code must be one of gateway_timeout_regression, database_overload, application_crash, dns_failure, undetermined.\nFor unknowns, choose every unsupported item from change_author and financial_loss_cents.\n`,
  };
  return {
    files,
    expected: {
      version: 1,
      impact: { region: 'eu-west', route: '/checkout', failedAttempts: failed.length, distinctFailedRequests: unique.length, retryFailedAttempts: failed.filter(row => row.attempt > 1).length, failedRequestIds: unique },
      firstFailureAt: failed.map(row => row.time).sort()[0],
      firstRecoveredAt: gateways.find(row => row.eventId === 'G40A').time,
      rootCauseCode: 'gateway_timeout_regression',
      unknowns: ['change_author', 'financial_loss_cents'],
    },
    ids: new Set([...gateways, ...apps, ...databases, ...ops].map(row => row.eventId)),
  };
}
const incident = makeIncident();

// Versioned policy application: dates, immutable restrictions, caps and scoped
// exceptions are separate. Requests deliberately include boundary dates.
function makePolicy() {
  const policies = [
    { id: 'POL-2026-09', effectiveFrom: '2026-09-01', effectiveUntil: '2026-11-01', retention: { standard: 60, enterprise: 120 }, caps: { public: null, internal: null, personal: 60, restricted: 14 } },
    { id: 'POL-2026-11', effectiveFrom: '2026-11-01', effectiveUntil: null, retention: { standard: 30, enterprise: 90 }, caps: { public: null, internal: null, personal: 30, restricted: 7 } },
  ];
  const exceptions = [
    { id: 'EX-ATLAS', tenant: 'Atlas', tier: 'enterprise', classes: ['public', 'internal'], from: '2026-11-01', until: '2026-12-01', retentionDays: 60 },
    { id: 'EX-DELTA', tenant: 'Delta', tier: 'standard', classes: ['personal'], from: '2026-10-20', until: '2026-11-10', retentionDays: 45 },
    { id: 'EX-CEDAR', tenant: 'Cedar', tier: 'enterprise', classes: ['internal'], from: '2026-10-01', until: '2026-11-01', retentionDays: 120 },
  ];
  const base = { date: '2026-11-12', tenant: 'Birch', tier: 'standard', dataClass: 'internal', action: 'read', subjectResidency: 'us', destinationRegion: 'us', sanctioned: false, approvedSecurityTicket: false };
  const rows = [
    {},
    { action: 'export' },
    { tier: 'enterprise', action: 'export' },
    { dataClass: 'personal', action: 'export', subjectResidency: 'eu', destinationRegion: 'us' },
    { dataClass: 'personal', action: 'export', subjectResidency: 'eu', destinationRegion: 'eu' },
    { dataClass: 'restricted', action: 'export' },
    { dataClass: 'restricted', action: 'export', approvedSecurityTicket: true },
    { tier: 'enterprise', sanctioned: true, action: 'read' },
    { tenant: 'Atlas', tier: 'enterprise', dataClass: 'internal', action: 'export' },
    { tenant: 'Atlas', tier: 'enterprise', dataClass: 'personal', subjectResidency: 'eu' },
    { date: '2026-11-09', tenant: 'Delta', dataClass: 'personal' },
    { date: '2026-11-10', tenant: 'Delta', dataClass: 'personal' },
    { date: '2026-10-31', tenant: 'Delta', dataClass: 'personal', action: 'export' },
    { date: '2026-11-01', tenant: 'Cedar', tier: 'enterprise' },
    { date: '2026-10-31', tenant: 'Cedar', tier: 'enterprise', dataClass: 'restricted', action: 'export', approvedSecurityTicket: true },
    { date: '2026-11-01', tenant: 'Atlas', tier: 'enterprise', dataClass: 'internal', sanctioned: true, action: 'export' },
  ].map((overrides, index) => ({ requestId: `Q${String(index + 1).padStart(2, '0')}`, ...base, ...overrides }));
  const decide = request => {
    const policy = policies.find(p => request.date >= p.effectiveFrom && (!p.effectiveUntil || request.date < p.effectiveUntil));
    const exception = exceptions.find(e => request.tenant === e.tenant && request.tier === e.tier && e.classes.includes(request.dataClass) && request.date >= e.from && request.date < e.until);
    const old = policy.id === 'POL-2026-09';
    let decision = 'allow';
    if (request.sanctioned) decision = 'deny';
    else if (request.action === 'export' && request.dataClass === 'restricted') decision = !old && request.approvedSecurityTicket ? 'needs_review' : 'deny';
    else if (request.action === 'export' && request.dataClass === 'personal' && request.subjectResidency === 'eu' && request.destinationRegion !== 'eu') decision = 'deny';
    else if (request.action === 'export' && request.dataClass === 'personal') decision = 'needs_review';
    else if (request.action === 'export' && request.tier === 'standard') decision = 'needs_review';
    const uncapped = exception?.retentionDays ?? policy.retention[request.tier];
    const capped = policy.caps[request.dataClass] === null ? uncapped : Math.min(uncapped, policy.caps[request.dataClass]);
    return {
      requestId: request.requestId, decision,
      retentionDays: decision === 'deny' ? null : capped,
      storageRegion: decision === 'deny' ? null : request.dataClass === 'personal' && request.subjectResidency === 'eu' ? 'eu' : 'us',
      policyId: policy.id,
      exceptionId: exception?.id ?? null,
    };
  };
  return {
    files: {
      'inputs/requests.json': json(rows),
      'inputs/policies.json': json(policies),
      'inputs/exceptions.json': json(exceptions),
      'inputs/decision-rules.md': `# Retention and export decision procedure\nUse each request's date (UTC calendar date), not today's date. Date ranges include from and exclude until; null until has no end. Select exactly one policy version.\n\nDecision priority (first matching row wins):\n1. sanctioned=true => deny, for every action and version. No exception overrides this.\n2. action=export and dataClass=restricted: POL-2026-09 always denies; POL-2026-11 returns needs_review only when approvedSecurityTicket=true, otherwise deny.\n3. action=export and dataClass=personal and subjectResidency=eu and destinationRegion!=eu => deny in both versions.\n4. Any other personal export => needs_review.\n5. Any other export by tier=standard => needs_review.\n6. All remaining requests => allow.\n\nRetention: start with the chosen policy's retention[tier]. An exception matches only when tenant, tier, class membership and half-open date range all match; replace the starting retention with exception.retentionDays. Then apply the chosen policy's dataClass cap via minimum; a null cap means no cap. Exceptions cannot override caps or decision rules.\nStorage region: personal data with EU subject residency uses eu; all other allowed/reviewed requests use us. For deny, retentionDays and storageRegion must both be null.\nReport the matching exceptionId (or null) even for deny, so rule applicability can be audited independently of decision. No request has two matching exceptions.\n`,
    },
    expected: { version: 1, decisions: rows.map(decide) },
  };
}
const policy = makePolicy();

export const analysisCases = [
  {
    id: 'analysis-reconciliation', title: '跨分片月末交易对账', category: 'analysis', timeoutSeconds: 420,
    prompt: `请根据 inputs/orders.csv、三个 ledger 分片和 inputs/rules.md，完成 2026 年 10 月对账。直接交付 outputs/result.json，金额保持整数分；最终用中文简短说明主要结果，不需要询问。不要修改输入文件。\nJSON 顶层字段：version=1，cutoffExclusive，overall，byRegion，outstanding，duplicateTransactionIds，unknownOrderIds。\noverall 和每个 byRegion 行均含 orderCount、grossCents、capturedCents、refundCents、netCashCents、outstandingCents；byRegion 行另外含 region。outstanding 每行是 {orderId,cents}，只含正数。两个异常字段是去重后的字符串数组。数组顺序不限。规则中明确了哪些订单/交易计入、退款与应收的关系，务必按规则处理重试和时间边界。`,
    files: reconciliation.files,
    async grade({ project }) {
      const { value: actual, error } = await readResult(project), expected = reconciliation.expected;
      const pick = (object, keys) => Object.fromEntries(keys.map(key => [key, object?.[key]]));
      const entries = [
        check('结构与截止时间', actual?.version === 1 && sameTime(actual?.cutoffExclusive, expected.cutoffExclusive), 3, error),
        check('订单数与原始金额', equal(pick(actual?.overall, ['orderCount', 'grossCents']), pick(expected.overall, ['orderCount', 'grossCents'])), 12),
        check('成功收款与退款', equal(pick(actual?.overall, ['capturedCents', 'refundCents']), pick(expected.overall, ['capturedCents', 'refundCents'])), 12),
        check('净现金与未收款', equal(pick(actual?.overall, ['netCashCents', 'outstandingCents']), pick(expected.overall, ['netCashCents', 'outstandingCents'])), 12),
        ...expected.byRegion.map(row => check(`${row.region} 分区全部指标`, Array.isArray(actual?.byRegion) && actual.byRegion.filter(candidate => candidate?.region === row.region).length === 1 && fieldsEqual(actual.byRegion.find(candidate => candidate?.region === row.region), row), 12)),
        check('逐订单未收款明细', rowsEqual(actual?.outstanding, expected.outstanding, 'orderId'), 15),
        check('全部重复交易编号', Array.isArray(actual?.duplicateTransactionIds) && equal(ordered(actual.duplicateTransactionIds), expected.duplicateTransactionIds), 5),
        check('全部未知订单引用', Array.isArray(actual?.unknownOrderIds) && equal(ordered(actual.unknownOrderIds), expected.unknownOrderIds), 5),
      ];
      return result(entries);
    },
  },
  {
    id: 'analysis-incident', title: '跨服务故障因果与影响核对', category: 'analysis', timeoutSeconds: 420,
    prompt: `调查 inputs/ 中的故障材料，区分触发原因、影响和不能确定的事实。交付 outputs/result.json，最后用中文简短说明原因和局限，不需要询问。不要修改输入。\nJSON 字段：version=1；impact={region,route,failedAttempts,distinctFailedRequests,retryFailedAttempts,failedRequestIds}；firstFailureAt（首次失败的网关事件时间）；firstRecoveredAt（回滚后首个同区域同路由成功的网关事件时间）；rootCause={code,evidenceIds}；hypotheses={database_overload:{verdict,evidenceIds},application_crash:{verdict,evidenceIds},dns_failure:{verdict,evidenceIds},malicious_change:{verdict,evidenceIds}}；timeline（必要的四个节点：触发配置、首次失败、回滚、首次恢复，各为 {eventId,time}，按时间排序）；unknowns（字符串数组）。\n至少用一条配置变更、一条失败请求及其对应上游成功记录、一条回滚、一条恢复记录支撑根因。每个被排除的竞争假设都给材料中的反证；无法判断时明确 undetermined。合法 code、verdict、候选未知项及统计口径见 inputs/README.md。不得编造事件或把重试当成独立受影响请求。`,
    files: incident.files,
    async grade({ project }) {
      const { value: actual, error } = await readResult(project), expected = incident.expected;
      const evidence = actual?.rootCause?.evidenceIds;
      const hasEvidence = Array.isArray(evidence) && evidence.includes('O2') && evidence.includes('O5') && evidence.includes('G40A') && expected.impact.failedRequestIds.some(id => {
        const n = Number(id.slice(1)); return evidence.includes(`G${n}A`) && evidence.includes(`A${n}A`);
      });
      const allEvidence = [evidence, ...Object.values(actual?.hypotheses ?? {}).map(row => row?.evidenceIds)].flat();
      const timeline = [{ eventId: 'O2', time: '2026-11-05T10:00:00Z' }, { eventId: 'G10A', time: expected.firstFailureAt }, { eventId: 'O5', time: '2026-11-05T10:05:00Z' }, { eventId: 'G40A', time: expected.firstRecoveredAt }];
      const hypothesis = (key, verdict, required) => actual?.hypotheses?.[key]?.verdict === verdict && Array.isArray(actual.hypotheses[key].evidenceIds) && required.some(id => actual.hypotheses[key].evidenceIds.includes(id));
      return result([
        check('输出版本与结构', actual?.version === 1 && actual?.rootCause && actual?.hypotheses, 4, error),
        check('受影响区域与路由', actual?.impact?.region === expected.impact.region && actual?.impact?.route === expected.impact.route, 6),
        check('失败尝试、独立请求与重试计数', actual?.impact?.failedAttempts === expected.impact.failedAttempts && actual?.impact?.distinctFailedRequests === expected.impact.distinctFailedRequests && actual?.impact?.retryFailedAttempts === expected.impact.retryFailedAttempts, 12),
        check('完整受影响请求集', Array.isArray(actual?.impact?.failedRequestIds) && equal(ordered(actual.impact.failedRequestIds), expected.impact.failedRequestIds), 8),
        check('首次失败与恢复时间', sameTime(actual?.firstFailureAt, expected.firstFailureAt) && sameTime(actual?.firstRecoveredAt, expected.firstRecoveredAt), 8),
        check('根因判断', actual?.rootCause?.code === expected.rootCauseCode, 12),
        check('可复核的因果证据链', hasEvidence, 14),
        check('排除数据库过载', hypothesis('database_overload', 'contradicted', ['O3', 'D10A', 'D11A', 'D12A', 'D13A', 'D14A', 'D15A', 'D16A', 'D17A']), 6),
        check('排除应用崩溃', hypothesis('application_crash', 'contradicted', ['O3', 'A10A', 'A11A', 'A12A', 'A13A', 'A14A', 'A15A', 'A16A', 'A17A']), 6),
        check('排除DNS故障', hypothesis('dns_failure', 'contradicted', ['O4']), 6),
        check('未推断变更动机', actual?.hypotheses?.malicious_change?.verdict === 'undetermined' && Array.isArray(actual.hypotheses.malicious_change.evidenceIds), 4),
        check('必要四节点时间轴', Array.isArray(actual?.timeline) && actual.timeline.length === timeline.length && actual.timeline.every((row, index) => row?.eventId === timeline[index].eventId && sameTime(row?.time, timeline[index].time)), 6),
        check('明确未知作者与损失', Array.isArray(actual?.unknowns) && equal(ordered(actual.unknowns), ordered(expected.unknowns)), 4),
        check('证据编号均真实存在', allEvidence.length > 0 && allEvidence.every(id => typeof id === 'string' && incident.ids.has(id)), 4),
      ]);
    },
  },
  {
    id: 'analysis-policy', title: '版本化规则、例外与边界日期', category: 'analysis', timeoutSeconds: 420,
    prompt: `请依据 inputs/decision-rules.md、policies.json、exceptions.json，为 requests.json 中所有请求形成可审计决策。交付 outputs/result.json，最终中文简短说明最容易误用的规则，不需要询问。不要修改输入。\nJSON 格式：{version:1,decisions:[{requestId,decision,retentionDays,storageRegion,policyId,exceptionId}]}。decision 只能是 allow、deny、needs_review；日期按每条请求自身的 date 计算；未匹配例外的 exceptionId=null。deny 的 retentionDays 和 storageRegion 都为 null，但仍须报告匹配的政策与例外。全部请求各一行，不重不漏，数组顺序不限。例外范围、版本边界、不可突破的上限和决策优先级都以材料为准。`,
    files: policy.files,
    async grade({ project }) {
      const { value: actual, error } = await readResult(project), expected = policy.expected;
      return result([
        check('版本与完整且无重复的请求集', actual?.version === 1 && Array.isArray(actual?.decisions) && actual.decisions.length === expected.decisions.length && equal(ordered(actual.decisions.map(row => row?.requestId)), ordered(expected.decisions.map(row => row.requestId))), 4, error),
        ...expected.decisions.map(row => check(`${row.requestId} 决策、保留、地域和规则来源`, Array.isArray(actual?.decisions) && actual.decisions.filter(candidate => candidate?.requestId === row.requestId).length === 1 && fieldsEqual(actual.decisions.find(candidate => candidate?.requestId === row.requestId), row), 6)),
      ]);
    },
  },
];

// Exposed only to the suite's own deterministic self-check, never fixture files.
export const analysisReferenceResults = {
  'analysis-reconciliation': reconciliation.expected,
  'analysis-incident': {
    version: 1, impact: incident.expected.impact,
    firstFailureAt: incident.expected.firstFailureAt, firstRecoveredAt: incident.expected.firstRecoveredAt,
    rootCause: { code: incident.expected.rootCauseCode, evidenceIds: ['O2', 'G10A', 'A10A', 'O5', 'G40A'] },
    hypotheses: {
      database_overload: { verdict: 'contradicted', evidenceIds: ['O3', 'D10A'] },
      application_crash: { verdict: 'contradicted', evidenceIds: ['O3', 'A10A'] },
      dns_failure: { verdict: 'contradicted', evidenceIds: ['O4'] },
      malicious_change: { verdict: 'undetermined', evidenceIds: ['O6'] },
    },
    timeline: [{ eventId: 'O2', time: '2026-11-05T10:00:00Z' }, { eventId: 'G10A', time: incident.expected.firstFailureAt }, { eventId: 'O5', time: '2026-11-05T10:05:00Z' }, { eventId: 'G40A', time: incident.expected.firstRecoveredAt }],
    unknowns: incident.expected.unknowns,
  },
  'analysis-policy': policy.expected,
};
