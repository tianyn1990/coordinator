# web-human-review-surface Specification

## Purpose

定义 `coordinator` 第一版 Web operator surface 契约：系统必须让 operator 能通过 Web 查看 task、surface、timeline、tool trace、human request、PR/MR 和 merge approval，并通过 operator-only API 进行人工介入；Web 不得扩大 Coordinator Agent surface，也不得绕过 Coordinator Core gate。
## Requirements
### Requirement: Web 必须提供 task list 与手动 task 创建

系统 SHALL 提供 Web 操作面用于查看 task list，并创建 manual source task；Web 创建 task 不得引入任何 source-specific 状态机。

#### Scenario: 查看 task list

- **WHEN** operator 打开 Web 操作面
- **THEN** 系统展示当前数据库中的 task 列表
- **AND** 每个 task 至少显示标题、状态、project、autonomy 和当前更新时间摘要

#### Scenario: 创建 manual task

- **WHEN** operator 在 Web 中选择 project 并提交 title、description 和 autonomy
- **THEN** 系统创建 source kind 为 `manual` 的 normalized task
- **AND** 系统写入 `task.created` event
- **AND** Web 可立即打开该 task detail

### Requirement: Web task detail 必须展示当前 blocker 与 Surface snapshot

系统 SHALL 在 task detail 中展示由 Core 生成的 current blocker、Coordinator Surface JSON/Markdown 摘要和当前可见 agent tools；Web 不得自行拼接 agent guidance。Web task detail SHALL 同时展示 Core 提供的 operator-only diagnosis summary，帮助 operator 理解恢复状态和排查下一步。

#### Scenario: 查看 task detail

- **WHEN** operator 打开某个 task detail
- **THEN** Web 展示当前 task/project/attempt/workspace/workflow/PR/human request 摘要
- **AND** Web 展示来自 Core 的 surface kind、recommended next step、denied actions 和 available tools
- **AND** Web 展示 diagnosis 中的 current blocker、operator attention、retry budget 和最近 recovery decision 摘要

#### Scenario: Surface 生成失败

- **WHEN** Core 无法为 task 生成 surface
- **THEN** Web 显示受控错误
- **AND** 不显示任何伪造的可执行下一步

### Requirement: Web 必须展示 event timeline 与 tool trace

系统 SHALL 在 task detail 中展示 append-only event timeline，并对 agent tool、daemon、workflow、human、PR/MR 和 merge 事件提供可读摘要。Web SHALL 额外展示 operation ledger、recovery decision timeline 与 provider/protocol inspect 摘要，但不得直接展示完整 event payload 或完整 operation JSON。

#### Scenario: 查看 event timeline

- **WHEN** task 存在事件
- **THEN** Web 按时间顺序展示事件类型、摘要、severity、operation id 和 artifact refs

#### Scenario: 查看 tool trace

- **WHEN** timeline 中存在 `agent_tool_call` 事件
- **THEN** Web 展示 tool name、status、failure code 或 result summary

#### Scenario: 查看 recovery diagnosis

- **WHEN** timeline 中存在 `daemon.recovery_decision`、retry、provider inspect 或 protocol inspect 事件
- **THEN** Web 展示 Core 生成的 diagnosis 摘要
- **AND** Web 不渲染 provider raw output、lock token、完整 operation JSON 或完整 recovery matrix

### Requirement: Web 必须支持回答 human request

系统 SHALL 允许 operator 对 waiting human request 提交回答，并通过 operator-only API 写入 answer artifact 和 HumanRequest 状态；回答不得直接推进 task completed 或 merge。

#### Scenario: 回答 human request

- **WHEN** operator 对 waiting human request 输入回答并提交 expected state version
- **THEN** Core 创建 human answer artifact
- **AND** HumanRequest 状态变为 `answered`
- **AND** 系统写入 `human.answer_received` event

#### Scenario: 使用过期 human request version 回答

- **WHEN** operator 使用过期 state version 提交回答
- **THEN** 系统拒绝更新
- **AND** Web 显示需要刷新后重试

### Requirement: Web 必须支持 merge approval / reject / merge 操作

系统 SHALL 在 PR/MR 区域展示 approval snapshot，并允许 operator 显式 approve、reject 或触发 merge after approval；所有操作必须复用 Core PR/MR provider runtime。

#### Scenario: 批准 merge

- **WHEN** operator 在 Web 中批准当前 PR/MR snapshot
- **THEN** Core 记录 approval snapshot
- **AND** Web 展示 approved 状态和 snapshot 字段

#### Scenario: 拒绝 merge

- **WHEN** operator 在 Web 中拒绝 merge approval
- **THEN** Core 将对应 approval request 标记为 rejected
- **AND** merge_after_approval 不得因此变为可用

#### Scenario: 触发 merge

- **WHEN** operator 在 approval snapshot 有效后触发 merge
- **THEN** Core 先重新 inspect PR/MR snapshot
- **AND** snapshot 匹配时执行默认 squash merge
- **AND** snapshot 不匹配时拒绝 merge 并记录受控失败

### Requirement: Web 必须提供 daemon tick 调试入口

系统 SHALL 允许 operator 从 Web 手动触发单次 daemon tick，用于本地调试或没有长运行 daemon 进程时推进任务；该入口仍是 operator-only。

#### Scenario: 触发 daemon tick

- **WHEN** operator 点击 daemon tick
- **THEN** API 执行一次 `runDaemonTick`
- **AND** Web 展示本次 tick 的 action 摘要
- **AND** 该能力不进入 Coordinator Surface available tools

### Requirement: Web 必须支持 operator task controls

系统 SHALL 在 task detail 中提供 pause、resume、cancel、retry 操作入口；这些入口必须是 operator-only，并复用 Core task control runtime。

#### Scenario: Web 暂停 task

- **WHEN** operator 在 Web task detail 中点击 pause 并提交 reason
- **THEN** Web 调用 operator-only task control API
- **AND** 成功后刷新 task detail 和 timeline

#### Scenario: Web 恢复 task

- **WHEN** operator 在 Web task detail 中点击 resume
- **THEN** Web 调用 operator-only task control API
- **AND** task detail 展示 task 进入 `resuming`

#### Scenario: Web 取消 task

- **WHEN** operator 在 Web task detail 中点击 cancel 并提交 reason
- **THEN** Web 调用 operator-only task control API
- **AND** Web 明确显示 cancel 不等同于清理 workspace 或关闭 PR/MR

#### Scenario: Web 请求 retry

- **WHEN** operator 在 Web task detail 中点击 retry
- **THEN** Web 调用 operator-only task control API
- **AND** 后续推进仍依赖 daemon tick 或 daemon loop

#### Scenario: Web task controls 不进入 agent surface

- **WHEN** Web task controls 已实现
- **THEN** 任意 Coordinator Surface `available_tools` 不包含 `pause_task`、`resume_task`、`cancel_task` 或 `retry_task`

### Requirement: Web 不得扩大 agent surface 或绕过 Core gate

系统 SHALL 保持 Web 操作面与 Coordinator Agent surface 分离；Web/API 新增 operator action 不得出现在 `available_tools` 中。

#### Scenario: 生成任意 Coordinator Surface

- **WHEN** 本轮 Web operator action 已实现
- **THEN** Surface 仍不得包含 `record_human_answer`、`approve_merge`、`reject_merge`、`daemon_tick`、`pause_task`、`resume_task`、`cancel_task`、`retry_task` 或 API endpoint 名称

#### Scenario: Web 调用副作用 API

- **WHEN** Web 触发 human answer、approval、reject、merge、daemon tick 或 task control
- **THEN** API 调用 Core runtime 执行校验和状态迁移
- **AND** Web 不直接修改 SQLite

### Requirement: Web 必须提供 Developer Workbench 作为多任务入口

系统 SHALL 提供 Developer Workbench 视图作为 Web 默认主入口，用于展示多个 project 与多个 task 的整体局面；该视图不得替代 Coordinator Core 状态机，也不得绕过现有 operator-only API。

#### Scenario: 打开 Workbench

- **WHEN** operator 打开 Web 主页面
- **THEN** 系统展示 Developer Workbench
- **AND** Workbench 展示 project rail、mission strip、task board 和 action inbox
- **AND** Workbench 不默认展示完整 raw surface、完整 event payload 或完整 operation JSON

#### Scenario: 按 project 查看任务

- **WHEN** operator 在 Workbench 中选择某个 project
- **THEN** task board 只展示该 project 的任务
- **AND** mission strip 与 action inbox 根据当前 project 过滤结果更新

#### Scenario: 查看全部 project

- **WHEN** operator 选择 all projects
- **THEN** task board 展示所有 project 的任务摘要
- **AND** project rail 显示每个 project 的任务数量或 attention 数量摘要

### Requirement: Workbench 必须提供任务卡片摘要

系统 SHALL 在 Workbench 中用 task card 展示任务摘要，帮助 operator 快速判断任务是否顺利推进、是否需要人工确认、是否卡在 workflow/PR/MR/review/merge 或异常状态。

#### Scenario: 展示任务卡片

- **WHEN** task 出现在 Workbench task board 中
- **THEN** task card 至少展示 project、title、task status、current blocker、updated at 和 autonomy
- **AND** task card 展示 workflow/PR/MR/human request 的可用摘要
- **AND** task card 提供进入 task detail 或 Classic Debug 的入口

#### Scenario: workflow 信息缺失

- **WHEN** task 没有 active workflow run 或 workflow debug 字段缺失
- **THEN** task card 使用 `none`、`unknown` 或 Core summary 的安全 fallback
- **AND** Web 不根据缺失字段伪造 workflow stage、substate 或 handoff

### Requirement: Workbench 必须提供 Action Inbox

系统 SHALL 在 Workbench 中提供 Action Inbox，用于聚合 operator 需要处理的 human request、merge approval、operator attention、高风险失败和 PR/MR 等待事项。

#### Scenario: pending human request 出现在 Action Inbox

- **WHEN** task detail 中存在 pending non-merge human request
- **THEN** Action Inbox 展示对应 action item
- **AND** action item 提供进入任务处理该 request 的入口

#### Scenario: merge approval 出现在 Action Inbox

- **WHEN** task detail 中存在 pending merge approval request
- **THEN** Action Inbox 展示对应 approval item
- **AND** action item 展示 approval 是否有效的摘要

#### Scenario: operator attention 出现在 Action Inbox

- **WHEN** Core diagnosis 标记 operator attention required
- **THEN** Action Inbox 展示 attention item
- **AND** item 展示 Core 提供的 reason 摘要
- **AND** Web 不展示 provider raw output、lock token 或完整 operation JSON

### Requirement: Web 必须保留 Classic Debug 入口

系统 SHALL 保留现有密集 task detail 的排查能力，并将其作为 Classic Debug 或 Raw Detail 从 Workbench 可达。

#### Scenario: 从任务卡片进入 Classic Debug

- **WHEN** operator 在 task card 中选择 debug/detail 入口
- **THEN** 系统展示该 task 的 raw-oriented detail
- **AND** 仍可查看 surface、diagnosis、execution、workflow/agent、human request、PR/MR 和 timeline 摘要

#### Scenario: Workbench 默认不展示 raw detail

- **WHEN** operator 只浏览 Workbench
- **THEN** 系统不把完整 Classic Debug 内容铺在默认页面

### Requirement: Web Workbench 不得扩大 agent surface

系统 SHALL 保持 Workbench、Action Inbox 和 task cards 为 operator-only 展示与操作面；新增 Web 入口不得进入 Coordinator Agent Surface available tools。

#### Scenario: 生成 Coordinator Surface

- **WHEN** Developer Workbench 已实现
- **THEN** 任意 Coordinator Surface `available_tools` 不包含 Workbench、Action Inbox、project filter、debug view 或 frontend route 名称

#### Scenario: Workbench 触发已有副作用

- **WHEN** Workbench 或 Action Inbox 触发 human answer、merge approval、merge、task control 或 daemon tick
- **THEN** Web 仍调用既有 API/Core runtime
- **AND** Web 不直接修改 SQLite
