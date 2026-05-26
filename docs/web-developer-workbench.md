# Web Developer Workbench V2

> 状态：Web V2 设计基线
> 适用范围：桌面端 Web 工作台、多 workflow 管理、Run Matrix、Focus Drawer、Unified Composer、本地附件、Workflow Lens、Needs-Me Gate Inbox。
> 非适用范围：本方案暂不考虑移动端、手机屏幕或窄屏适配；第一版只面向桌面开发者工作台。
> 目的：统一后续 Web 重构的产品心智、信息架构、视觉方向、交互边界、数据边界和验收标准。

## 1. 核心定位

`coordinator` Web 不是 `workflow` 的遥控器，也不是单个 workflow run 的漂亮 debug 页面。

Web 的长期定位是：

```text
多工程、多任务、多 workflow 的开发者管理台、观察台、恢复台和人工 gate 收件箱。
```

它应该帮助开发者同时管理多个任务，回答：

- 哪些任务仍在运行。
- 哪些任务已经进入真正需要我的 gate。
- 哪些任务失败、stalled 或需要恢复。
- 哪些任务已经 handoff 到 PR/MR、review 或 merge。
- 哪些任务只是 workflow / inner coding agent 内部推进，不需要我介入。
- 我可以从哪里继续给任务补充上下文、图片或文件。

Web 不应该把 workflow 内部所有 `allowedActions` 转成人工按钮。`materialize-change <change-id>`、alignment checks、inspect/resume、实现推进类 action 默认属于 workflow runtime / inner coding agent 的内部推进信息，只能进入 Workflow Lens / Debug Detail，不进入 `Needs me`。

## 2. 设计原则

### 2.1 观察优先

默认界面先展示事实和状态，不急着要求开发者操作。

Coordinator 可以持续 inspect/reconcile，展示 heartbeat、stage、substate、agent activity、handoff 和 recovery observation；但当 inner coding agent 仍在运行时，Web 不因为看到 workflow `allowedActions/actionInputs` 就中断用户。

### 2.2 人工 gate 收敛

只有真正 operator-facing 的事项进入 `Needs me`：

- requirements freeze。
- planning dossier approval。
- review approval。
- human request。
- PR/MR review 或 conflict。
- merge approval。
- Core recovery decision 明确要求 operator attention。
- project/provider 配置阻塞。

operator-facing workflow gate 进入 `Needs me` 后，Web 仍必须展示 Core 提供的 gate evidence。确认按钮不能只依赖 `allowedActions` 或 action classification 启用；如果 Core 判定缺少 coding agent 可见输出，gate card 只能作为 missing-evidence 状态展示，不能让 operator 盲点确认。

### 2.3 内部动作降噪

agent/internal action 默认不在主界面制造待办。

典型内部动作包括：

- `materialize-change <change-id>`。
- `run-alignment-checks`。
- repair/current-change。
- workflow runtime inspect/resume。
- 需要 inner coding agent 基于内部上下文选择参数的推进动作。

这些动作可以在 Workflow Lens 的 debug/detail 区展示名称、参数 hint、当前 stage/substate 和 latest event，但不要求 Web operator 填写参数。

### 2.4 单入口输入

开发者输入不应被拆成很多严格区域。

Web 应提供统一的 `Unified Composer`：

- 未选中 task 时，用于创建新 task。
- 选中 task 且存在 pending human request/operator gate 时，用于回复或确认上下文。
- 选中 task 但无 pending gate 时，用于追加 task note、补充上下文或上传附件。
- 支持文本、图片和文件。

### 2.5 图形和结构优先

主界面尽量用轨道、节点、pin、chip、heartbeat、流动线和断点表达状态。文字只用于必要标签、原因摘要和可点击操作，不放解释性填空内容。

每个展示元素都必须回答一个实际问题：

```text
它是谁？
它在哪个阶段？
它是否还在跑？
它是否需要我？
它的下一步 owner 是谁？
我能否安全继续？
```

### 2.6 桌面优先

本期不做移动端或手机屏幕适配。

实现时只需要保证常见桌面宽度下无重叠、无溢出、状态可读。窄屏可以保持基础可用或提示需要更宽视口，但不作为验收重点。

## 3. 总体信息架构

新 Web 主入口由四个核心区域组成：

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Command Bar                                                                  │
│ Project/Profile/Search                 Queue  Needs me  New task             │
├───────────────────────────────────────────────────────────────┬──────────────┤
│ Run Matrix                                                     │ Focus Drawer │
│                                                               │              │
│ task row: title | outer rail | workflow rail | owner | pin    │ task focus   │
│ task row: title | outer rail | workflow rail | owner | pin    │ gates        │
│ task row: title | outer rail | workflow rail | owner | pin    │ lens         │
│                                                               │ artifacts    │
├───────────────────────────────────────────────────────────────┴──────────────┤
│ Unified Composer                                                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Command Bar

Command Bar 是轻量操作入口，不做大面积导航。

必须包含：

- project filter。
- profile / provider filter。
- task search。
- queue 状态。
- `Needs me` 数量。
- `New task`。
- refresh / run queue 入口。

不应包含：

- 解释性欢迎文案。
- marketing hero。
- 大型统计卡片。
- 和当前操作无关的空白填充。

### 3.2 Run Matrix

Run Matrix 是默认主视图，也是多 workflow 管理的核心。

每个 task 一行，不使用大面积卡片堆叠。行内信息应压缩成可扫描结构：

```text
project / title
outer lifecycle rail
workflow stage rail
stage / substate chip
agent / workflow owner
heartbeat / updated at
needs-me pin
open/focus action
```

外层 lifecycle rail 表达 Coordinator 管理链路：

```text
Task -> Plan -> Workspace -> Workflow -> PR -> Review -> Merge
```

workflow stage rail 表达 workflow 内部位置：

```text
requirements -> planning -> implementation -> review -> handoff
```

stage/substate 必须展示，因为当前 protocol 已能提供这些状态。默认展示方式是短 chip，例如：

```text
implementation / materialize-change
requirements / freeze-requirements
review / collect-evidence
```

如果 protocol 缺失 stage/substate，必须 graceful fallback：

```text
workflow active / stage unknown
```

### 3.3 Focus Drawer

Focus Drawer 是选中 task 后的右侧详情区域。它替代旧的单任务主页面心智，让开发者在多任务列表上下文中查看细节。

Drawer 内包含：

- task title / project / profile。
- 当前 owner/mode。
- workflow run summary。
- agent activity summary。
- operator gate panel。
- workflow gate evidence：coding agent 可见说明、protocol facts、supporting artifact refs 和 missing-evidence warning。
- recent evidence。
- local attachments。
- Workflow Lens / Debug Detail 入口。

Focus Drawer 不默认铺开 raw timeline、完整 transcript、operation ledger 或复杂 JSON。这些内容只通过 Debug Detail 展开。

### 3.4 Unified Composer

Unified Composer 是开发者和 Coordinator 交互的主入口。

输入模型：

```text
text
attachments
selected task context
intent derived by current selection and pending gate
```

行为规则：

| 当前上下文 | Composer 默认语义 |
| --- | --- |
| 无选中 task | 创建新 task |
| 选中 task + pending human request | 回复 human request |
| 选中 task + operator gate | 提交 gate 所需的人类确认或补充说明 |
| 选中 task + 无 pending gate | 追加 task note / follow-up context |
| 选中 task + failed/stalled | 补充恢复说明或触发 operator recovery intent |

Composer 只调用 API/Core runtime，不直接写 DB，不绕过 Core policy gate。

## 4. Needs-Me Gate Inbox

`Needs me` 是人工 gate 收件箱，不是 workflow action queue。

进入 `Needs me` 的条件必须来自 Core 派生或持久化事实：

- pending human request。
- pending merge approval。
- PR/MR review required 或 conflict。
- operator-facing workflow gate。
- project/provider config blocker。
- recovery attention。
- failed / unknown high-risk state。

不得进入 `Needs me` 的条件：

- 仅有 agent/internal `allowedActions`。
- 仅有 `actionInputs` 参数 hint。
- inner coding agent 仍在运行。
- raw provider event 出现某个 token 或自然语言片段。
- stage/substate 表达某个内部阶段，但没有 handoff 或 operator gate。

缺少 gate evidence 的 workflow gate 可以显示为需要关注，但 Web 必须明确说明“缺少 coding agent 可见确认依据”，并禁用 action submit。

`Needs me` item 的最小展示：

```text
kind
task title
project
reason
primary action
secondary inspect/debug action
```

## 5. Workflow Lens

Workflow Lens 是解释 workflow 内部状态的调试/观察层，不是默认操作面板。

它可以展示：

- profile。
- lifecycle。
- stage。
- substate。
- gate。
- progress。
- stage artifacts。
- allowed / denied actions。
- action input hints。
- handoff。
- latest workflow events。

它必须遵守：

- `stage/substate/gate` 只做展示，不驱动 PR readiness、done、merge 或外层 task 状态迁移。
- `allowedActions/actionInputs` 只作为 operator/debug hint，不自动进入 Needs-Me Gate Inbox。
- handoff 才是 Coordinator 消费 workflow 结果的边界。
- 所有 workflow 信息必须来自 workflow protocol status/artifacts/events，不读取 `.workflow` private state。

## 6. Action Classification

当前不修改 `/Users/hetao/Documents/github/workflow`，也不要求 workflow protocol 新增字段。

Coordinator 侧使用保守分类：

| 分类 | 示例 | Web 处理 |
| --- | --- | --- |
| operator-facing | `freeze-requirements`、`approve-planning-dossier`、`approve-review`、merge/approval gate | 进入 Needs-Me Gate Inbox 和 Focus Drawer gate panel |
| agent/internal | `materialize-change`、`run-alignment-checks`、repair/current-change、inspect/resume、实现推进类 action | 只进 Workflow Lens / Debug Detail |
| debug-only | protocol inspect、raw action hint、临时诊断动作 | 只进 Debug Detail |
| unknown | 未分类 action | 保守按 debug-only 处理，不进入 needs-me |

未来如果 workflow protocol 增加 `operatorActions`、`agentActions`、`blocker.owner`、`agent.state`，Web 可以在独立 change 中适配；当前版本不得依赖这些未来字段，也不得因字段缺失退回“所有 allowedActions 都是人工待办”。

## 6.1 Workflow Gate Evidence

Workflow Action Panel 的确认依据由 Coordinator Core 合成，来源分层如下：

| 来源 | 用途 | 是否可作为确认正文 |
| --- | --- | --- |
| SDK inner agent final response / visible assistant message | 说明 coding agent 希望人确认什么 | 是 |
| normalized agent activity | 最近活动摘要、定位证据 | 只做辅助 |
| provider raw events / transcript JSONL | debug artifact | 否 |
| workflow protocol stage/substate/progress/allowedActions | 结构化状态事实 | 否，只做 protocol facts |
| workflow stageArtifacts path | 引用和线索 | 否，不读取正文 |

Web 行为：

- evidence `ready` 且 `canSubmit=true`：展示 primary message、protocol facts、artifact refs，启用确认按钮。
- evidence `partial` 或 `missing`：展示 warning，禁用确认按钮。
- evidence API 查询失败：保持不可提交，不回退为盲确认。

Core 行为：

- 提交 workflow action 时重新 inspect latest status，并重新校验 evidence。
- 没有 inner agent 可见输出时拒绝 operator-facing action。
- 只承认通过 lifecycle event 绑定当前 workflow run、且 event id 晚于最近 `workflow.action` 的 inner final response；空 provider fallback 文案和其他 run 的输出都保持不可提交。
- 不因 evidence ready 让 daemon 自动确认 gate。

## 7. Run Until Blocked

`Run until blocked` 的语义是：

```text
尽量推进 task / queue 到真正停点。
```

它不是：

```text
看到 workflow allowedActions 就停下来让开发者点按钮。
```

允许行为：

- 调用 daemon tick。
- refresh task / summary。
- 只读 inspect workflow / agent / PR/MR 状态。
- 展示每轮推进摘要。
- 在 Core 判断的停点解释原因。
- 在 operator gate 出现但 evidence missing 时停止并解释缺少确认依据。

禁止行为：

- Web 自动执行 workflow action。
- daemon/outer Agent 自动确认 human gate。
- 根据 stage/substate 推导 PR ready。
- 根据 raw provider event 推导 done/merge/handoff。
- 前端直接写 DB。

停止原因必须区分：

| 停止原因 | 展示语义 |
| --- | --- |
| `observing-runtime` | workflow / inner agent 仍在推进，当前不需要 operator |
| `waiting-operator-gate` | 需要 developer 明确确认 |
| `handoff-ready` | 进入 PR/MR、review 或 merge flow |
| `recovery-attention` | Core 判断需要 operator 处理恢复 |
| `terminal` | task 已完成、取消或失败收口 |
| `no-candidate` | 当前没有可安全推进的任务 |
| `max-ticks` | 达到本次 Web 触发的安全上限 |

task-scoped run 的 banner 只能使用当前 task 的结果。global run 可以展示全局 queue 结果，但不得用历史 task 的失败污染当前 focus task 的状态。

## 8. 本地附件

本期需要支持开发者向 task 补充图片和文件，但不修改 workflow protocol。

短期模型：

```text
Web upload
-> API 保存到 Coordinator 管控的 task attachment root
-> DB 记录 attachment metadata
-> task brief / operator summary 暴露 artifact refs
-> workspace 创建或 agent 启动时以受控路径 materialize
-> outer / inner agent 通过受控路径和 refs 读取
```

建议路径语义：

```text
task artifacts:
  attachments/<attachment-id>/<safe-name>

workspace visible path:
  _task/coordinator/attachments/<attachment-id>/<safe-name>
```

必须设计并验证：

- size limit。
- MIME / extension allowlist。
- path containment。
- filename normalization。
- duplicate handling。
- cleanup / retention。
- metadata event。
- agent-visible path 是否存在。

禁止：

- 直接写入 project repo 根目录。
- 读写 `.workflow` private state。
- 让附件路径绕过 artifact root。
- 把大附件内容塞进 Coordinator Surface prompt。
- 让 raw image/file 自动进入 Core 状态判断。

## 9. 视觉方向

主风格采用：

```text
Operational Paper + Instrument Status
```

含义：

- Operational Paper：浅色、纸面感、细线网格、高密度、低噪音、长期使用不疲劳。
- Instrument Status：只吸收运行状态动效语言，例如 flowing rail、heartbeat、amber pin、failure breakpoint。

视觉约束：

- 不做深色监控大屏作为默认主界面。
- 不做 marketing hero。
- 不做大面积装饰插图。
- 不用紫色渐变、orb、bokeh、纯装饰背景。
- 不用层层嵌套 card。
- 不用手机优先布局。
- 不把空区域用说明文案填满。

状态色建议：

| 状态 | 色彩语义 |
| --- | --- |
| running | muted blue / cyan 细线流动 |
| needs me | amber pin |
| failed / blocked | red breakpoint |
| done | green short line / check marker |
| internal/debug | gray chip |
| stale/unknown | neutral dashed marker |

动效约束：

- 动效只表达真实状态。
- running 才有流动线。
- active agent 才有 heartbeat。
- operator gate 才有 amber pin。
- failed/stalled 才有红色断点。
- 尊重 `prefers-reduced-motion`。
- 无状态变化时保持静态。

## 10. 组件拆分建议

前端实现可以围绕以下组件拆分：

```text
WorkbenchShell
CommandBar
RunMatrix
RunMatrixRow
OuterLifecycleRail
WorkflowStageRail
StatusPin
FocusDrawer
GatePanel
AgentActivityStrip
WorkflowLens
AttachmentShelf
UnifiedComposer
DebugDetailDrawer
```

组件职责必须保持展示层边界：

- 可以聚合 API 返回的数据。
- 可以做 UI projection。
- 可以根据 Core 提供的 classification/observation 展示 gate。
- 不重建 Core 状态机。
- 不自行判断 merge readiness。
- 不自行执行 workflow action。
- 不把 raw event/transcript 默认展开。

## 11. API 与数据原则

第一版尽量复用已有 API：

- `GET /projects`
- `GET /tasks`
- `GET /tasks/:taskId`
- `GET /tasks/:taskId/summary`
- `POST /tasks`
- `POST /daemon/tick`
- human request answer API
- PR/MR operator APIs
- workflow operator-only status/artifacts/events APIs

如出现 N+1 或 payload 噪音，可以新增只读 summary endpoint，但必须满足：

- 从持久化事实派生。
- 不触发外部副作用。
- 不成为新真相源。
- 不把 raw provider JSONL、完整 transcript、lock token、operation 大对象暴露给普通 Web projection。

## 12. 旧页面清理

旧的 `Task Cockpit`、侧栏 `Action Inbox`、`Classic Debug`、独立 `New Task` 页面和独立 `Project Admin` 页面不再作为新 Web 的产品基线。Web V2 应从新的单页工作台开始实现，而不是在旧页面上继续迁移式打补丁。

迁移规则：

- 旧 `Task Cockpit` 的核心信息迁入 `Focus Drawer`。
- 旧 `Action Inbox` 收敛为 `Needs-Me Gate Inbox`，只展示真正 operator gate。
- 旧 `Classic Debug` 页面删除；必要 debug 能力迁入 `Workflow Lens` / `Debug Detail Drawer`，默认折叠。
- 旧 task card board 改为 `Run Matrix` 行式结构。
- 旧 workflow action panel 不再由 `allowedActions.length > 0` 触发。
- 旧 `New Task` 和 `Project Admin` 页面删除；后续由 `Unified Composer` 和更轻量的 project controls 承接需要保留的入口。

历史文档中如果提到 `Task Cockpit` 或 `Action Inbox`，应理解为旧实现或历史切片名称；新的实现与验收以本文档为准。

## 13. 验收标准

### 13.1 产品验收

- 首页是 Run Matrix，而不是单 task debug 页或 landing page。
- 一屏能同时扫描多个 task 的 running / needs-me / failed / handoff 状态。
- workflow stage/substate 在行内可见，但不占据主视觉。
- `materialize-change <change-id>` 不进入 Needs-Me Gate Inbox。
- 真正 operator gate 能在 Focus Drawer 中明确确认。
- Unified Composer 可用于创建 task、回复 gate、追加上下文和上传附件。
- Debug 信息默认折叠。
- 页面没有解释性填空区域。

### 13.2 边界验收

- Web 不直接写 SQLite。
- Web 不执行 workflow CLI。
- Web 不读取 `.workflow` private state。
- Web 不根据 `allowedActions/actionInputs` 自动生成人工待办。
- Web 不根据 stage/substate 推导 PR ready、done 或 merge。
- daemon/outer Agent 不自动确认 human gate。
- PR/MR/review/merge 继续走既有 Core gate。

### 13.3 技术验收

- 桌面视口下文本不溢出、状态不重叠、轨道尺寸稳定。
- 运行状态动效不导致布局抖动。
- 重要按钮有 `aria-label` 和可测试定位。
- Run Matrix row 有稳定 `data-task-id`。
- 支持 `prefers-reduced-motion`。
- `pnpm --filter @coordinator/web build`、`pnpm typecheck` 和相关 tests 通过。
- 真实 Web smoke 至少覆盖：创建 task、run until blocked、workflow stage/substate 展示、internal action 不进 needs-me、operator gate 可确认、附件可上传或安全占位。

## 14. 非目标

本方案暂不做：

- 移动端或手机屏幕适配。
- 通用 DAG engine。
- 新 Core 状态机。
- 自动 workflow action executor。
- 自动 merge approval。
- 任意 workspace hook 执行。
- 远程 worker fleet 管理。
- 多租户权限系统。
- 完整 workflow protocol ownership 字段改造。

这些能力可以在未来独立设计，但不得混入 Web V2 第一轮实现。
