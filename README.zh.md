# MoA+

**通过多智能体协作，让智能更进一步。** MoA+ 希望构建一个真正的多智能体系统（Mixture of Agents）：让持久化 Agent 共享知识、交换消息、尝试不同方向，并共同审阅结果。

[English](README.md) | 简体中文

[![v0.1.23 真实任务：两个 Worker、共享记录和通过的九项测试](docs/media/workflow-result.png)](docs/media/project-workflow.mp4)

[观看协作演示](docs/media/project-workflow.mp4) · [代码架构](docs/architecture.md) · [工具 API](docs/tool-api.md) · [安装使用](#快速开始)

**本分支包含尚未发布的 MoA 运行时改造。** 在已发布的 v0.1.23 预览版之上，加入五个 Agent 原语、隔离工作区、请求与回复、后台工具和完成门禁。集成与真实模型／界面验收仍在进行，[验证记录](docs/verification.md)区分了本分支与历史版本的证据。现有包版本号不代表新版本已经发布。

目标运行时是 DSH **0.2.1-rc.3 及显式兼容扩展**，原版 rc.3 无法直接启用。本分支的兼容清单覆盖 13 个原生包；v0.1.23 使用的是此前的三个扩展。混用前请先读[兼容说明](docs/compatibility.md)。

## 持续工作的协作团队

Coordinator 负责目标、方向、工作记录、结果审阅和最终交付。Workers 在任务之间保留会话与工作目录。双方运行同一套 DSH 原生 Agent Loop，通过身份、工具集合和继承权限形成分工。

| 能力 | 带来的帮助 |
| --- | --- |
| `Task` 与 `Fork` | 冷启动专家，或从选定 Agent 已提交的历史中派生新分支。 |
| `SendMessage` | 通知同伴、引导当前工作、排队追加指令，或在工具调用中等待明确答复。 |
| `QueryAgent` 与 `KillAgent` | 查看状态与历史、可中断地等待、停止并等待当前执行退出，或显式删除 Worker。 |
| 隔离与共享工作区 | 默认把源目录的当前 Git 状态快照到专属 worktree，需要时显式选择共享目录。 |
| 共享知识 | 先读索引、按需加载，把确认过的可复用知识带到后续任务。 |
| 后台执行 | 慢工具继续运行时处理新输入；查询、取消，并接回真实结果。 |
| 完成审阅 | 绑定完整完成承诺，由独立 Agent 从原始需求出卷、调用工具验证结果。 |
| 用户直接参与 | 进入 Worker 下达指令，再返回能检查变化的 Coordinator。 |

Coordinator 保留普通执行工具，自行判断如何分工；不通过任务关键词或命令次数强制派活。MoA 控制工具替换参与会话中的其他原生派生方式。Worker 默认不能继续派生下级，只有明确启用嵌套协作后才开放。普通 DSH 对话保持原生工具组合。

## 实际效果

[![v0.1.23 的派发、人工介入、结果审阅与上下文复用](docs/media/project-workflow.gif)](docs/media/project-workflow.mp4)

这段**已发布 v0.1.23** 的录屏展示真实 CLI 任务：Exporter 实现标题排序；用户直接进入它的会话修改排序；Docs 对齐文档；Coordinator 审阅结果。下一轮继续复用原 Workers 和已经接受的约定。[实际产物](docs/demo-result)通过了九项测试。

这是剪去等待并标注的 60 秒片段，不是完成时间基准，也不代表新运行时的所有机制已经验收。可以[复现任务](docs/demo-workflow.md)，或查看[录制说明](docs/media/README.md)。

| Worker 工作轴 | 项目记录 |
| --- | --- |
| ![原始输入、最终 AI 回复与产物](docs/media/worker-timeline.png) | ![原生会话旁的 notes.md](docs/media/project-notes.png) |

细节截图来自 v0.1.22 的虚构 Project Atlas 工作区，保留原有 **Project** 标识；当前界面使用 **MoA+**。

## 快速开始

试用**已发布的 v0.1.23 预览版**，需要 Node **24.9+**、npm 和 Git：

```sh
git clone --branch v0.1.23 https://github.com/Burns1028/moa-plus.git
cd moa-plus
node scripts/project-mode.mjs setup
node scripts/project-mode.mjs start
```

这个 tag 安装的是旧预览版及三个兼容扩展，不包含本分支的新运行时；该版本在第一条消息前勾选 **Project**。

测试**本分支**时，从对应分支／PR 的源码检出开始，使用同一检出的锁文件、清单和启动脚本，准备全新的独立目录：

```sh
npm ci
node scripts/apply-native-compat.mjs --dry-run
node scripts/apply-native-compat.mjs --backup "$PWD/.superpowers/native-backup"
npm run build
node scripts/project-mode.mjs setup --dir /absolute/empty-moa-runtime
node scripts/project-mode.mjs start --dir /absolute/empty-moa-runtime
```

新会话发送首条消息前勾选 **MoA+**，启动后身份固定。隔离 Worker 需要 Git 工作区；需要直接操作父目录时，在任务中显式选择 `shared`。

启动脚本准备独立的原生 Web 运行时、home、Agent 配置和文档目录。模型使用原生设置配置，不复用个人 DSH profile，也不改动已安装的 Desktop 应用。使用相同 `--dir` 运行 `doctor` 检查环境。详见[首次运行指南](docs/quickstart.md)。

## 常见工作流程

1. 用户给出目标。Coordinator 检查 Workers，读取工作记录及相关上下文。
2. 用 `Task` 创建专家，用 `Fork` 继承有用历史，或通过 `SendMessage` 延续已有 Worker。
3. 更新 `notes.md`；工作进行中及时处理用户输入、调整方向。Request 在当前 Tool Call 内等待回答，Notify 在消息接受后返回。
4. Worker 一轮真正结束后，把**本轮最后一条完整 AI 消息**自动回传给 `reportTo`，默认是创建者。没有 AI 消息就返回空，不拿旧回复替代；转后台交接不算完成。
5. Coordinator 审阅证据与产物，补齐缺口、整理知识并交付。正常收口等待相关工作和结果处理完成；新消息与原生 Stop 仍可及时生效。

`QueryAgent` 按明确的下标和长度读取最近的人类／AI 消息，不默认加载最近 100 条。用户直接操作 Worker 后，Coordinator 可以检查其状态和输入；不另设人工已读或确认协议。

## 项目记忆

新工作区默认使用：

```text
workspace/
├── notes.md                 Coordinator：阶段、待办、分工、进度、阻塞
├── archived.md              Coordinator：已完成或告一段落的工作及结果
├── rubrics.md               独立生成的验收标准
└── context/
    ├── index.md             共同维护：文件路径和简短介绍
    └── ...                  可复用的事实、决策和方法
```

Host 在 Coordinator **每次推理前完整注入 `notes.md`**。超过 8,000 字符时追加整理提醒，不截断，也不代替 Coordinator 自动归档。Context 保持渐进加载：先读索引，再按需读文件。Workers 贡献有复用价值的发现；Coordinator 更多负责整理、合并和删除过时内容。隔离 worktree 中的 `ProjectContext` 也能访问真正的共享知识库。

已有记录的路径及旧 `context/context.md` 索引继续兼容。相同工作目录中的会话共享记忆文件；独立项目宜使用独立工作区。

## 原生 DSH 界面

- 在原生侧栏展开 Coordinator，查看带稳定身份图标和当前状态的 Workers。
- 胶囊留在参与工作的 turn／消息段底部。被动回复不移动或复制胶囊，接受的新指令和收到的结果才建立参与关系。
- 右侧默认打开 **Workers** 与 **notes.md**，沿用原生 Tab 切换和关闭方式。工作轴由近到远展示原始输入、最终 AI 输出和记录的产物。
- 输入／输出先显示一至两行文本和省略号，点击文本展开完整 Markdown。
- Worker 输入框提供 **Back**，继承权限且不显示独立权限选择器。删除后从有效列表及所有胶囊中隐藏，原生历史保留；归档跟随管理的会话家族。

## 代码与文档

```text
packages/project-mode/src/
├── host/                    原生装配、持久化投递、结果和 MoA 控制
│   └── moa/                 Agent、角色、通信、工作区、后台工具与完成门禁
├── client/                  原生侧栏、胶囊、控制和 Tab
└── shared/                  传输视图和共同成员规则
compat/rc3/                  经审阅的兼容扩展及精确文件哈希
runtime/rc3/                 独立运行时锁定模板
scripts/                     构建、显式安装及包消费者检查
tests/                       原生夹具、Client 契约和启动器检查
```

为兼容已有安装，历史包名 `dsh-plugin-project-mode`、存储域和 Remote 服务名保持稳定，产品更名不要求迁移历史对话或传输协议。

继续阅读[代码架构](docs/architecture.md)、[目标与角色](docs/moa-architecture.md)、[工具 API](docs/tool-api.md)、[兼容说明](docs/compatibility.md)和[贡献指南](CONTRIBUTING.md)。完整检查命令：

```sh
npm test -- --maxWorkers=1
npm run typecheck
npm run test:native-contract
npm run test:launcher
npm run verify:package
```

模型判断仍会影响分工和验收质量。架构提供独立执行与审阅的能力，不承诺每次任务都能获得理想分工或无误的验收标准。欢迎提交[真实试用与安装反馈](https://github.com/Burns1028/moa-plus/issues/new?template=project-mode-trial.yml)。

MIT。见 [LICENSE](LICENSE) 与[第三方声明](THIRD_PARTY_NOTICES.md)。
