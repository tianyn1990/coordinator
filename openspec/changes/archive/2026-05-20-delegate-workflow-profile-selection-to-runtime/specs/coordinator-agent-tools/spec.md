## MODIFIED Requirements

### Requirement: P0 attempt/workspace/workflow tools 必须复用 Core service

系统 SHALL 通过已有 Core service 执行 attempt、workspace 和 workflow 相关副作用，避免绕过 operation/idempotency/lock 契约。Agent-facing `start_workflow_run` SHALL NOT accept a concrete workflow profile chosen by the outer Coordinator Agent；Core SHALL derive workflow selection from human/operator task input or runtime auto selection.

#### Scenario: 创建 workspace

- **WHEN** agent 调用 `create_workspace` 并传入 attempt id
- **THEN** executor 调用 Workspace Manager 创建 workspace
- **AND** Workspace Manager 负责 operation、lock、git worktree 与 artifact 记录

#### Scenario: outer Agent 启动 workflow run

- **WHEN** agent 调用 `start_workflow_run`
- **THEN** executor 调用 Workflow Protocol Adapter
- **AND** executor 不要求 agent 提供 profile
- **AND** Core 使用 human explicit selection 或 runtime auto selection 启动 workflow
- **AND** executor 不读取或写入 `.workflow` private state

#### Scenario: outer Agent 传入具体 profile

- **WHEN** agent 调用 `start_workflow_run` 并传入 `profile`
- **THEN** executor 拒绝执行或忽略该 agent-supplied profile 并记录受控失败
- **AND** 不把该 profile 当作 human explicit selection

#### Scenario: 本轮不接受 provider 参数

- **WHEN** agent 调用 `start_workflow_run` 并传入 `provider`
- **THEN** executor 拒绝执行
- **AND** 返回 `invalid_argument`
