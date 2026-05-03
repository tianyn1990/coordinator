# coordinator-agent-tools Specification

## Purpose

定义 `coordinator` 第一版 Coordinator Agent Tools executor 契约：系统必须让外层 Coordinator Agent 只能通过当前 Coordinator Surface 暴露的受控工具推进计划、attempt/workspace、workflow run 和 human request，并记录可观测 tool trace。该规格不包含 daemon、PR/MR provider、merge approval 或 agent provider 自动 tool-call 解析。

## ADDED Requirements

### Requirement: Agent tool 执行必须受 Coordinator Surface 可见性约束

系统 SHALL 在执行任意 agent tool 前基于当前 task 生成 Coordinator Surface，并拒绝执行不在 `available_tools` 中的工具。

#### Scenario: 工具当前不可见

- **WHEN** 当前 surface 不包含 `start_workflow_run`
- **THEN** executor 拒绝执行该工具
- **AND** 不产生 workspace、workflow 或 human request 副作用
- **AND** 写入失败的 `agent_tool_call` event

### Requirement: Tool 参数必须保持窄并使用 artifact-first

系统 SHALL 只接受 id、enum、短字符串和相对 artifact path；复杂 Markdown 内容必须通过 artifact 引用。

#### Scenario: planning 阶段使用 task-local artifact root

- **WHEN** task 尚未创建 workspace
- **THEN** surface `artifact_root` 指向 task-local coordinator artifact root
- **AND** executor 只接受相对此 root 的 artifact path

#### Scenario: 写 execution plan

- **WHEN** agent 调用 `write_execution_plan` 并传入 `artifact`
- **THEN** executor 校验 artifact path 位于当前 artifact root 内
- **AND** 从 artifact 读取 Markdown 计划正文
- **AND** 持久化 execution plan

#### Scenario: artifact path escape

- **WHEN** agent 传入绝对路径或包含 `..` segment 的 artifact path
- **THEN** executor 拒绝执行
- **AND** 返回 `invalid_artifact_path`

### Requirement: P0 attempt/workspace/workflow tools 必须复用 Core service

系统 SHALL 通过已有 Core service 执行 attempt、workspace 和 workflow 相关副作用，避免绕过 operation/idempotency/lock 契约。

#### Scenario: 创建 workspace

- **WHEN** agent 调用 `create_workspace` 并传入 attempt id
- **THEN** executor 调用 Workspace Manager 创建 workspace
- **AND** Workspace Manager 负责 operation、lock、git worktree 与 artifact 记录

#### Scenario: 启动 workflow run

- **WHEN** agent 调用 `start_workflow_run` 并传入 profile id
- **THEN** executor 调用 Workflow Protocol Adapter
- **AND** profile 必须来自 workflow capabilities 中 implemented profile
- **AND** executor 不读取或写入 `.workflow` private state

#### Scenario: 本轮不接受 provider 参数

- **WHEN** agent 调用 `start_workflow_run` 并传入 `provider`
- **THEN** executor 拒绝执行
- **AND** 返回 `invalid_argument`

### Requirement: inspect_workflow_run 必须只通过 workflow protocol

系统 SHALL 通过 Workflow Protocol Adapter 查询 workflow status，并按 protocol handoff 更新外层 workflow run。

#### Scenario: 查询 workflow run

- **WHEN** agent 调用 `inspect_workflow_run`
- **THEN** executor 调用 protocol status
- **AND** 返回规范化 workflow run 状态
- **AND** 不把 stage/substate/gate 当成外层完成语义

### Requirement: ask_human 必须创建可审计 HumanRequest

系统 SHALL 通过 artifact 保存 human question，并创建 waiting human request。

#### Scenario: 请求人类澄清

- **WHEN** agent 调用 `ask_human`，kind 为 `requirements-clarification`
- **THEN** executor 校验 question artifact
- **AND** 创建 human request
- **AND** append `human.request_created` 与 `agent_tool_call` event

### Requirement: 每次 tool call 必须记录事件

系统 SHALL 对成功和失败的 tool call 都写入 `agent_tool_call` event。

#### Scenario: 工具成功

- **WHEN** agent tool 执行成功
- **THEN** event payload 包含 tool name、args summary、status、result summary 和 artifact refs

#### Scenario: 工具失败

- **WHEN** agent tool 执行失败
- **THEN** event payload 包含 tool name、args summary、status、failure code

### Requirement: CLI/API tool executor 入口必须是 operator-only

系统 SHALL 提供 CLI/API 调试入口调用 executor，但这些入口不得被加入 Coordinator Surface 的 agent tools 列表。

#### Scenario: CLI 调用 tool executor

- **WHEN** operator 通过 CLI 为 task 执行 agent tool
- **THEN** CLI 返回 executor 结果

#### Scenario: Surface 不暴露 operator 调试入口

- **WHEN** 系统生成任意 Coordinator Surface
- **THEN** surface 不包含 `agent-tool execute` 或 API endpoint 名称
