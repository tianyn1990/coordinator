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

系统 SHALL 提供 Web V2 Run Matrix 作为 Web 默认主入口，用于展示多个 project 与多个 task 的整体局面；该视图不得替代 Coordinator Core 状态机，也不得绕过现有 operator-only API。

#### Scenario: 打开 Workbench

- **WHEN** operator 打开 Web 主页面
- **THEN** 系统展示 Web V2 Run Matrix
- **AND** 页面展示 Command Bar、Run Matrix、Focus Drawer 和 Unified Composer 占位区域
- **AND** Workbench 不默认展示完整 raw surface、完整 event payload 或完整 operation JSON

#### Scenario: 按 project 查看任务

- **WHEN** operator 在 Command Bar 中选择某个 project
- **THEN** Run Matrix 只展示该 project 的任务
- **AND** needs-me count 与 queue summary 根据当前 project 过滤结果更新

#### Scenario: 查看全部 project

- **WHEN** operator 选择 all projects
- **THEN** Run Matrix 展示所有 project 的任务摘要
- **AND** Command Bar 显示全局 queue 和 needs-me 摘要

### Requirement: Workbench 必须提供任务卡片摘要

系统 SHALL 在 Web V2 Run Matrix 中用 task row 展示任务摘要，帮助 operator 快速判断任务是否顺利推进、是否需要人工确认、是否卡在 workflow/PR/MR/review/merge 或异常状态。

#### Scenario: 展示任务卡片

- **WHEN** task 出现在 Run Matrix 中
- **THEN** task row 至少展示 project、title、task status、current blocker、updated at 和 autonomy
- **AND** task row 展示 workflow/PR/MR/human request 的可用摘要
- **AND** task row 提供 focus task 或进入 Debug Detail 的入口

#### Scenario: workflow 信息缺失

- **WHEN** task 没有 active workflow run 或 workflow debug 字段缺失
- **THEN** task row 使用 `none`、`unknown` 或 Core summary 的安全 fallback
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

系统 SHALL 保留必要的 raw-oriented 排查能力，并将其作为 Focus Drawer 内的 Debug Detail 可达；系统 SHALL NOT 保留旧 Classic Debug 页面级 UI。

#### Scenario: 从任务行进入 Debug Detail

- **WHEN** operator 在 task row 中选择 debug/detail 入口
- **THEN** 系统 focus 该 task 并在 Focus Drawer 内展示或打开 Debug Detail
- **AND** 仍可查看 surface、diagnosis、execution、workflow/agent、human request、PR/MR 和 timeline 摘要

#### Scenario: Workbench 默认不展示 raw detail

- **WHEN** operator 只浏览 Run Matrix
- **THEN** 系统不把完整 Debug Detail 内容铺在默认页面

#### Scenario: 从 Focus Drawer 进入 Debug Detail

- **WHEN** operator 在 Focus Drawer 中选择 Debug Detail
- **THEN** 系统在同一 drawer 中展示该 task 的 raw-oriented detail
- **AND** operator 可以折叠 Debug Detail 并继续浏览 Run Matrix

### Requirement: Web Workbench 不得扩大 agent surface

系统 SHALL 保持 Workbench、Action Inbox 和 task cards 为 operator-only 展示与操作面；新增 Web 入口不得进入 Coordinator Agent Surface available tools。

#### Scenario: 生成 Coordinator Surface

- **WHEN** Developer Workbench 已实现
- **THEN** 任意 Coordinator Surface `available_tools` 不包含 Workbench、Action Inbox、project filter、debug view 或 frontend route 名称

#### Scenario: Workbench 触发已有副作用

- **WHEN** Workbench 或 Action Inbox 触发 human answer、merge approval、merge、task control 或 daemon tick
- **THEN** Web 仍调用既有 API/Core runtime
- **AND** Web 不直接修改 SQLite

### Requirement: Web 必须提供 Task Cockpit 作为单任务主详情

系统 SHALL 提供 Task Cockpit 视图作为单个 task 的主要详情体验，用于展示外层流程、Workflow Lens、Evidence / Actions 和 Debug Drawer；该视图不得替代 Coordinator Core 状态机，也不得绕过 operator-only API。

#### Scenario: 从 Workbench 打开 Task Cockpit

- **WHEN** operator 在 Workbench task card 中打开某个 task
- **THEN** Web 展示该 task 的 Task Cockpit
- **AND** 页面展示 task header、outer flow map、workflow lens、evidence/actions panel 和 debug drawer 入口
- **AND** 页面不默认展开完整 raw surface、完整 event payload 或完整 operation JSON

#### Scenario: 返回 Workbench 或进入 Classic Debug

- **WHEN** operator 位于 Task Cockpit
- **THEN** Web 提供返回 Workbench 的入口
- **AND** Web 提供进入 Classic Debug 的入口

### Requirement: Task Cockpit 必须展示外层流程图

系统 SHALL 在 Task Cockpit 中展示只读 Outer Flow Map，帮助 operator 理解 task 从 plan、attempt、workspace、workflow、PR/MR、review、merge 到 done 的外层进度；该流程图不得成为新的 Core 状态机。

#### Scenario: 展示外层流程节点

- **WHEN** operator 打开 Task Cockpit
- **THEN** Outer Flow Map 至少展示 Task、Plan、Attempt、Workspace、Workflow、PR/MR、Review、Merge、Done 节点
- **AND** 每个节点展示只读状态摘要
- **AND** 节点状态从现有 task detail、attempt、workspace、workflow run、PR/MR、human request 和 task status 派生

#### Scenario: 缺少部分执行资源

- **WHEN** task 尚未创建 attempt、workspace、workflow run 或 PR/MR
- **THEN** 对应节点显示 idle、none 或 waiting fallback
- **AND** Web 不伪造不存在的资源或下一步

### Requirement: Task Cockpit 必须提供 Evidence / Actions panel

系统 SHALL 在 Task Cockpit 中集中展示当前 task 的 human request、merge approval、PR/MR、key artifacts 和安全操作入口；所有副作用必须继续调用既有 API/Core runtime。

#### Scenario: 展示人工确认和 PR/MR 事项

- **WHEN** task 存在 pending human request、pending merge approval 或 active PR/MR
- **THEN** Evidence / Actions panel 展示对应 action card 或 evidence card
- **AND** operator 可以从该 panel 触发现有 human answer、merge approval、merge 或 task control 操作
- **AND** Web 不直接修改 SQLite

#### Scenario: 展示 key artifacts

- **WHEN** task detail 中存在 execution plan、agent final response、PR body 或 workflow handoff artifact refs
- **THEN** Evidence / Actions panel 展示这些 artifact refs 的摘要

### Requirement: Task Cockpit 必须提供折叠 Debug Drawer

系统 SHALL 在 Task Cockpit 中提供默认折叠的 Debug Drawer，用于查看 surface、timeline、operation ledger、recovery timeline、provider/protocol inspect 和 raw-oriented 摘要。

#### Scenario: 默认折叠 debug 信息

- **WHEN** operator 打开 Task Cockpit
- **THEN** Debug Drawer 默认不展开完整 raw detail
- **AND** 页面仍提供展开或跳转到 Classic Debug 的入口

#### Scenario: 展开 Debug Drawer

- **WHEN** operator 展开 Debug Drawer
- **THEN** Web 展示 surface summary、timeline summary、operation ledger、recovery timeline 和 provider/protocol inspect 摘要
- **AND** Web 不展示 provider raw output、lock token、secret 或完整 operation JSON

### Requirement: Task Cockpit 不得扩大 agent surface

系统 SHALL 保持 Task Cockpit、Workflow Lens、Outer Flow Map 和 Debug Drawer 为 operator-only 展示与操作面；新增 Web 视图不得进入 Coordinator Agent Surface available tools。

#### Scenario: 生成 Coordinator Surface

- **WHEN** Task Cockpit 已实现
- **THEN** 任意 Coordinator Surface `available_tools` 不包含 Task Cockpit、Workflow Lens、Outer Flow Map、Debug Drawer 或 frontend route 名称

#### Scenario: Task Cockpit 触发已有副作用

- **WHEN** Task Cockpit 触发 human answer、merge approval、merge、task control 或 daemon tick
- **THEN** Web 仍调用既有 API/Core runtime
- **AND** Web 不直接执行 workflow action

### Requirement: Web 必须提供 New Task 作为主要任务下达入口

系统 SHALL 提供 New Task 视图，用于创建 manual task，并支持比 Workbench 侧栏更完整的任务说明编辑体验。

#### Scenario: 打开 New Task 视图

- **WHEN** operator 从 Workbench 选择创建新任务
- **THEN** Web 展示 New Task 视图
- **AND** 视图至少包含 project 选择、title、description、background、acceptance criteria、constraints、autonomy 和 workflow hint/default 说明
- **AND** Web 不要求 operator 必须选择 workflow profile

#### Scenario: 创建 manual task

- **WHEN** operator 填写 project、title 和任务说明并提交 `Create task`
- **THEN** Web 调用既有 `/tasks` API 创建 manual task
- **AND** API/Core 负责校验和持久化
- **AND** Web 创建成功后刷新 Workbench 并可打开该 task 的 Task Cockpit

#### Scenario: 创建并推进到阻塞

- **WHEN** operator 在 New Task 视图提交 `Create and run until blocked`
- **THEN** Web 先调用既有 `/tasks` API 创建 manual task
- **AND** 创建成功后进入 run-until-blocked operator loop
- **AND** Web 不直接写 SQLite，不直接执行 Coordinator Agent tool，不直接执行 workflow action

### Requirement: Web 必须提供附件与 workflow 选择的安全占位

系统 SHALL 在 New Task 中展示附件/图片上传和 workflow hint 的安全占位，并明确未落地副作用边界。

#### Scenario: 附件上传尚未具备 contract

- **WHEN** operator 查看 New Task 附件区域
- **THEN** Web 展示图片/文件上下文的预留区域
- **AND** Web 明确当前不会上传文件或写入 artifact
- **AND** 系统不在没有 size/type/path/cleanup contract 的情况下创建附件副作用

#### Scenario: workflow hint 默认委托 runtime

- **WHEN** operator 未显式提供 workflow hint 或 profile
- **THEN** 创建出的任务 description 保留默认/auto 语义
- **AND** 后续启动 workflow 时由 workflow runtime 自主选择或确认实际 profile
- **AND** 外层 Agent 不因为 Web 表单而被要求维护 workflow profile catalogue

### Requirement: Web 必须提供 Run Until Blocked 操作体验

系统 SHALL 提供全局和单任务 `Run until blocked` operator 操作，用于循环触发 daemon tick 和 refresh，直到达到安全停止条件。该操作 SHALL 只解释当前 operator-visible 状态，不得把 workflow debug projection 写回 Core DB 成为新 blocker。

#### Scenario: 全局推进安全队列

- **WHEN** operator 从 Workbench 触发全局 `Run until blocked`
- **THEN** Web 循环调用 `/daemon/tick` 并刷新 tasks/detail
- **AND** Web 展示每轮 daemon action summary
- **AND** Web 在没有可安全推进项、达到最大轮数或出现需要 operator/human 介入的事项时停止

#### Scenario: 单任务推进到阻塞

- **WHEN** operator 从 Task Cockpit 或 New Task created task 触发单任务 `Run until blocked`
- **THEN** Web 循环调用 `/daemon/tick` 并刷新该 task detail
- **AND** Web 在该 task terminal、pending human request、pending merge approval、operator-facing workflow gate、workflow handoff ready、operator attention、PR/MR waiting review、failed/unknown 或最大轮数时停止
- **AND** Web 展示停止原因

#### Scenario: workflow running without operator-facing gate 进入观察说明

- **WHEN** task 存在 running workflow run 且没有 handoff
- **AND** latest workflow projection 只包含 agent/internal action 或 unknown action
- **THEN** Web 不把该 workflow action 展示为 needs-me
- **AND** 页面说明 Coordinator 会只读 inspect、等待 workflow runtime / inner agent 或等待 handoff，不会自动执行 workflow action

### Requirement: Web 必须提供常用 PR/MR operator actions

系统 SHALL 在 Task Cockpit 或 Classic Debug 中提供常用 PR/MR operator actions 的入口，并继续调用既有 API/Core runtime。

#### Scenario: 创建或更新 PR/MR

- **WHEN** operator 为 task 输入 PR/MR title 和 body artifact
- **THEN** Web 调用既有 create/update PR/MR API
- **AND** API/Core/provider runtime 负责校验外部副作用和记录事件
- **AND** Web 不自行创建外部 PR/MR

#### Scenario: inspect review 与 request merge approval

- **WHEN** task 存在 PR/MR
- **THEN** Web 提供 inspect review 和 request merge approval 入口
- **AND** request merge approval 必须由 operator 提供 artifact path
- **AND** Web 不绕过 Core 对 PR/MR review、validation 或 approval snapshot 的校验

#### Scenario: approve/reject/merge 仍走 Core gate

- **WHEN** operator 对 pending merge approval 执行 approve、reject 或 merge
- **THEN** Web 调用既有 approval/merge API
- **AND** Core 负责校验 pending request、approval snapshot 和 surface tool visibility
- **AND** Web 不自行判断 merge readiness

### Requirement: Web 操作入口不得扩大 Coordinator Agent Surface

系统 SHALL 保持 New Task、Project Admin、Run Until Blocked 和 PR/MR operator actions 为 operator-only Web 能力，不得进入 Coordinator Agent Surface。

#### Scenario: 生成 Coordinator Surface

- **WHEN** 本轮 Web 操作入口已实现
- **THEN** 任意 Coordinator Surface `available_tools` 不包含 New Task、Project Admin、Run Until Blocked、project register、daemon loop 或 frontend route 名称

#### Scenario: Web 触发已有副作用

- **WHEN** Web 触发 task create、project register、daemon tick、PR/MR action、human answer、merge approval、merge 或 task control
- **THEN** Web 仍调用 API/Core runtime
- **AND** Web 不直接修改 SQLite

### Requirement: Task Cockpit 必须提供 Workflow Action Panel

系统 SHALL 在 Task Cockpit 中把 active workflow run 的 operator-facing projection 展示为 Workflow Action Panel。Panel SHALL 只使用 workflow protocol projection 中的 `allowedActions`、`actionInputHints`、`progress` 与 `stageArtifacts` 进行展示，并且只把 Coordinator 侧 classification 为 operator-facing 的 workflow action 展示为可操作卡片，再通过 operator-only API 提交人类确认 intent；Web MUST NOT 直接调用 workflow CLI、直接写 SQLite、把所有 allowedActions 自动转换为 Web Action Card、或把 agent/internal action 放入 needs-me。

#### Scenario: 展示无参 operator-facing workflow action card

- **WHEN** task detail 中 active workflow run 的 latest projection 包含 allowed action `freeze-requirements`
- **AND** 该 action 被分类为 operator-facing
- **AND** 该 action 没有 required arg
- **THEN** Task Cockpit 展示 Workflow Action Panel
- **AND** Panel 显示 stage/progress、stage artifact path 与确认按钮 `Approve requirements and continue`

#### Scenario: 提交无参 workflow action

- **WHEN** operator 点击 `Approve requirements and continue`
- **THEN** Web 调用 `POST /workflow-runs/:workflowRunId/actions`
- **AND** request body 包含 action、expectedStateVersion 与 actor 摘要
- **AND** Web 不调用 `/workflow-runs/:workflowRunId/action` 作为主路径

#### Scenario: operator-facing 一个 string arg 输入

- **WHEN** actionInputHints 指出某 allowed action 需要 1 个 required arg
- **AND** 该 action 被分类为 operator-facing
- **THEN** Panel 展示一个文本输入框，label 使用 required arg 名称
- **AND** operator 提交后 Web 将该输入作为单个 string arg 发送给 Core API

#### Scenario: agent/internal action input 只展示 debug hint

- **WHEN** latest workflow projection 包含 allowed action `materialize-change`
- **AND** actionInputHints 指出该 action 需要 `change-id`
- **THEN** Task Cockpit 不把该 action 放入 Workflow Action Panel 或 Action Inbox
- **AND** Workflow Lens / debug detail 可以展示 sanitized action id、required arg 名称和 usage hint
- **AND** Web 不要求 operator 填写 `change-id`

#### Scenario: unknown action 只展示 debug hint

- **WHEN** latest workflow projection 包含未分类 allowed action
- **THEN** Task Cockpit 不把该 action 放入 Workflow Action Panel 或 Action Inbox
- **AND** Workflow Lens / debug detail 可以展示 sanitized action id 和 actionInputHints
- **AND** Web 不调用 workflow action endpoint

#### Scenario: 多参数 operator-facing action 只展示不可执行提示

- **WHEN** actionInputHints 指出某 operator-facing action 需要超过 1 个 required arg
- **THEN** Panel 展示该 action 当前需要 CLI/workflow 内部处理或后续版本支持
- **AND** Web 不提交复杂 JSON 参数

#### Scenario: action 成功后刷新当前 task 并继续 task-scoped run

- **WHEN** Core API 成功执行 workflow action
- **THEN** Web 刷新当前 task detail
- **AND** Web 可以继续触发当前 task 的 task-scoped `Run until blocked`
- **AND** Web 不自动确认后续出现的其他 workflow action card

### Requirement: Workbench task card 必须提供稳定 E2E selector

系统 SHALL 为 Workbench task card 与打开按钮提供稳定的 task id selector 和可访问 label，以支持真实 Web E2E 与 operator accessibility。

#### Scenario: task card 包含 data-task-id

- **WHEN** Workbench 展示 task card
- **THEN** card root 包含 `data-task-id`
- **AND** card root 的 aria-label 包含 task title 摘要

#### Scenario: Open button 包含 task id 与 aria-label

- **WHEN** Workbench 展示 task card 的 Open button
- **THEN** button 包含 `data-action="open-task"` 与 `data-task-id`
- **AND** button 的 aria-label 包含 task title 摘要

### Requirement: Task Cockpit 必须展示 agent activity 摘要

系统 SHALL 在 Task Cockpit 或 operator task detail 中展示 recent agent sessions 的 activity 摘要，用于说明 outer Coordinator Agent 是否运行、何时有活动、最后的 normalized event 和 final response artifact。Web MUST NOT 默认展示完整 provider transcript 或 raw provider events。

#### Scenario: 展示 completed agent session activity

- **WHEN** task detail 包含 completed agent session 的 activity 摘要
- **THEN** Task Cockpit 展示 provider、session status、implementation mode、permission profile、last activity、latest normalized event 和 final response artifact
- **AND** Web 只把 provider events / transcript 作为 artifact ref 展示

#### Scenario: 展示 failed agent session activity

- **WHEN** task detail 包含 failed agent session 的 failure signal
- **THEN** Task Cockpit 展示 failure kind、last activity、latest normalized event 和 artifact refs
- **AND** Web 不展示 provider raw output、secret、permission internals 或完整 JSONL

#### Scenario: agent activity 不进入 Action Inbox

- **WHEN** latest normalized event 表示 tool、message、permission 或 turn activity
- **THEN** Web 不把该事件单独转换为 needs-me action card
- **AND** Action Inbox 仍只聚合 human request、merge approval、operator attention、PR/MR 等待和明确 operator-facing gate

### Requirement: Web 必须使用 workflow runtime observation 区分 needs-me 与 observing

系统 SHALL 在 Task Cockpit、Workflow Lens、Action Inbox 和 task card 中使用 Core/API 提供的 workflow runtime observation 或同源 action classification，将 operator-facing gate 与 agent/internal/debug action 分离。Web MUST NOT 因 `allowedActions.length > 0` 直接生成 Action Card、needs-me item 或人工输入表单。

#### Scenario: materialize-change remains debug detail

- **WHEN** task detail latest workflow projection 包含 allowed action `materialize-change`
- **AND** actionInputHints 指出该 action 需要 `change-id`
- **THEN** Task Cockpit 不把该 action 放入 Workflow Action Panel、Action Inbox 或 needs-me
- **AND** Workflow Lens / debug detail 可以展示 sanitized action id、required arg 名称和 usage hint
- **AND** Web 不要求 operator 输入 `change-id`

#### Scenario: operator gate enters action panel

- **WHEN** task detail workflow runtime observation 表示 waiting operator gate
- **AND** observation 包含 operator-facing action `freeze-requirements`
- **THEN** Task Cockpit 展示 Workflow Action Panel
- **AND** Web 仍通过 operator-only Core API 提交确认 intent

#### Scenario: task card does not report internal action as needs me

- **WHEN** Workbench task card 的 workflow observation 为 observing runtime
- **THEN** task card 可以展示 workflow 正在由 runtime / inner agent 继续处理
- **AND** Action Inbox 不为该 task 生成 workflow needs-me item

### Requirement: Web 必须提供 Web V2 Run Matrix 作为默认主入口

系统 SHALL 提供桌面端 Web V2 Run Matrix 作为 Web 默认主入口，用于展示多个 project 与多个 task 的整体局面；该视图不得替代 Coordinator Core 状态机，也不得绕过现有 operator-only API。

#### Scenario: 打开 Web V2 默认入口

- **WHEN** operator 打开 Web 主页面
- **THEN** 系统展示 Command Bar、Run Matrix、Focus Drawer 和 Unified Composer 占位区域
- **AND** 默认视图不展示 marketing hero、landing page、完整 raw surface、完整 event payload 或完整 operation JSON

#### Scenario: Run Matrix 展示任务行

- **WHEN** task 出现在 Run Matrix 中
- **THEN** task row 展示 project、title、task status、updated at 和 focus action
- **AND** task row 提供稳定 `data-task-id`
- **AND** task row 使用安全 fallback 展示缺失的 workflow、agent、PR/MR 或 human request 信息

#### Scenario: Web V2 不要求移动端适配

- **WHEN** operator 在桌面视口使用 Web
- **THEN** Run Matrix 与 Focus Drawer 的布局稳定且核心信息可读
- **AND** 本切片不要求手机屏幕或移动端布局达到完整体验

### Requirement: Run Matrix 必须展示只读 outer lifecycle rail 与 workflow stage rail

系统 SHALL 在 Run Matrix task row 中展示只读 outer lifecycle rail 与 workflow stage rail，帮助 operator 扫描 task 与 workflow 当前位置；这些 rail 不得成为新的 Core 状态机。

#### Scenario: 展示 outer lifecycle rail

- **WHEN** task row 渲染
- **THEN** outer lifecycle rail 至少表达 Task、Plan、Workspace、Workflow、PR、Review 和 Merge 的只读状态
- **AND** rail 状态从现有 task detail、attempt、workspace、workflow run、PR/MR、human request 和 task status 派生
- **AND** Web 不根据 rail 状态自行触发副作用

#### Scenario: 展示 workflow stage rail

- **WHEN** task 存在 workflow projection 的 stage 或 substate
- **THEN** workflow stage rail 展示 requirements、planning、implementation、review、handoff 的只读位置
- **AND** task row 展示 stage/substate chip
- **AND** Web 不根据 stage/substate 推导 PR readiness、done 或 merge

#### Scenario: workflow stage 缺失时安全 fallback

- **WHEN** task 没有 active workflow run 或 workflow stage/substate 缺失
- **THEN** workflow stage rail 显示 none、unknown 或 Core summary 的安全 fallback
- **AND** Web 不伪造不存在的 workflow stage、substate 或 handoff

### Requirement: Web V2 必须提供 Focus Drawer 作为单任务焦点详情

系统 SHALL 在 operator 选中 task 后展示 Focus Drawer，用于展示单任务焦点摘要；Focus Drawer 不得默认铺开 raw timeline、完整 transcript、operation ledger 或复杂 JSON。

#### Scenario: 选中 task 打开 Focus Drawer

- **WHEN** operator 在 Run Matrix 中 focus 某个 task
- **THEN** Focus Drawer 展示该 task 的 title、project、status、current owner/mode、workflow summary、agent activity summary 和 recent evidence
- **AND** Focus Drawer 提供进入 Debug Detail 的入口
- **AND** operator 可以从 Drawer 返回 Run Matrix 上下文

#### Scenario: Focus Drawer 展示 operator gate 摘要

- **WHEN** task 存在 pending human request、pending merge approval、operator-facing workflow gate 或 Core recovery attention
- **THEN** Focus Drawer 展示对应 gate 摘要和现有 operator action 入口
- **AND** 所有副作用仍通过既有 API/Core runtime 执行

#### Scenario: Focus Drawer 不把 internal action 作为人工 gate

- **WHEN** task latest workflow projection 只包含 agent/internal action，例如 `materialize-change`
- **THEN** Focus Drawer 不为该 action 生成 needs-me gate item
- **AND** Workflow Lens 或 Debug Detail 可以展示 sanitized action hint

### Requirement: Web V2 必须删除旧页面级 UI

系统 SHALL 用新的单页 Web V2 shell 替代旧 Workbench board、Task Cockpit、Classic Debug、New Task 和 Project Admin 页面级 UI；旧页面结构不得作为 fallback 或平行导航继续出现。

#### Scenario: 不再展示旧页面导航

- **WHEN** operator 打开 Web V2
- **THEN** 页面不展示 Workbench、Task Cockpit、Classic Debug、New Task 或 Project Admin 的页面级 tab 导航
- **AND** operator 仍可通过 Run Matrix、Focus Drawer、Unified Composer 占位和 Debug Detail 完成本切片保留的操作与观察

#### Scenario: Debug Detail 替代旧 Classic Debug 页面

- **WHEN** operator 需要查看 raw-oriented detail
- **THEN** Web 在 Focus Drawer 内提供 Debug Detail
- **AND** 系统不跳转到旧 Classic Debug 页面

### Requirement: Web V2 shell 不得扩大 agent surface 或 workflow action surface

系统 SHALL 保持 Web V2 shell、Run Matrix、Focus Drawer、rails、pin 和 Debug Detail 为 operator-only 展示与操作面；新增 Web 入口不得进入 Coordinator Agent Surface available tools。

#### Scenario: 生成 Coordinator Surface

- **WHEN** Web V2 shell 已实现
- **THEN** 任意 Coordinator Surface `available_tools` 不包含 Run Matrix、Focus Drawer、Command Bar、Debug Detail Drawer、frontend route 名称或 Web-only action

#### Scenario: Web V2 触发已有副作用

- **WHEN** Run Matrix 或 Focus Drawer 触发 human answer、merge approval、merge、task control、daemon tick 或 operator-facing workflow gate
- **THEN** Web 仍调用既有 API/Core runtime
- **AND** Web 不直接修改 SQLite
- **AND** Web 不直接执行 workflow CLI

### Requirement: Web V2 必须提供 Needs-Me Gate Inbox projection

系统 SHALL 在 Web V2 中使用单一 Needs-Me Gate Inbox projection 驱动 Command Bar count、Run Matrix pin、Focus Drawer gate list 和相关测试定位；该 projection 不得把 workflow agent/internal action、debug-only action、unknown action、raw provider event 或单纯 stage/substate 变化升级为人工 gate。

#### Scenario: operator gate 进入 Needs-Me projection

- **WHEN** task detail 存在 pending human request、pending merge approval、operator-facing workflow gate、Core recovery attention、failed/unknown high-risk state、PR/MR review required/conflict 或 project/provider blocker
- **THEN** Web V2 将该 task 计入 `Needs me`
- **AND** Run Matrix row 显示 needs-me pin
- **AND** Focus Drawer 展示对应 gate item

#### Scenario: internal workflow action 不进入 Needs-Me projection

- **WHEN** task latest workflow projection 只包含 `materialize-change`、`run-alignment-checks`、inspect/resume、unknown 或 debug-only action
- **THEN** Web V2 不将该 task 计入 `Needs me`
- **AND** Focus Drawer 不生成 workflow gate item
- **AND** Workflow Lens 或 Debug Detail 可以展示 sanitized action hint

#### Scenario: projection 不扩大 agent surface

- **WHEN** Web V2 Needs-Me projection 已实现
- **THEN** 任意 Coordinator Surface `available_tools` 不包含 Needs-Me Gate Inbox、Run Matrix pin、Focus Drawer gate item、frontend route 名称或 Web-only action

### Requirement: Web V2 必须用 workflow runtime observation 表达 owner/mode

系统 SHALL 在 Run Matrix row、Focus Drawer 和 Workflow Lens 中使用 Core/API 提供的 workflow runtime observation 或同源 classification fallback 展示 owner/mode；该 observation 只用于 operator explanation，不得成为新的 Core 状态机。

#### Scenario: observing runtime 展示为观察而非阻塞

- **WHEN** task 的 workflow runtime observation 为 `observing-runtime`
- **THEN** Run Matrix owner/mode 表示 workflow runtime 或 inner agent 仍在推进
- **AND** Web V2 不提示 operator 必须执行 workflow action

#### Scenario: waiting operator gate 展示为人工 gate

- **WHEN** task 的 workflow runtime observation 为 `waiting-operator-gate`
- **AND** observation 包含 operator-facing action
- **THEN** Focus Drawer 展示 operator-facing workflow gate
- **AND** Web 仍通过 operator-only Core API 提交确认 intent

#### Scenario: handoff ready 不被 stage/substate 替代

- **WHEN** workflow handoff 已 available
- **THEN** Web V2 将 owner/mode 展示为 handoff-ready 或 Coordinator handoff flow
- **AND** Web 不根据 stage/substate 另行推导 PR readiness、done 或 merge

### Requirement: Web V2 Workflow Lens 必须承接 internal/debug action hint

系统 SHALL 在 Workflow Lens 或 Debug Detail 中展示 internal/debug action 的 sanitized hint，包括 action id、required arg 名称和 usage 摘要；系统 SHALL NOT 在主 gate panel 中展示需要 operator 填内部参数的 action card。

#### Scenario: materialize-change 参数 hint 只进入 Lens

- **WHEN** latest workflow projection 包含 `materialize-change`
- **AND** actionInputHints 指出 required arg 为 `change-id`
- **THEN** Workflow Lens 展示 `materialize-change` 与 `change-id` hint
- **AND** Focus Drawer gate panel 不展示 `change-id` 输入框

#### Scenario: unknown action 保守 debug-only

- **WHEN** latest workflow projection 包含未分类 allowed action
- **THEN** Web V2 只在 Lens 或 Debug Detail 展示该 action
- **AND** Web 不调用 workflow action endpoint

### Requirement: Web V2 不得恢复旧页面级 gate surface

系统 SHALL 保持 Web V2 默认入口为 Run Matrix + Focus Drawer，不得为了 Gate Inbox 或 runtime observation 恢复旧 Action Inbox、Task Cockpit、Classic Debug、New Task 或 Project Admin 页面级 UI。

#### Scenario: Gate Inbox 在 Web V2 单页内展示

- **WHEN** operator 打开 Web V2
- **THEN** Needs-Me Gate Inbox 信息只通过 Command Bar count、Run Matrix pin 和 Focus Drawer gate list 呈现
- **AND** 页面不展示旧 Action Inbox 或 Task Cockpit 页面级导航

### Requirement: Web V2 必须提供 Unified Composer

系统 SHALL 在 Web V2 桌面工作台底部提供 Unified Composer，作为创建 task、回复 human request、追加 task context 和上传本地附件的单一入口；Composer 必须只调用 API/Core runtime，不得直接写 SQLite 或执行 workflow CLI。

#### Scenario: 无选中 task 时创建新 task

- **WHEN** operator 在无 focused task 或选择 New task mode 时输入标题、描述、project、autonomy 和可选 workflow hint
- **THEN** Web 调用 `POST /tasks`
- **AND** 创建成功后 refresh Run Matrix 并 focus 新 task

#### Scenario: pending human request 时回复 gate

- **WHEN** focused task 存在 pending human request
- **THEN** Composer 默认提交为 human answer
- **AND** Web 调用既有 human request answer API
- **AND** Web 不自动调用 workflow action endpoint

#### Scenario: 无 pending gate 时追加上下文

- **WHEN** focused task 不存在 pending human request、pending merge approval 或 operator-facing workflow gate
- **THEN** Composer 默认提交为 task note / follow-up context
- **AND** Web 调用 Core 受控 task note API 写入 artifact/event

### Requirement: Web V2 必须支持本地附件第一版

系统 SHALL 允许 operator 在 Unified Composer / Attachment Shelf 中选择本地图片或文件，并通过受控 API 上传到当前 task 的 attachment root；Web 不得把文件内容放入页面状态以外的持久化渠道，也不得直接写 project repo。

#### Scenario: 上传本地附件

- **WHEN** operator 在 focused task 中选择一个允许类型且未超过大小上限的文件
- **THEN** Web 通过 attachment API 上传文件名、MIME、size 和 base64 bytes
- **AND** Focus Drawer Attachment Shelf 展示该 attachment 的 safe name、MIME、size 和 artifact path

#### Scenario: 附件只展示 refs

- **WHEN** task detail 包含 attachments
- **THEN** Web 默认只展示 attachment metadata 和 artifact ref
- **AND** Web 不默认渲染完整二进制内容、raw base64 或大段文件正文

### Requirement: Composer 不得扩大 workflow action surface

系统 SHALL 保持 workflow operator gate 只通过 Focus Drawer gate panel 的显式按钮提交；Unified Composer 不得根据输入文本、attachment、stage/substate 或 actionInputHints 自动确认 workflow action。

#### Scenario: internal action 不变成人工提交

- **WHEN** focused task 的 Workflow Lens 只包含 `materialize-change`、`run-alignment-checks`、inspect/resume 或 unknown/debug action
- **THEN** Composer 仍处于 note / context mode
- **AND** Web 不显示内部 action 参数输入框
- **AND** Web 不调用 `/workflow-runs/:id/actions`

### Requirement: Workflow Action Panel 必须使用 Core gate evidence

系统 SHALL 让 Web Workflow Action Panel 从 Core/API 获取 workflow gate evidence，并将 evidence 与 operator-facing workflow action 同屏展示。Panel MUST 在 evidence `canSubmit` 为 false 时禁用确认按钮；Web 不得自行读取 agent transcript、final response artifact 或 `.workflow` artifact 正文来拼接确认内容。

#### Scenario: ready evidence 允许操作

- **WHEN** Focus Drawer 展示 `freeze-requirements` workflow gate
- **AND** Core gate evidence 返回 `ready` 与 `canSubmit = true`
- **THEN** Panel 展示 primary message 和 protocol facts
- **AND** `Approve requirements and continue` 按钮可提交到 operator-only workflow action API

#### Scenario: missing evidence 禁止操作

- **WHEN** Focus Drawer 展示 `freeze-requirements` workflow gate
- **AND** Core gate evidence 返回 `missing` 或 `canSubmit = false`
- **THEN** Panel 展示缺少 coding agent 可见确认依据
- **AND** `Approve requirements and continue` 按钮禁用
- **AND** Web 不调用 workflow action API

#### Scenario: evidence 查询失败不回退为盲确认

- **WHEN** gate evidence API 查询失败或返回不可用
- **THEN** Panel 显示受控错误或 loading/missing 状态
- **AND** Web 不启用 workflow action 确认按钮

### Requirement: Web V2 必须展示 inner agent evidence 而不扩大 action surface

系统 SHALL 在 Focus Drawer / Agent Activity / Workflow Action Panel 中展示 Core 返回的 inner agent activity、final response excerpt 和 gate evidence 状态。Web MUST NOT 因 inner evidence ready、raw provider event、stage/substate 或 internal `allowedActions` 自动执行 workflow action。

#### Scenario: Focus Drawer 显示 inner agent session

- **WHEN** task detail 包含 role 为 `inner` 的 agent session
- **THEN** Web Agent Activity 展示该 session 的 role、provider、status 和 latest activity
- **AND** final response 只作为 artifact ref 或 gate evidence excerpt 展示

#### Scenario: ready evidence 启用 operator gate submit

- **WHEN** workflow operator gate 的 gate evidence 为 ready 且 canSubmit 为 true
- **THEN** Web Workflow Action Panel 可以启用对应 operator-facing action 的提交按钮
- **AND** 提交仍调用 API/Core operator-only workflow action helper

#### Scenario: internal action 仍不进入 needs-me

- **WHEN** Workflow Lens 只包含 `materialize-change`、`run-alignment-checks`、inspect/resume 或 unknown/debug action
- **THEN** Web 不创建 Needs-Me item
- **AND** Web 不展示要求 operator 填写 `change-id` 的 action card
- **AND** inner agent activity 只作为运行证据展示

### Requirement: Web run until blocked 必须等待 inner runtime 或真正 gate

系统 SHALL 将 task-scoped run-until-blocked 的停止解释与 Core/daemon 的 inner lifecycle 对齐：inner agent running 时展示 observing runtime；inner agent completed 后若出现 ready operator gate 才展示 waiting operator gate；evidence missing 时展示 missing evidence，不回退为盲确认。

#### Scenario: inner agent running 时停止为 observing runtime

- **WHEN** task-scoped run-until-blocked 后 task 有 active inner agent session
- **AND** 没有 handoff 或 ready operator gate
- **THEN** Web banner 展示 observing runtime
- **AND** 不把 internal allowed action 显示为 needs-me

#### Scenario: gate evidence missing 时不可提交

- **WHEN** workflow operator gate 存在但 gate evidence missing
- **THEN** Web banner 或 gate panel 展示缺少 coding agent 可见确认依据
- **AND** workflow action submit 按钮保持禁用

