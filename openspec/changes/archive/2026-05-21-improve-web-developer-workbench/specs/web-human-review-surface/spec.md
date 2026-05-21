## ADDED Requirements

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
