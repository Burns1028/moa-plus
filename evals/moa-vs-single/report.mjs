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
const armLabel = arm => ({ single: '单 Agent', 'single-compact': '单 Agent（早压缩）', 'moa-baseline': '旧 MoA+', moa: '新 MoA+', 'moa-compact': '新 MoA+（早压缩）' }[arm] ?? arm);

export function comparisonArmPairs(arms) {
  if (arms.includes('single-compact')) return [['single', 'moa'], ['single-compact', 'moa-compact'], ['single', 'single-compact'], ['moa', 'moa-compact']];
  return arms.includes('moa-baseline') ? [['single', 'moa-baseline'], ['single', 'moa'], ['moa-baseline', 'moa']] : [['single', 'moa']];
}
const compactionKeys = ['started', 'succeeded', 'failed', 'failedAfterCancelRequest', 'unfinished', 'unfinishedCancelRequested', 'summaryEvents', 'pruned', 'summaryRequests', 'summaryRequestsCancelled', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens', 'missingUsageRequests'];

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
      const observedCompactions = runs.map(row => row.compaction?.metrics).filter(Boolean);
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
        invalidControls: runs.filter(row => !row.validControl).length,
        compaction: { measuredRuns: observedCompactions.length, unmeasuredRuns: runs.length - observedCompactions.length,
          ...Object.fromEntries(compactionKeys.map(key => [key, observedCompactions.length ? observedCompactions.reduce((sum, metrics) => sum + (metrics[key] ?? 0), 0) : null])) } });
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
  const comparisons = comparisonArmPairs(arms).map(([reference, candidate]) => pairedComparison(reference, candidate));
  const primary = comparisons.find(comparison => comparison.referenceArm === 'single' && comparison.candidateArm === 'moa');
  const pairs = primary.pairs;
  const comparisonText = comparisons.map(comparison => `${armLabel(comparison.candidateArm)} 相对 ${armLabel(comparison.referenceArm)}：${comparison.pairs.length} 对，产物分更高 ${comparison.qualityWins} 对、持平 ${comparison.qualityTies} 对、更低 ${comparison.qualityLosses} 对。`).join(' ');
  const report = { createdAt: new Date().toISOString(), complete: rows.length === manifest.runs.length,
    executionRendererSha256: manifest.sources['report.mjs'],
    rendererSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    finishedRuns: rows.length, plannedRuns: manifest.runs.length, model: manifest.model, candidate: manifest.candidate,
    ...(manifest.baseline ? { baseline: manifest.baseline } : {}),
    ...(manifest.compactionStudy ? { compactionStudy: manifest.compactionStudy } : {}), arms,
    limits: manifest.limits, concurrency: manifest.concurrency, groups, pairs, comparisons,
    qualityWins: primary.qualityWins, qualityTies: primary.qualityTies, qualityLosses: primary.qualityLosses,
    rows: rows.map(row => ({ ...row, requests: undefined, project: undefined, tools: undefined })) };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  const lines = [
    '# 单 Agent 与 MoA+ 对照评测', '',
    `已完成 ${rows.length}/${manifest.runs.length} 次；模型 ${manifest.model.provider}/${manifest.model.model}，推理强度 ${manifest.model.reasoningEffort}。`, '',
    `这是固定合成任务的初步对照。每题 ${arms.length} 组各运行 ${manifest.repetitions} 次，使用相同模型、工具运行时和资源上限；单 Agent 禁用子 Agent 入口，MoA+ 各版本使用默认按需验收。提示不要求协作或验收。`, '',
    ...(manifest.baseline ? [`旧 MoA+：${manifest.baseline.version}，commit ${manifest.baseline.commit}；新 MoA+：${manifest.candidate.version}，commit ${manifest.candidate.commit}。两份 Host/Client 哈希在计划及各运行中固定，旧 MoA+ 独立挂载基线插件，保留协作能力。`, ''] : []),
    ...(manifest.compactionStudy ? [`四组只改变是否启用MoA和原生上下文策略。早压缩组仅为 ${manifest.model.provider}/${manifest.model.model} 配置 thresholdRatio=${manifest.compactionStudy.policy.thresholdRatio}、retainTokens=${manifest.compactionStudy.policy.retainTokens}、摘要maxTokens=${manifest.compactionStudy.policy.maxTokens}；主模型/推理强度、题目、评分与预算不变。MoA效果仅比较相同压缩设置的两组；另两对单独考察压缩设置，不能跨设置归因。`, ''] : []),
    '评分采用预先冻结的客观结果检查。分析任务修改输入违反明确要求，该次记零分。超时保留产物的部分得分，正常完成率与满分交付率另列。用量包含主 Agent、Worker、验收助手及后台判断请求；推理 token 属于输出，不重复计算。平均已记录 token 纳入全部有数值的运行，usage 不完整时标为下限（≥），不把它当精确消耗；完整样本均值另存在 JSON 中，并附样本数。用量比值只用于两边 usage 完整的配对。', '',
    '平均秒是运行到正常交付或被停止的时间。预算终止可能更早，但不代表更快完成任务；配对速度比只计算两组均正常交付的任务。后台判断保留生产默认推理参数，实际参数在逐请求记录中。', '',
    '| 范围 | 模式 | 已跑 | 产物平均分/100 | 预算内正常结束 | 预算终止 | 满分且预算内结束 | 平均交付/停止秒 | 平均已记录 token | 平均请求 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...groups.map(group => `| ${group.category} | ${armLabel(group.arm)} | ${group.count} | ${format(group.meanScore)} | ${group.completed} | ${group.budgetStopped} | ${group.perfectCompleted} | ${format(group.meanSeconds)} | ${group.incompleteUsageRuns ? '≥ ' : ''}${format(group.meanMeasuredTokensLowerBound, 0)} | ${format(group.meanRequests)} |`), '',
    '| 模式 | 已记录非缓存输入 | 缓存读取 | 缓存写入 | 输出 | 已记录总 token |',
    '|---|---:|---:|---:|---:|---:|',
    ...groups.filter(group => group.category === 'all').map(group => `| ${armLabel(group.arm)} | ${format(group.measuredInputTokens, 0)} | ${format(group.measuredCacheReadTokens, 0)} | ${format(group.measuredCacheWriteTokens, 0)} | ${format(group.measuredOutputTokens, 0)} | ${format(group.measuredTotalTokens, 0)} |`), '',
    '用量不完整组的分桶合计也只是已记录下限。总 token 包含缓存读取，是累计流量，不是新增推理量或折算费用。候选文本只记录最后无工具调用、后续无新步骤或工具事件的文本字符数和序号，不证明正常结束；旧结果未采集该项时显示未知。', '',
    '| 模式 | 压缩指标已采集/运行 | 启动 | 成功 | 失败总数 | 取消请求后失败（子集） | 未闭合 | 摘要事件 | prune事件 | 摘要请求 | signal已abort摘要请求 | 摘要非缓存输入 | 摘要缓存读 | 摘要输出 | 摘要已记录总token | 摘要缺usage请求 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...groups.filter(group => group.category === 'all').map(group => { const c = group.compaction; return `| ${armLabel(group.arm)} | ${c.measuredRuns}/${group.count} | ${[c.started,c.succeeded,c.failed,c.failedAfterCancelRequest,c.unfinished,c.summaryEvents,c.pruned,c.summaryRequests,c.summaryRequestsCancelled,c.inputTokens,c.cacheReadTokens,c.outputTokens,c.totalTokens,c.missingUsageRequests].map(x=>format(x,0)).join(' | ')} |`; }), '',
    '摘要请求以真实 llm/stream purpose=compaction 识别，实际 purpose/maxTokens 原样记录，缺失为null；不是从Agent身份猜测。摘要和失败/取消摘要的所有已记录用量、请求均已包含在上面的原总预算，分项不得再次相加。成功/失败来自原生 compaction/end 是否带error；失败总数保留所有error，取消请求后失败仅为其子集，不推断错误由取消造成。摘要request的signal已abort数与未闭合事务分别记录。没有agent/error或任务产物满分不代表压缩成功；8192上限导致无正文或MAX_TOKENS也保留原失败，不过滤或追加评测重试。旧结果未采集压缩指标时为未知。', '',
    comparisonText, '',
    `用量不完整：${rows.filter(row => row.usage?.missingUsageRequests !== 0).length} 次；无效对照：${rows.filter(row => !row.validControl).length} 次。`, '',
    '| 任务 | 次数 | 模式 | 产物分 | 预算内正常结束 | 候选文本（非结束判定） | 交付/停止秒 | 已记录 token | 请求 | 普通 Worker | 验收助手 | 停止原因 |',
    '|---|---:|---|---:|---|---|---:|---:|---:|---:|---:|---|',
    ...rows.map(row => `| ${row.title} | ${row.repetition} | ${armLabel(row.arm)} | ${row.grade.score} | ${row.completed ? '是' : '否'} | ${candidateLabel(row)} | ${format(seconds(row))} | ${tokenLabel(row)} | ${row.modelRequestCount ?? '—'} | ${row.agents?.filter(agent => agent.kind === 'worker').length ?? 0} | ${row.agents?.filter(agent => ['builder', 'verifier'].includes(agent.kind)).length ?? 0} | ${row.stopReason ?? '—'} |`), '',
    '## 解释范围', '',
    `- 仅使用这一模型、版本和 ${manifest.cases.length} 类任务；${manifest.repetitions} 次重复不足以判断统计显著性或所有真实任务的效果。`,
    `- 同题各组并发度为 ${manifest.concurrency}，组内原生子 Agent 可另行并发；实际执行顺序在 manifest.json 中。服务负载和跨请求缓存会影响耗时及缓存比例。各设置只按预登记配对解释，不混合成额外独立任务。`,
    '- 总 token 上限在请求入口与 usage 返回时检查，已并行在途的请求可能超出上限；每次超额量均记录。',
    '- 任务工作区和两个 Agent 配置根目录各自独立；评分源码没有提供给模型。此安排不等同于操作系统强制禁止读取工作区之外。',
    '- 本评测测量执行结果与对话文字数量，不代替桌面视觉、可用性或长期多轮记忆评测。',
    '- 完整输入、模型请求用量、失败、评分检查与会话原始证据保留在此输出目录，不进入生产包。', '',
    ...(report.rendererSha256 !== report.executionRendererSha256 ? ['报告展示器与执行时版本不同：仅改进用量缺失及预算终止时间的呈现；执行时哈希仍保留在 manifest，评分与原始执行结果不随展示器改变。', ''] : []),
  ];
  await writeFile(join(directory, 'report.md'), lines.join('\n'));
  const table = `<table><thead><tr>${['任务','次数','模式','产物分','预算内正常结束','候选文本（非结束判定）','交付/停止秒','已记录token','请求','Worker','验收助手'].map(item=>`<th>${item}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${[row.title,row.repetition,armLabel(row.arm),row.grade.score,row.completed?'是':(row.stopReason??'否'),candidateLabel(row),format(seconds(row)),tokenLabel(row),row.modelRequestCount??'—',row.agents?.filter(agent=>agent.kind==='worker').length??0,row.agents?.filter(agent=>['builder','verifier'].includes(agent.kind)).length??0].map(item=>`<td>${escape(item)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const usageTable = `<table><thead><tr>${['模式','预算内正常结束','预算终止','非缓存输入','缓存读','缓存写','输出','已记录总token'].map(item=>`<th>${item}</th>`).join('')}</tr></thead><tbody>${groups.filter(group=>group.category==='all').map(group=>`<tr>${[armLabel(group.arm),group.completed,group.budgetStopped,format(group.measuredInputTokens,0),format(group.measuredCacheReadTokens,0),format(group.measuredCacheWriteTokens,0),format(group.measuredOutputTokens,0),format(group.measuredTotalTokens,0)].map(item=>`<td>${escape(item)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const compactionTable = `<table><thead><tr>${['模式','压缩成功','失败总数','取消请求后失败子集','未闭合','摘要请求','signal已abort摘要请求','摘要输入','摘要缓存读','摘要输出','摘要缺usage'].map(item=>`<th>${item}</th>`).join('')}</tr></thead><tbody>${groups.filter(group=>group.category==='all').map(group=>{const c=group.compaction;return `<tr>${[armLabel(group.arm),c.succeeded,c.failed,c.failedAfterCancelRequest,c.unfinished,c.summaryRequests,c.summaryRequestsCancelled,c.inputTokens,c.cacheReadTokens,c.outputTokens,c.missingUsageRequests].map(item=>`<td>${escape(item==null?'未知':item)}</td>`).join('')}</tr>`;}).join('')}</tbody></table>`;
  await writeFile(join(directory, 'report.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>单 Agent 与 MoA+ 对照评测</title><style>body{font:16px/1.6 system-ui;max-width:1280px;margin:40px auto;padding:0 24px;color:#20252d;background:#fafafa}table{border-collapse:collapse;width:100%;background:white}td,th{padding:9px 12px;border-bottom:1px solid #ddd;text-align:left}th{background:#eef1f6}td:nth-child(n+4){font-variant-numeric:tabular-nums}p{max-width:900px}</style><h1>单 Agent 与 MoA+ 对照评测</h1><p>已采集 ${rows.length}/${manifest.runs.length} 次，${arms.length} 组。${escape(manifest.model.provider)}/${escape(manifest.model.model)} · ${escape(manifest.model.reasoningEffort)}。</p><p>${escape(comparisonText)}</p><p>MoA效果仅比较同一压缩设置，压缩效果单独配对，不跨设置归因。产物分与预算内正常结束分别统计，候选文本不证明完成，旧结果未采集时为未知。总token包含缓存读取，是累计流量，不是新增推理量或折算费用；usage不完整时分桶合计也只是已记录下限。摘要请求和失败用量包含在原预算，压缩成功依原生end而非任务完成判定。预算终止不代表程序崩溃或更快交付。</p>${usageTable}${compactionTable}${table}<p>完整口径、分项统计与限制见同目录 report.md；原始证据见 runs/。</p></html>`);
  return report;
}
