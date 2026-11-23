# MoA+：在现有 Project Mode 插件中实现 MOA 架构

状态：用户已确认按整份六章白皮书完整实现。沿用原 Project Mode 代码和 DSH 插件形态；内部依赖顺序不缩减交付范围，不以完成部分能力作为目标完成。

## 1. 目标与实现起点

目标是通过多 Agent 的独立执行、互相通信、共享知识和编排提高整体解决问题的能力。现有 Coordinator/Worker 会话、结果回传和 UI 是演进基础。

本设计基于主分支 `ef640e4`。已有品牌/目录更名仍在独立 PR #2 中，本分支不合并该 PR；后续依据实际主分支路径调整改动位置，保留稳定包标识、传输键与持久化兼容性。

DSH 继续拥有 Agent Loop、模型调用、原生会话历史、工具执行、权限、取消、收件箱与持久化。MoA+ 在这些能力上管理身份、组织关系、消息协议、共享知识和编排。MoA+ 不维护另一套模型执行循环。

当前验证基线仍是仓库锁定的 DSH 0.2.1-rc.3 与三个已审查扩展。较新 DSH 的源码能力可以作为参考，不能直接把它当作已支持运行时。任何新增核心改动先提交契约审阅，随后更新独立兼容清单。

## 2. 现有代码如何继续使用

| 当前模块 | 后续职责 |
| --- | --- |
| `host/index.ts` | 服务装配与原生接入；新能力放入职责明确的组件。 |
| `host/worker-operations.ts` | 保留已有派生、投递、停止、删除与操作回执，作为原生控制适配基础。 |
| `host/completion-outbox.ts` | 保留完整最终 AI 消息、空结果通知、消费回执与恢复去重。 |
| `host/turn-coordination.ts` | 保留原生 turn 收口；加入新等待原因时区分任务完成与控制权交接。 |
| `host/agent-events.ts` | 绑定原生事件，接入等待唤醒、身份和上下文注入。 |
| `host/project-memory.ts` | 保留现有知识文件访问；单独实施新索引与 notes 注入迁移。 |
| `host/state.ts` | 保存插件拥有的关系、请求路由与投递事实，不保存另一套原生执行状态。 |
| `client/*`、`shared/index.ts` | 沿用侧栏子会话、胶囊、时间轴、文件面板和原生 Remote，按已定义的契约扩展。 |

既有行为继续作为回归基线：主 Agent 工具替换、永久会话模式、用户直接操作 Worker、消息及时处理、严格收口、胶囊按 turn/消息段归属、删除隐藏与整组归档。

## 3. 模块边界

新增模块集中在当前 `host/moa/`，原 Host 继续负责装配，原生版本边界仍在 `host/native.ts`：

```text
host/moa/
  agents.ts             身份、所属关系、五态视图和原生控制适配
  tools.ts              五个控制通信原语与 ProjectContext
  roles.ts              角色执行工具与下级派生开关
  messages.ts           SendMessage 投递、显式 ReplyTo 与唤醒路由
  request-waits.ts      工具内 await、超时、来信中断与 Wait Cycle
  message-state.ts      请求路由和投递状态的持久化 schema
  memory.ts             notes 注入、软预算提醒与共享知识路径
  workspaces.ts         Isolated / Shared 与资源保留和清理
  background.ts         慢工具策略、原生后台控制与结果回流
  completion.ts         完成承诺与正常出口门禁
  verification.ts       独立出卷与实测判卷
```

这些组件调用原生适配层和已有存储。只有同步等待需要的 Promise/订阅存在于进程内；请求标识与迟到回复路由需要持久化。Promise 不被当作可恢复的工作记录。

## 4. 身份、控制与状态契约

### 4.1 身份与关系

`MoAAgentIdentity` 记录：

- `agentId`：对应原生 Session ID。
- `rootSessionId`：所属 MoA 会话，用于隔离不同组织的消息和控制。
- `parentSessionId`：真实创建关系。
- `reportTo`：汇报对象，与父关系分别保存。
- `role`：Orchestrator、Specialist 或 Worker。
- `workspace`：目录与 Isolated/Shared 模式。
- `allowNestedSpawn`：默认 false。

Task 的身份声明加入新历史首部；Fork 的身份声明加入继承历史尾部。同类型 System Prompt 保持一致，角色工具与权限独立装配。Fork 的来源、创建者和汇报对象分别记录，不能从继承历史中猜测当前身份。

### 4.2 五个控制与通信原语

最终模型工具集合为 Task、Fork、SendMessage、QueryAgent、KillAgent。Worker 默认拥有 SendMessage、ProjectContext 和角色执行工具；QueryAgent 属于父 Agent 管理下级的能力，下级派生默认关闭。

旧 control_workers 的后台接口可保留兼容；对模型的切换按完整能力集进行，避免同时暴露多套派生入口或未实现的工具。普通会话继续使用原生工具组合。

Task 单次最多并发创建 20 个。这个批次限制与原生 Activation 的容量限制分别处理，不修改所有普通会话的全局配置。

Fork 使用明确的来源与快照边界。原生默认 Fork provider 只复制父会话已经完成的 turns；完整前缀复制和中断尾部修复可复用 Session 的相关能力，但要补齐来源选择、真实父关系和新身份装配。

拟定入口为 `forkAgent(creator, { sourceSessionId, throughSeq?, task, workspace }, signal)`。省略 throughSeq 时，冻结来源会话当时已经提交的最后事件位置，复制截至该位置的完整历史；尚未提交的流式输出不属于快照。开放的工具尾部用原生修复能力补齐，随后加入新身份与新任务。来源 Agent 继续原运行，创建者保留真实父关系。

### 4.3 五态是原生执行事实的派生

| MOA 状态 | 事实来源 |
| --- | --- |
| Idle | 新建、尚未首次运行。 |
| Running | 原生执行正在推进，包含 Request 工具内部 await。 |
| Waiting | 显式 QueryAgent 等待或人工确认。 |
| Aborting | 已取消但旧执行尚未完成清理。 |
| Zombie | 当前执行停止，历史和工作区保留，可以再次唤醒。 |

原生 busy/idle、会话是否驻留和业务任务是否完成继续分别表达。不能因为 Agent 不在内存里就把它判成不可用，也不能靠修改插件枚举代替真正停止原生执行。

## 5. SendMessage 与 Request 的具体契约

### 5.1 输入、标识与结果

`MoAMessageEnvelope` 至少包含 `id`、`rootSessionId`、`fromAgentId`、`toAgentId`、`mode`、`content` 和创建时间。Request 另有 `requestId`、超时；回复使用显式 `replyTo`。

Request ID 关联提问和答复；原生 Message ID 标识投递；Tool Call ID 关联模型工具调用与结果。恢复时分别使用各自的身份，不靠相似文本去重。

`SendMessage` 的 Request 返回三类正常结果：

- `answered`：含 requestId 与完整答复。
- `interrupted`：明确原答复尚未到达、需要先处理来信，原路由继续保留。
- `timeout`：说明本次等待结束，迟到答复仍可入箱。

工具取消走原生 AbortSignal，不包装成成功答复。没有 ReplyTo 的 Notify 按普通消息处理，不根据发送者自动匹配。

### 5.2 请求等待与回复投递

1. 从真实执行 Agent 确定消息来源与所属 MoA 会话。
2. 先记录请求标识与目标路由，再通过原生路径投递问题。
3. 在 SendMessage 工具函数中等待。Agent 保持 Running，工具结果返回前不能调用下一次模型。
4. ReplyTo 命中有效等待时，完成该 Promise，让原工具调用自然返回结果；不手工追加另一条 tool/result。
5. 等待因超时或来信结束后，保留路由。后续回复通过原生普通消息路径投递，必要时唤醒接收者。

请求投递、匹配回复与结束等待需要正确同步。一条回复只能选择仍有效的工具返回路径或迟到入箱路径，不得两边同时送达。

### 5.3 来信中断与批量消费

等待同时观察自身收件箱。需要优先处理的来信使 Request 返回 interrupted；它不结束整个 Agent turn，也不取消接收方的工作。

保留白皮书的优先来信判定：用户明确发送给当前执行的 next-step 输入可以交回控制权；其他 Agent 的普通 Notify 交给 `shouldInterruptRequest(activeRequest, unreadMessages, signal)` 判定。轻量裁判使用已配置模型路由，关闭思考，读取原问题、当前等待对象与全部未读来信，只回答能否继续等待。需要先回复、决策或调整指令时返回 true；普通进度知会可以返回 false。不使用任务关键词规则，也不把所有 Notify 一律当作紧急消息。

新增来信触发增量重审，先前 false 不消费消息。判定执行期间若原答复已经到达，以正常答复完成工具；若判定失败，提前交回执行 Agent，由它读取来信并判断，不伪造原答复。显式 next-turn 排队输入不打断当前 Request。

Request 返回后，由原生下一步接入全部当前待处理的 next-step 来信。显式 queue 仍保留其下一 turn 语义，Batch Drain 不擅自把用户排队输入转换成插话。

### 5.4 亲属关系之外的通信

现有原生模型消息主要提供直接父子通信。MoA+ 的 Broker 对同一 MoA 会话内、已知 ID 的同伴消息负责路由，沿用原生收件箱和真实来源归因。

适配入口为 `deliverMoAMessage(actor, envelope, signal)`：actor 必须是真实调用 Agent；由已有记录确定所属会话，核对接收方仍为该会话的成员。在线目标通过原生 Agent 收件箱接入。冷 Worker 通过真实父 Agent 持有的原生子会话管理权限恢复与投递，消息来源仍记录 actor；父关系的控制权限与消息作者身份分别处理。主会话使用已有根会话恢复路径。不能把同一子会话另行恢复成根会话。

这一路由方案属于可信 Host 插件的会话内通信能力，不扩大模型可控制的其他会话范围。实现前的原生集成探针必须证明热会话、冷会话、权限继承与真实来源均符合这份契约；如果公开入口不足，停在适配边界补交原生契约，不用伪造调用身份或绕过准入替代。

### 5.5 活动等待与恢复

`RequestRoute` 保存 requestId、发送方、接收方、所属会话与结果投递事实。`ActiveRequestWait` 仅保存本进程的等待句柄、截止时间、取消和来信订阅。

等待图按活动 Request 维护，多条并行 Request 分别记录。新增边形成环时，该次 Request 降级为 Notify，并返回明确说明。答复、超时、来信中断和取消都释放活动等待关系。

重启无法恢复原 JavaScript await。恢复先核对原生工具历史与请求记录，保留迟到回复的入箱路由，使用原生中断历史修复，不伪造一次已经获得的回答。删除成员后不继续唤醒它；归档与停止仍尊重原生准入。

## 6. turn 交接与任务完成

当前 CompletionOutbox 按原生 Worker turn/end 生成带完整最后 AI 消息的回传。这条现有契约继续保留，空 AI 消息也有通知。

新增慢工具来信转后台时，旧 turn 的结束属于控制权交接，不能直接当作最终任务交付。接入该机制前需要为交接定义明确的原生结束原因或等价事实：

- 旧 turn 的历史与 Tool Message 仍然完整。
- 新来信启动新 turn。
- 交接不触发任务已完成的判断或冻结最终完成状态。
- 后续真实结束仍回传该轮最后完整 AI 消息，保留既有去重。

拟定原生契约是 `requestTurnHandoff(agent, { cause: "background-message", toolCallIds, triggeringMessageIds })`：只有本批前台工具结果完整时才能提交交接，原生 turn/end 需要明确标识 handoff，随后由已接收来信开启新 turn。接口名称与事件形状先独立审查，再在本目标内实施并更新兼容清单。

Request 的来信中断不使用慢工具转后台路径，提前返回后继续当前 turn。

## 7. 记忆、工作区与 UI 的演进

现有 context/context.md 保持可读。迁移到 context/index.md 作为独立变更，先处理新旧索引共存和路径兼容，不能直接改文件名导致旧知识不可查。

notes.md 和 archived.md 由 Orchestrator 维护；共享 Context 双方维护。notes 每次模型思考前完整注入、超过 8K 字符提醒整理，由明确的记忆组件实现，不通过剪裁历史或截断正文实现预算。

代码 Worktree 隔离与共享知识空间分别管理。Isolated 的代码目录可以各自分支，但 Agent 应通过 MoA 的共享知识定位读取共同 Context。销毁时只清理该 Agent 拥有的独立 Worktree，Zombie 保留。

UI 沿用现有布局。新的等待信息接入原状态展示，不重做侧栏、输入框或文件预览。被动读状态不产生胶囊；人工操作 Worker 后的状态同步和每轮结果回传继续分别工作。

## 8. 完整目标的内部执行依赖

| 内部依赖 | 内容 | 验收 |
| --- | --- | --- |
| A：角色和运行契约 | 身份与归属、五态映射、Task/Fork 快照边界、工具装配和原生接口缺口 | 验证创建、继承身份、原生取消与现有 UI；每个新增核心接口单独审阅。 |
| B：通信闭环 | Notify/Request/ReplyTo、同伴路由、可中断等待、超时与迟到回复、等待环 | 用真实任务完成中途请示、优先消息处理与结果回传。 |
| C：记忆与工作区 | Isolated/Shared、知识共享定位、notes 注入与索引兼容 | 独立目录改动不覆盖，共享知识可找到，旧记录继续读取。 |
| D：执行过程控制 | 慢工具三策略、并行批次、硬打断后继续、交接原因 | 在真实耗时工具与取消时序中验证 turn、工具消息和回流。 |
| E：编排与交付门禁 | 独立探索/评审、分歧综合、Ralph 与 Outcome Verify | 对照单 Agent 结果，记录质量、成功率、耗时、token 与人工介入。 |

按可独立审阅的行为提交代码与 PR，持续执行直到全部能力和验收完成。A—E 是内部依赖，不是可缩减的交付范围；全部十项执行任务见 [完整实现计划](../plans/2026-11-08-moa-whitepaper.md)。

## 9. 通信实机验收（完整验收的一部分）

用隔离 DSH 运行时中的新会话执行一个代码或调研任务，保留对话、trajectory 和实际产物作为本地证据：

1. 主 Agent 派发工作，Worker 中途 Request，请求尚未回答时保持 Running，无任务完成通知。
2. 原答复正常到达，作为原工具结果返回，继续当前 turn。
3. 等待期间有另一条需要优先处理的消息，工具提前返回，模型在下一次思考看到当前全部来信。
4. 原答复随后到达，只通过普通收件箱处理一次；超时路径也保留这一结果。
5. 用户直接进入 Worker 操作，回到主会话后能够获取新状态和必要历史。
6. Worker 结束后完整最后 AI 消息回传；没有 AI 消息时返回空，不拿上一轮替代。恢复后不重复送达。
7. 主 Agent 收口、原生 Stop、胶囊归属和工具替换符合既有契约。

自动验证覆盖请求竞争、重复回复、取消、等待环、重启路由与跨会话隔离。真实模型验收另行记录，不用脚本模型代替自然任务结果。

## 10. 全目标的实施边界

部署形态、现有代码复用与六章完整实现均已由用户确认。Request 等待可被当前执行的用户输入或经判定不能等的 Agent 来信中断，显式 queue 保持下一 turn；Broker 用真实成员身份和原生路径路由；Fork 复制明确事件水位以内的完整已提交历史；转后台换 turn 的核心接口先独立审查再实施。

这些选择不改变白皮书已经确认的 Request/Notify、Running、五态、共享记忆或六条控制流目标。原生适配探针发现的接口缺口通过明确契约、独立审查和新增兼容清单落实；不静默扩大旧补丁范围。

本分支持续开发完整实现。文档、单个组件或单次测试均不代表目标完成；只有全白皮书要求、回归、真实模型与 DSH 界面验收完成后才收口。

## 11. 对照依据

- [现有实现架构](../../architecture.md)、[当前工具契约](../../tool-api.md)、[兼容扩展范围](../../compatibility.md)。
- [DSH 原生子会话契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/subagent/subagent/README.md)：对照持久会话、父子消息与恢复能力，不构成本插件已支持 rc.1 的声明。
- [DSH 默认 Fork 的历史边界](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/subagent/subagent-fork-in-process/README.md)。
- [DSH Session Fork 与工具历史修复](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/core/session/README.md)。
