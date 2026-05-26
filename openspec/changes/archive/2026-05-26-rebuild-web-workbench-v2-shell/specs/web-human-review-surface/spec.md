## ADDED Requirements

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

## MODIFIED Requirements

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
