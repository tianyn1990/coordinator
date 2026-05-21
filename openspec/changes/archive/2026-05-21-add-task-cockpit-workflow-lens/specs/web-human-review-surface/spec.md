## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Web 必须保留 Classic Debug 入口

系统 SHALL 保留现有密集 task detail 的排查能力，并将其作为 Classic Debug 或 Raw Detail 从 Workbench 和 Task Cockpit 可达。

#### Scenario: 从任务卡片进入 Classic Debug

- **WHEN** operator 在 task card 中选择 debug/detail 入口
- **THEN** 系统展示该 task 的 raw-oriented detail
- **AND** 仍可查看 surface、diagnosis、execution、workflow/agent、human request、PR/MR 和 timeline 摘要

#### Scenario: Workbench 默认不展示 raw detail

- **WHEN** operator 只浏览 Workbench
- **THEN** 系统不把完整 Classic Debug 内容铺在默认页面

#### Scenario: 从 Task Cockpit 进入 Classic Debug

- **WHEN** operator 在 Task Cockpit 中选择 Classic Debug
- **THEN** 系统展示同一 task 的 raw-oriented detail
- **AND** operator 可以返回 Task Cockpit 或 Workbench
