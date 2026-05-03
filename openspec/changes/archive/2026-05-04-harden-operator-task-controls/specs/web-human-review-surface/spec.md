## ADDED Requirements

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
## MODIFIED Requirements

### Requirement: Web 不得扩大 agent surface 或绕过 Core gate

系统 SHALL 保持 Web 操作面与 Coordinator Agent surface 分离；Web/API 新增 operator action 不得出现在 `available_tools` 中。

#### Scenario: 生成任意 Coordinator Surface

- **WHEN** 本轮 Web operator action 已实现
- **THEN** Surface 仍不得包含 `record_human_answer`、`approve_merge`、`reject_merge`、`daemon_tick`、`pause_task`、`resume_task`、`cancel_task`、`retry_task` 或 API endpoint 名称

#### Scenario: Web 调用副作用 API

- **WHEN** Web 触发 human answer、approval、reject、merge、daemon tick 或 task control
- **THEN** API 调用 Core runtime 执行校验和状态迁移
- **AND** Web 不直接修改 SQLite
