![MoA+ — Intelligence, multiplied. Coordinator 连接四个 Worker，通过直接通信与共享上下文协作。](docs/media/moa-plus-banner.png)

# MoA+

**强大的多智能体架构，让智能更进一步。**

先看一个真实任务：两个 Worker 一起完成 CLI，直接交换消息，再把用户对子会话的补充要求同步回 Coordinator。

[![MoA+：字标切换与真实协作任务](docs/media/moa-plus-workflow.gif)](docs/media/moa-plus-workflow.mp4)

[观看 MP4](docs/media/moa-plus-workflow.mp4) · [复现这个任务](docs/demo-moa-plus.md)。使用最新插件界面重新录制，回看已完成的真实协作任务。[录制说明](docs/demo-moa-plus.md#what-the-walkthrough-shows)。

MoA+ 是 DeepSeek Harness 的 **Mixture of Agents 多智能体协作插件**。它通过独立上下文、直接通信与共享知识，连接能够持续工作的 Agent，目标是通过协作提升整个系统解决复杂问题的能力。

Coordinator 把握目标与全局方向；Workers 在各自的会话中调查、构建、质疑和审阅，并在下一次分工到来时继续工作。团队可以探索不同思路、并行推进任务，把已有发现用于后续工作。

[English](README.md) | 简体中文

[快速开始](#快速开始) · [协作如何运作](#协作如何运作) · [观看演示](#在原生对话中协作) · [文档][roles]

## 快速开始

MoA+ **v0.2.4** 支持经过审查的 **DSH 0.2.1-rc.3** 与
**DSH 0.2.2-rc.1 / DSH Next 2.0.22-next** 兼容配置。rc.3 清单扩展了
**22 个原生包、50 个文件路径**。插件与对应兼容配置必须来自同一版本，
原版或其他版本准备的运行时不能替代。桌面准备步骤和精确支持范围见
[原生兼容配置](docs/native-compatibility.md)。

需要 **Node 24.9+**、npm 和 Git。下方独立 Web 启动器准备锁定的 rc.3 运行时；Desktop Next 使用单独的对应兼容配置。

更新后的 rc.2 Desktop Next 配置支持 Windows 受保护 Worker 使用原生非持久 PowerShell，以及已安装的 Bash。Coordinator 原子更新现有记录时，保护持续生效，进程必须由原生 Windows Job 管理。持久终端和未适配生命周期的进程提供者仍拒绝受保护调用。rc.3 配置仍需 macOS Seatbelt 或 Linux bubblewrap，尚未加入这项 Windows 扩展。支持的策略与文件范围见[后端要求][compatibility]。

下方命令使用 v0.2.4 checkout。跟进开发版本时，将克隆分支改为 `main`。

克隆项目，准备独立的 Web 运行环境：

```sh
git clone --branch v0.2.4 --single-branch https://github.com/Burns1028/moa-plus.git
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

### 自适应协调与可选编排

自适应指引保留简单任务直接完成的方式。需要分工时，Coordinator 优先用 `SendMessage` 复用合适的 Worker；新分支需要已有历史时用 `Fork`；需要干净上下文时用 `Task`。它在原生容量内并行派发已就绪的独立分支，结果到达后继续解锁后续工作，需要等待时使用原生 `QueryAgent` 等待。没有明确行动目标或未完成的具体工作时，简短回应或普通聊天澄清本身就是完整答复，不需要仪式化调用工具、更新记忆或阻塞等待提问。

已启用 MoA+ 的 Coordinator 还提供五个内置 `@` 提示：**并行攻坚**用于独立切片，**多方会审**用于争议决策，**协同探索**用于交织探索，**迭代精修**用于制品迭代审阅，**统筹推进**用于多阶段协作。输入 `@` 后，点击中文候选项或按 Enter、Tab 选择。提示会展开为可编辑的输入框文本，补充任务后照常发送。Worker 和普通会话不提供这些提示。

这些本地提示文本沿用现有工具与角色预设。原生发送、文件引用、上传、queue 和 steer 保持原有行为。模式边界与用法见[编排指南][orchestration]。

### 共享知识，独立审阅

Coordinator 维护 `notes.md` 和 `archived.md`，Host 在它每次推理前完整刷新 notes。Coordinator 与 Workers 通过 `context/index.md` 共同积累可复用发现，再按需读取相关文件。隔离 Worker 也能访问同一份共享知识，让后续工作沿用已经确认的发现，执行细节则留在各自的上下文中。

Rubric Builder 根据原始需求与规格制定验收标准；Outcome Verifier 使用原生工具检查实际产物，结果不完整或证据缺失时，将具体问题交回继续处理。完整契约见[角色与常见流程][roles]、[代码架构][architecture]和[工具 API][tools]。

## 在原生对话中协作

首条消息前，点击小巧的 **MoA+ 字标**选择模式：灰色为关闭，绿色为开启。MoA+ 会话开始后，字标保留为固定身份标识。控件适配深浅主题，鼠标悬停时也保持透明背景。

MoA+ 沿用 DSH 原生界面。**胶囊就是子会话**：点击进入 Worker，也可以在原生左侧列表的 Coordinator 下找到同一个 Worker。用户可以直接给它下达指令，通过 Back 回到 Coordinator。胶囊保留在 Worker 参与工作的 turn 或消息段中。

Agent 沟通使用紧凑卡片，标明发送者、消息类型和简短预览；展开后查看完整 Markdown，思考内容单独折叠。执行期间展示协作过程，回答完成后自动收起，让最终回答保持清晰。可关闭的 Workers 与 notes.md 标签页展示输入、最终回复、产物和当前工作记录。团队工作期间，新的用户输入仍能及时接入。

页首演示先展示字标的开关状态和主题适配，再打开保留的 Note Bundle 任务，查看胶囊、Worker 会话、Agent 原始来信、Workers 时间线、notes 和结果。在这次真实执行中，Exporter 实现标题排序，Docs 编写指南；用户直接给 Docs 补充要求，Coordinator 查看 Worker 记录后核对最终结果。这次录制回看已有执行，没有新跑模型任务。可以查看[任务与实际检查](docs/demo-moa-plus.md)或[运行时验证记录][verification]。早期 Project Mode 视频保留在 [v0.1.23 演示归档](docs/demo-workflow.md)中。

## 文档与参与

- [角色、生命周期与常见流程][roles]
- [自适应协调与可选 `@` 编排][orchestration]
- [代码架构][architecture]与[工具 API][tools]
- [首次运行指南][quickstart]与[兼容及回滚说明][compatibility]
- [验证记录][verification]
- [构建、测试与贡献指南][contributing]
- [反馈试用或安装问题](https://github.com/Burns1028/moa-plus/issues/new?template=project-mode-trial.yml)

MoA+ 是非官方 DSH 插件。包名 `dsh-plugin-project-mode` 与已保存的协议标识继续兼容已有数据。

MIT。见 [LICENSE](LICENSE) 与[第三方声明](THIRD_PARTY_NOTICES.md)。

[roles]: https://github.com/Burns1028/moa-plus/blob/main/docs/moa-architecture.md
[orchestration]: docs/orchestration.md
[architecture]: https://github.com/Burns1028/moa-plus/blob/main/docs/architecture.md
[tools]: https://github.com/Burns1028/moa-plus/blob/main/docs/tool-api.md
[verification]: https://github.com/Burns1028/moa-plus/blob/main/docs/verification.md
[compatibility]: https://github.com/Burns1028/moa-plus/blob/main/docs/compatibility.md
[quickstart]: https://github.com/Burns1028/moa-plus/blob/main/docs/quickstart.md
[contributing]: https://github.com/Burns1028/moa-plus/blob/main/CONTRIBUTING.md
