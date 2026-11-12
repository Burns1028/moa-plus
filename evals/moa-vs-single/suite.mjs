import { codeCases } from './cases-code.mjs';
import { analysisCases } from './cases-analysis.mjs';

const simpleCases = [
  {
    id: 'acknowledge', title: '简短确认', category: 'simple', timeoutSeconds: 60,
    prompt: '只回复“收到123”，不要补充其他内容。', files: {},
    async grade({ finalReply }) {
      const passed = finalReply.trim() === '收到123';
      return { score: passed ? 100 : 0, checks: [{ name: 'exact-short-answer', passed }] };
    },
  },
  {
    id: 'arithmetic', title: '简单计算与解释', category: 'simple', timeoutSeconds: 90,
    prompt: '计算 17×19，给出结果，并用17×(20−1)这一拆分方法写一句中文解释。不要写文件，回答不超过100字。', files: {},
    async grade({ finalReply }) {
      const correct = /323/.test(finalReply) && !/(?:结果|等于|=|＝)\s*(?:322|324)\b/.test(finalReply);
      const explanation = /17/.test(finalReply) && /20\s*(?:[−–—-]|减去?)\s*1/.test(finalReply) && /[\u4e00-\u9fff]/.test(finalReply);
      const concise = finalReply.trim().length <= 100;
      const checks = [
        { name: 'correct-result', passed: correct },
        { name: 'explains-calculation', passed: explanation },
        { name: 'length-limit', passed: concise },
      ];
      return { score: (correct ? 60 : 0) + (explanation ? 20 : 0) + (concise ? 20 : 0), checks };
    },
  },
];

export const cases = [...simpleCases, ...codeCases, ...analysisCases];
if (new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('Duplicate evaluation case id');
