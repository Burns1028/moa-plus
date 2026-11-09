![MoA+ — Intelligence, multiplied. 面向 DeepSeek Harness 的持久化 Agent、直接协作与共享上下文。](docs/media/moa-plus-banner.png)

# MoA+

**通过 Agent 协作，探索更强的智能。**

MoA+ 是 DeepSeek Harness 的 **Mixture of Agents 多智能体协作插件**。它通过独立上下文、直接通信与共享知识，连接能够持续工作的 Agent，目标是通过协作提升整个系统解决复杂问题的能力。

Coordinator 把握目标与全局方向；Workers 在各自的会话中调查、构建、质疑和审阅，并在下一次分工到来时继续工作。团队可以探索不同思路、并行推进任务，把已有发现用于后续工作。

[English](README.md) | 简体中文

[快速开始](#快速开始) · [协作如何运作](#协作如何运作) · [观看演示](#在原生对话中协作) · [文档][roles]

## 快速开始

需要 **Node 24.9+**、npm 和 Git。`main` 上的运行时需要配套的 **DSH 0.2.1-rc.3 兼容运行时**，其显式清单扩展了 **19 个原生包、43 个文件路径**。原版 rc.3 或其他插件版本准备的运行时不能替代。

Worker 的 Bash 记录保护使用 macOS Seatbelt 或 Linux bubblewrap。Linux、Windows 安装前请查看[后端要求][compatibility]。

克隆项目，准备独立的 Web 运行环境：

```sh
git clone --branch main --single-branch https://github.com/Burns1028/moa-plus.git
cd moa-plus
npm ci
node scripts/apply-native-compat.mjs --dry-run
node scripts/apply-native-compat.mjs --backup "$PWD/.superpowers/native-backup"
npm run build
node scripts/project-mode.mjs setup --dir /absolute/empty-moa-runtime
node scripts/project-mode.mjs start --dir /absolute/empty-moa-runtime
```

兼容命令先备份将要修改的文件，再扩展当前 checkout 的依赖。安装流程准备独立的运行时、home、配置、文档与原生文件备份，保留个人 Desktop 应用与 `~/.dsh` 配置。选择 checkout 之外的空目录，后续命令沿用同一个 `--dir`。

在原生设置中配置模型，创建会话，并在首条消息前选择 **MoA+**；开始后模式身份固定。隔离 Worker 需要 Git 工作区；需要直接操作父目录时选择 `shared`。模型配置、`doctor` 与恢复步骤见[首次运行指南][quickstart]，手动安装与回滚见[兼容说明][compatibility]。

使用此前已发布的 Project Mode，请按 [v0.1.23 安装说明](https://github.com/Burns1028/moa-plus/tree/v0.1.23#quick-start)操作。该 tag 使用 Project 标识和此前的三个兼容扩展。

## 协作如何运作

![Coordinator 统筹持久化 Workers，同伴互发消息并共享索引知识；主、子 Agent 使用同一套 DSH 原生运行时。](docs/media/moa-collaboration.svg)

### 独立执行，直接通信

Coordinator 与 Workers 使用同一套原生 Agent Loop，由身份、工具与继承权限形成不同职责。`Task` 以干净上下文启动专家；`Fork` 派生选定成员已提交的历史。独立 Git worktree 隔离并行修改，也可以显式选择共享工作区，直接在父目录工作。

`SendMessage` 支持通知同伴、引导工作、排队追加指令，或提出需要明确答复的阻塞问题。`QueryAgent` 查看状态与指定范围的历史，或等待进展。`KillAgent` 停止执行，并等待资源退出。慢工具可以转入后台，完成后自动回传结果。

Worker 每轮工作结束时，系统把**本轮最后一条完整 AI 消息**送给指定汇报对象。Coordinator 可以审阅结果、沿用这个 Worker，或调整方向。保留的会话与工作区让团队能够继续下一轮分工。

### 共享知识，独立审阅

Coordinator 维护 `notes.md` 和 `archived.md`，Host 在它每次推理前完整刷新 notes。Coordinator 与 Workers 通过 `context/index.md` 共同积累可复用发现，再按需读取相关文件。隔离 Worker 也能访问同一份共享知识，让后续工作沿用已经确认的发现，执行细节则留在各自的上下文中。

Rubric Builder 根据原始需求与规格制定验收标准；Outcome Verifier 使用原生工具检查实际产物，结果不完整或证据缺失时，将具体问题交回继续处理。完整契约见[角色与常见流程][roles]、[代码架构][architecture]和[工具 API][tools]。

## 在原生对话中协作

MoA+ 沿用 DSH 原生界面。**胶囊就是子会话**：点击进入 Worker，也可以在原生左侧列表的 Coordinator 下找到同一个 Worker。用户可以直接给它下达指令，通过 Back 回到 Coordinator。胶囊保留在 Worker 参与工作的 turn 或消息段中。

Agent 来信标明发送者，从原文预览展开为完整 Markdown。可关闭的 Workers 与 notes.md 标签页展示输入、最终回复、产物和当前工作记录。团队工作期间，新的用户输入仍能及时接入。

[![真实 CLI 任务中的分工、人工介入、结果审阅与上下文复用](docs/media/project-workflow.gif)](docs/media/project-workflow.mp4)

这段录制于 **v0.1.23**、保留 Project 标识的 60 秒剪辑展示了真实 CLI 任务：Exporter 修改标题排序，用户进入它的会话调整约定，Docs 对齐文档，Coordinator 审阅结果。下一次任务继续复用这些 Workers 与已有上下文。剪辑省去等待并加以标注。可以查看[实际产物](docs/demo-result)、[复现演示](docs/demo-workflow.md)，或阅读[当前运行时的验证记录][verification]。

## 文档与参与

- [角色、生命周期与常见流程][roles]
- [代码架构][architecture]与[工具 API][tools]
- [首次运行指南][quickstart]与[兼容及回滚说明][compatibility]
- [验证记录][verification]
- [构建、测试与贡献指南][contributing]
- [反馈试用或安装问题](https://github.com/Burns1028/moa-plus/issues/new?template=project-mode-trial.yml)

MoA+ 是非官方 DSH 插件。包名 `dsh-plugin-project-mode` 与已保存的协议标识继续兼容已有数据。

MIT。见 [LICENSE](LICENSE) 与[第三方声明](THIRD_PARTY_NOTICES.md)。

[roles]: https://github.com/Burns1028/moa-plus/blob/main/docs/moa-architecture.md
[architecture]: https://github.com/Burns1028/moa-plus/blob/main/docs/architecture.md
[tools]: https://github.com/Burns1028/moa-plus/blob/main/docs/tool-api.md
[verification]: https://github.com/Burns1028/moa-plus/blob/main/docs/verification.md
[compatibility]: https://github.com/Burns1028/moa-plus/blob/main/docs/compatibility.md
[quickstart]: https://github.com/Burns1028/moa-plus/blob/main/docs/quickstart.md
[contributing]: https://github.com/Burns1028/moa-plus/blob/main/CONTRIBUTING.md
