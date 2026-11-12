import { expect, it } from "vitest";
import { orchestrationPacks } from "../../packages/project-mode/src/shared/orchestration.ts";

it("保留五个内部标识，并以中文名称、说明和提示展开原生输入", () => {
  expect(Object.keys(orchestrationPacks)).toEqual([
    "fan-out",
    "panel-team",
    "blackboard-team",
    "critique-loop",
    "auto-orchestration",
  ]);
  expect(Object.values(orchestrationPacks).map(pack => pack.title)).toEqual([
    "并行攻坚", "多方会审", "协同探索", "迭代精修", "统筹推进",
  ]);
  for (const pack of Object.values(orchestrationPacks)) {
    expect(Object.keys(pack).sort()).toEqual([
      "description",
      "prompt",
      "title",
    ]);
    expect(pack.title.trim()).not.toBe("");
    expect(pack.description.trim()).not.toBe("");
    expect(pack.description).not.toContain("\n");
    expect(pack.prompt).toContain(`# MoA+ 协作方案：${pack.title}`);
    for (const visible of [pack.title, pack.description, pack.prompt]) {
      expect(visible).toMatch(/[\u4e00-\u9fff]/);
      expect(visible).not.toMatch(
        /fan[\s-]?out|panel[\s-]?team|blackboard[\s-]?team|critique[\s-]?loop|auto[\s-]?orchestration/i,
      );
    }
    expect(pack.prompt).toContain("timeout_ms");
    expect(pack.prompt).not.toMatch(
      /wait_timeout|moa_dispatch\.prompt|\/home\/tiger|~\/\.maso|\/cowork\/api|O48|GPT5\.6/,
    );
  }
});

it("并行攻坚要求真正独立且完整的分工，并在交付前盲验", () => {
  const { prompt } = orchestrationPacks["fan-out"];
  expect(prompt).toMatch(/不要强行把紧密耦合的工作/);
  expect(prompt).toMatch(/互不重叠.*完整任务/);
  expect(prompt).toMatch(/不与其他执行者相互协调/);
  expect(prompt).toMatch(/全新的 moa_dispatch 创建独立验收者/);
  expect(prompt).toMatch(/不提供你的推理或预期答案/);
  expect(prompt).toMatch(/原执行者.*改进同一部分/);
});

it("多方会审保持视角独立，并区分汇报关系和子成员管理权限", () => {
  const { prompt } = orchestrationPacks["panel-team"];
  expect(prompt.indexOf("先用 moa_dispatch 创建会审主持人")).toBeLessThan(
    prompt.indexOf("然后批量创建评议者"),
  );
  expect(prompt).toMatch(/reportTo 设为这个已存在的主持人 ID/);
  expect(prompt).toMatch(/从自己的视角审视整个决策，不能一人只评一个候选方案/);
  expect(prompt).toMatch(/不得相互沟通/);
  expect(prompt).toMatch(/反驳自身判断的最有力论点/);
  expect(prompt).toMatch(/不会让主持人获得管理同级评议者的权限/);
  expect(prompt).toMatch(/信息缺失或信息不对称/);
  expect(prompt).toMatch(/真实的价值冲突时，明确保留/);
});

it("协同探索各区域只有一名写入者，专家自主改变路线", () => {
  const { prompt } = orchestrationPacks["blackboard-team"];
  expect(prompt.indexOf("先用 moa_dispatch 创建记录员")).toBeLessThan(
    prompt.indexOf("然后批量创建"),
  );
  expect(prompt).toMatch(/charter\.md：由你一次性写入/);
  expect(prompt).toMatch(/findings\/<peer>\/：仅由对应专家写入/);
  expect(prompt).toMatch(/board\.md：仅由记录员写入/);
  expect(prompt).toMatch(/放弃停滞路线是一项义务/);
  expect(prompt).toMatch(/不得向其他专家发送消息/);
  expect(prompt).toMatch(/不是原子锁/);
  expect(prompt).toMatch(/不得分派工作、选择专家的方向/);
  expect(prompt).toMatch(/不要假定未配置的定时器/);
  expect(prompt).toMatch(/建立团队不等于完成任务/);
});

it("迭代精修复用创作者，每轮新建未受暗示的评审者且轮数有限", () => {
  const { prompt } = orchestrationPacks["critique-loop"];
  expect(prompt).toMatch(/绝不为适应.*而降低标准/);
  expect(prompt).toMatch(/全新的 moa_dispatch 创建，不得使用 moa_branch，也不得复用上一轮评审者/);
  expect(prompt).toMatch(
    /只向评审者提供完整产物和固定验收标准/,
  );
  expect(prompt).toMatch(/不提供创作者的推理/);
  expect(prompt).toMatch(/将问题清单原文传给同一名创作者/);
  expect(prompt).toMatch(/本方案最多进行 3 轮评审/);
  expect(prompt).toMatch(
    /第 3 轮仍未通过时.*如实报告未解决的问题/,
  );
});

it("统筹推进可选择简单阶段，并依据证据及时调整计划", () => {
  const { prompt } = orchestrationPacks["auto-orchestration"];
  expect(prompt).toMatch(/简单阶段只安排一名执行者/);
  expect(prompt).toMatch(/目标、协作形式和完成标准/);
  expect(prompt).toMatch(/不改变其他任务中的默认协调者策略/);
  expect(prompt).toMatch(/立即调整后续阶段/);
  expect(prompt).toMatch(/用户最初目标/);
});

it("保留轮次结束时的自动汇报，不重复发送完整结果通知", () => {
  for (const { prompt } of Object.values(orchestrationPacks)) {
    expect(prompt).toMatch(/自动/);
    expect(prompt).toMatch(/无须再请求|不要再/);
  }
});
