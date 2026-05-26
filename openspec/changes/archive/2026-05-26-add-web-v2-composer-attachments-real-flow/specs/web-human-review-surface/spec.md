## ADDED Requirements

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
