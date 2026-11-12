import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const mean = list => { const known = list.filter(Number.isFinite); return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null; };
const format = (value, digits = 1) => value == null ? '—' : Number(value).toFixed(digits);
const seconds = row => row.responseElapsedMs == null ? null : row.responseElapsedMs / 1000;
const tokenLabel = row => row.usage?.totalTokens == null ? '未知' : `${row.usage.missingUsageRequests ? '≥ ' : ''}${row.usage.totalTokens}`;
const candidateLabel = row => row.terminalCandidate == null ? '未知' : row.terminalCandidate.seq == null ? '无' : `${row.terminalCandidate.characters} 字符 / seq ${row.terminalCandidate.seq}`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const armLabel = arm => ({ single: '单 Agent', 'moa-baseline': '旧 MoA+', moa: '新 MoA+' }[arm] ?? arm);

export async function makeReport(manifestPath) {
  const directory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const arms = manifest.arms ?? [...new Set(manifest.runs.map(row => row.arm))];
  const rows = [];
  for (const entry of manifest.runs) {
    try { rows.push(JSON.parse(await readFile(join(directory, 'runs', entry.id, 'scored.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const groups = [];
  for (const category of ['all', 'simple', 'code', 'analysis']) {
    for (const arm of arms) {
      const runs = rows.filter(row => row.arm === arm && (category === 'all' || row.category === category));
      const knownTokenRuns = runs.filter(row => Number.isFinite(row.usage?.totalTokens));
      const sumUsage = key => { const known = runs.map(row => row.usage?.[key]).filter(Number.isFinite); return known.length ? known.reduce((total, value) => total + value, 0) : null; };
      groups.push({ category, arm, count: runs.length, meanScore: mean(runs.map(row => row.grade.score)),
        completed: runs.filter(row => row.completed).length,
        budgetStopped: runs.filter(row => row.stopReason === 'aggregate-budget-exceeded').length,
        measuredInputTokens: sumUsage('inputTokens'), measuredCacheReadTokens: sumUsage('cacheReadTokens'),
        measuredCacheWriteTokens: sumUsage('cacheWriteTokens'), measuredOutputTokens: sumUsage('outputTokens'),
        perfectCompleted: runs.filter(row => row.completed && row.validControl && row.grade.score === 100).length,
        meanSeconds: mean(runs.map(row => row.responseElapsedMs == null ? null : row.responseElapsedMs / 1000)),
        meanTokens: mean(runs.filter(row => row.usage?.missingUsageRequests === 0).map(row => row.usage?.totalTokens)),
        fullyMeasuredUsageRuns: runs.filter(row => row.usage?.missingUsageRequests === 0).length,
        measuredTotalTokens: knownTokenRuns.reduce((total, row) => total + row.usage.totalTokens, 0),
        meanMeasuredTokensLowerBound: knownTokenRuns.length === runs.length ? mean(knownTokenRuns.map(row => row.usage.totalTokens)) : null,
        meanRequests: mean(runs.map(row => row.modelRequestCount)),
        incompleteUsageRuns: runs.filter(row => row.usage?.missingUsageRequests !== 0).length,
        missingUsageRequests: runs.reduce((total, row) => total + (row.usage?.missingUsageRequests ?? 0), 0),
        invalidControls: runs.filter(row => !row.validControl).length });
    }
  }
  const pairedComparison = (referenceArm, candidateArm) => {
    const pairs = [];
    for (const task of manifest.cases) {
    for (let repetition = 1; repetition <= manifest.repetitions; repetition++) {
      const reference = rows.find(row => row.caseId === task.id && row.repetition === repetition && row.arm === referenceArm);
      const candidate = rows.find(row => row.caseId === task.id && row.repetition === repetition && row.arm === candidateArm);
      if (reference && candidate) pairs.push({ caseId: task.id, repetition, qualityDelta: candidate.grade.score - reference.grade.score,
        validControls: reference.validControl && candidate.validControl,
        completedDelta: Number(candidate.completed) - Number(reference.completed),
        bothCompleted: reference.completed && candidate.completed,
        secondsRatio: reference.completed && candidate.completed && reference.responseElapsedMs ? candidate.responseElapsedMs / reference.responseElapsedMs : null,
        tokenRatio: reference.usage?.totalTokens && reference.usage.missingUsageRequests === 0 && candidate.usage?.missingUsageRequests === 0 ? candidate.usage.totalTokens / reference.usage.totalTokens : null });
    }
    }
    const valid = pairs.filter(pair => pair.validControls);
    return { referenceArm, candidateArm, pairs, qualityWins: valid.filter(pair => pair.qualityDelta > 0).length,
      qualityTies: valid.filter(pair => pair.qualityDelta === 0).length, qualityLosses: valid.filter(pair => pair.qualityDelta < 0).length };
  };
  const comparisons = arms.includes('moa-baseline') ? [pairedComparison('single', 'moa-baseline'), pairedComparison('single', 'moa'), pairedComparison('moa-baseline', 'moa')] : [pairedComparison('single', 'moa')];
  const primary = comparisons.find(comparison => comparison.referenceArm === 'single' && comparison.candidateArm === 'moa');
  const pairs = primary.pairs;
  const comparisonText = comparisons.map(comparison => `${armLabel(comparison.candidateArm)} 相对 ${armLabel(comparison.referenceArm)}：${comparison.pairs.length} 对，产物分更高 ${comparison.qualityWins} 对、持平 ${comparison.qualityTies} 对、更低 ${comparison.qualityLosses} 对。`).join(' ');
  const report = { createdAt: new Date().toISOString(), complete: rows.length === manifest.runs.length,
    executionRendererSha256: manifest.sources['report.mjs'],
    rendererSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    finishedRuns: rows.length, plannedRuns: manifest.runs.length, model: manifest.model, candidate: manifest.candidate,
    ...(manifest.baseline ? { baseline: manifest.baseline } : {}), arms,
    limits: manifest.limits, concurrency: manifest.concurrency, groups, pairs, comparisons,
    qualityWins: primary.qualityWins, qualityTies: primary.qualityTies, qualityLosses: primary.qualityLosses,
    rows: rows.map(row => ({ ...row, requests: undefined, project: undefined, tools: undefined })) };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  const lines = [
    '# 单 Agent 与 MoA+ 对照评测', '',
    `已完成 ${rows.length}/${manifest.runs.length} 次；模型 ${manifest.model.provider}/${manifest.model.model}，推理强度 ${manifest.model.reasoningEffort}。`, '',
    `这是固定合成任务的初步对照。每题 ${arms.length} 组各运行 ${manifest.repetitions} 次，使用相同模型、工具运行时和资源上限；单 Agent 禁用子 Agent 入口，MoA+ 各版本使用默认按需验收。提示不要求协作或验收。`, '',
    ...(manifest.baseline ? [`旧 MoA+：${manifest.baseline.version}，commit ${manifest.baseline.commit}；新 MoA+：${manifest.candidate.version}，commit ${manifest.candidate.commit}。两份 Host/Client 哈希在计划及各运行中固定，旧 MoA+ 独立挂载基线插件，保留协作能力。`, ''] : []),
    '评分采用预先冻结的客观结果检查。分析任务修改输入违反明确要求，该次记零分。超时保留产物的部分得分，正常完成率与满分交付率另列。用量包含主 Agent、Worker、验收助手及后台判断请求；推理 token 属于输出，不重复计算。平均已记录 token 纳入全部有数值的运行，usage 不完整时标为下限（≥），不把它当精确消耗；完整样本均值另存在 JSON 中，并附样本数。用量比值只用于两边 usage 完整的配对。', '',
    '平均秒是运行到正常交付或被停止的时间。预算终止可能更早，但不代表更快完成任务；配对速度比只计算两组均正常交付的任务。后台判断保留生产默认推理参数，实际参数在逐请求记录中。', '',
    '| 范围 | 模式 | 已跑 | 产物平均分/100 | 预算内正常结束 | 预算终止 | 满分且预算内结束 | 平均交付/停止秒 | 平均已记录 token | 平均请求 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...groups.map(group => `| ${group.category} | ${armLabel(group.arm)} | ${group.count} | ${format(group.meanScore)} | ${group.completed} | ${group.budgetStopped} | ${group.perfectCompleted} | ${format(group.meanSeconds)} | ${group.incompleteUsageRuns ? '≥ ' : ''}${format(group.meanMeasuredTokensLowerBound, 0)} | ${format(group.meanRequests)} |`), '',
    '| 模式 | 已记录非缓存输入 | 缓存读取 | 缓存写入 | 输出 | 已记录总 token |',
    '|---|---:|---:|---:|---:|---:|',
    ...groups.filter(group => group.category === 'all').map(group => `| ${armLabel(group.arm)} | ${format(group.measuredInputTokens, 0)} | ${format(group.measuredCacheReadTokens, 0)} | ${format(group.measuredCacheWriteTokens, 0)} | ${format(group.measuredOutputTokens, 0)} | ${format(group.measuredTotalTokens, 0)} |`), '',
    '用量不完整组的分桶合计也只是已记录下限。总 token 包含缓存读取，是累计流量，不是新增推理量或折算费用。候选文本只记录最后无工具调用、后续无新步骤或工具事件的文本字符数和序号，不证明正常结束；旧结果未采集该项时显示未知。', '',
    comparisonText, '',
    `用量不完整：${rows.filter(row => row.usage?.missingUsageRequests !== 0).length} 次；无效对照：${rows.filter(row => !row.validControl).length} 次。`, '',
    '| 任务 | 次数 | 模式 | 产物分 | 预算内正常结束 | 候选文本（非结束判定） | 交付/停止秒 | 已记录 token | 请求 | 普通 Worker | 验收助手 | 停止原因 |',
    '|---|---:|---|---:|---|---|---:|---:|---:|---:|---:|---|',
    ...rows.map(row => `| ${row.title} | ${row.repetition} | ${armLabel(row.arm)} | ${row.grade.score} | ${row.completed ? '是' : '否'} | ${candidateLabel(row)} | ${format(seconds(row))} | ${tokenLabel(row)} | ${row.modelRequestCount ?? '—'} | ${row.agents?.filter(agent => agent.kind === 'worker').length ?? 0} | ${row.agents?.filter(agent => ['builder', 'verifier'].includes(agent.kind)).length ?? 0} | ${row.stopReason ?? '—'} |`), '',
    '## 解释范围', '',
    `- 仅使用这一模型、版本和 ${manifest.cases.length} 类任务；${manifest.repetitions} 次重复不足以判断统计显著性或所有真实任务的效果。`,
    `- 同题各组并发度为 ${manifest.concurrency}，组内原生子 Agent 可另行并发；实际执行顺序在 manifest.json 中。服务负载和跨请求缓存会影响耗时及缓存比例。`,
    '- 总 token 上限在请求入口与 usage 返回时检查，已并行在途的请求可能超出上限；每次超额量均记录。',
    '- 任务工作区和两个 Agent 配置根目录各自独立；评分源码没有提供给模型。此安排不等同于操作系统强制禁止读取工作区之外。',
    '- 本评测测量执行结果与对话文字数量，不代替桌面视觉、可用性或长期多轮记忆评测。',
    '- 完整输入、模型请求用量、失败、评分检查与会话原始证据保留在此输出目录，不进入生产包。', '',
    ...(report.rendererSha256 !== report.executionRendererSha256 ? ['报告展示器与执行时版本不同：仅改进用量缺失及预算终止时间的呈现；执行时哈希仍保留在 manifest，评分与原始执行结果不随展示器改变。', ''] : []),
  ];
  await writeFile(join(directory, 'report.md'), lines.join('\n'));
  const table = `<table><thead><tr>${['任务','次数','模式','产物分','预算内正常结束','候选文本（非结束判定）','交付/停止秒','已记录token','请求','Worker','验收助手'].map(item=>`<th>${item}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${[row.title,row.repetition,armLabel(row.arm),row.grade.score,row.completed?'是':(row.stopReason??'否'),candidateLabel(row),format(seconds(row)),tokenLabel(row),row.modelRequestCount??'—',row.agents?.filter(agent=>agent.kind==='worker').length??0,row.agents?.filter(agent=>['builder','verifier'].includes(agent.kind)).length??0].map(item=>`<td>${escape(item)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const usageTable = `<table><thead><tr>${['模式','预算内正常结束','预算终止','非缓存输入','缓存读','缓存写','输出','已记录总token'].map(item=>`<th>${item}</th>`).join('')}</tr></thead><tbody>${groups.filter(group=>group.category==='all').map(group=>`<tr>${[armLabel(group.arm),group.completed,group.budgetStopped,format(group.measuredInputTokens,0),format(group.measuredCacheReadTokens,0),format(group.measuredCacheWriteTokens,0),format(group.measuredOutputTokens,0),format(group.measuredTotalTokens,0)].map(item=>`<td>${escape(item)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  await writeFile(join(directory, 'report.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>单 Agent 与 MoA+ 对照评测</title><style>body{font:16px/1.6 system-ui;max-width:1280px;margin:40px auto;padding:0 24px;color:#20252d;background:#fafafa}table{border-collapse:collapse;width:100%;background:white}td,th{padding:9px 12px;border-bottom:1px solid #ddd;text-align:left}th{background:#eef1f6}td:nth-child(n+4){font-variant-numeric:tabular-nums}p{max-width:900px}</style><h1>单 Agent 与 MoA+ 对照评测</h1><p>已采集 ${rows.length}/${manifest.runs.length} 次，${arms.length} 组。${escape(manifest.model.provider)}/${escape(manifest.model.model)} · ${escape(manifest.model.reasoningEffort)}。</p><p>${escape(comparisonText)}</p><p>产物分与预算内正常结束分别统计，候选文本不证明完成，旧结果未采集时为未知。总token包含缓存读取，是累计流量，不是新增推理量或折算费用；usage不完整时分桶合计也只是已记录下限。预算终止不代表程序崩溃或更快交付。</p>${usageTable}${table}<p>完整口径、分项统计与限制见同目录 report.md；原始证据见 runs/。</p></html>`);
  return report;
}
