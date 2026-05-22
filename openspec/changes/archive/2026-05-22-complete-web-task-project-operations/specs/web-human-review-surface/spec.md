## ADDED Requirements

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

系统 SHALL 提供全局和单任务 `Run until blocked` operator 操作，用于循环触发 daemon tick 和 refresh，直到达到安全停止条件。

#### Scenario: 全局推进安全队列

- **WHEN** operator 从 Workbench 触发全局 `Run until blocked`
- **THEN** Web 循环调用 `/daemon/tick` 并刷新 tasks/detail
- **AND** Web 展示每轮 daemon action summary
- **AND** Web 在没有可安全推进项、达到最大轮数或出现需要 operator/human 介入的事项时停止

#### Scenario: 单任务推进到阻塞

- **WHEN** operator 从 Task Cockpit 或 New Task created task 触发单任务 `Run until blocked`
- **THEN** Web 循环调用 `/daemon/tick` 并刷新该 task detail
- **AND** Web 在该 task terminal、pending human request、pending merge approval、workflow running without handoff、operator attention、PR/MR waiting review、failed/unknown 或最大轮数时停止
- **AND** Web 展示停止原因

#### Scenario: workflow running without handoff 停止

- **WHEN** task 存在 running workflow run 且没有 handoff
- **THEN** Web 停止 run-until-blocked loop
- **AND** 页面说明 Coordinator 会只读 inspect 或等待 handoff，不会自动执行 workflow action

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
