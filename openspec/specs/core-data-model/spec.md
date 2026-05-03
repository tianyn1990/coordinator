# core-data-model Specification

## Purpose
定义 `coordinator` 第一版的核心 SQLite 数据模型、append-only event store、operation / lock / CAS 基础以及最小 timeline 查询能力。该规格只覆盖 Iteration 2，不包含 Project Registry、Coordinator Surface、daemon、workflow adapter 或 agent tools。
## Requirements
### Requirement: 核心表必须覆盖 P0 数据对象

系统 SHALL 通过 SQLite migration 建立 P0 必需核心表，包括 projects、tasks、attempts、execution_plans、plan_steps、workspaces、agent_sessions、workflow_runs、pull_requests、human_requests、events、artifacts、operations、locks。

#### Scenario: 执行核心数据 migration

- **WHEN** 开发者对空 SQLite 数据库执行 migration
- **THEN** 系统创建所有 P0 必需核心表

### Requirement: 核心实体必须支持 CAS 字段

系统 SHALL 为需要状态迁移的核心实体保存 `state_version` 和 `updated_at`，并在 repository 更新时校验 expected state version。

#### Scenario: CAS 冲突

- **WHEN** repository 使用过期 `state_version` 更新 task
- **THEN** 系统拒绝更新并返回受控 CAS conflict

### Requirement: 状态变化和事件必须同事务提交

系统 SHALL 在同一 SQLite transaction 内提交关键状态变化和对应 append-only event。

#### Scenario: 创建 task 并记录事件

- **WHEN** repository 创建 task
- **THEN** 系统在同一事务中写入 task 记录和 task created event

### Requirement: Event Store 必须 append-only

系统 SHALL 允许追加事件和查询时间线，但不提供更新或删除历史事件的 repository 能力。

#### Scenario: 查询 task timeline

- **WHEN** 开发者按 task id 查询事件
- **THEN** 系统按创建时间和事件 id 返回该 task 的 timeline

### Requirement: Operation 必须通过 idempotency key 防重复

系统 SHALL 使用稳定 `idempotency_key` 保证同一 non-terminal operation 不会重复创建。

#### Scenario: 重复创建 active operation

- **WHEN** repository 使用同一 idempotency key 创建第二个 non-terminal operation
- **THEN** 系统拒绝重复创建或返回已存在 operation

### Requirement: Lock 必须支持 lease 和 fencing token

系统 SHALL 保存 lock owner、lock token、lease version、expires_at、heartbeat_at，并在未过期时拒绝其他 owner 抢占。

#### Scenario: 未过期 lock 被其他 owner 获取

- **WHEN** 一个 owner 已持有未过期 lock
- **THEN** 系统拒绝另一个 owner 获取同一 lock

#### Scenario: 过期 lock 被接管

- **WHEN** lock 已过期
- **THEN** 系统允许新 owner 获取 lock，并增加 lease version 与生成新的 lock token

### Requirement: Active 唯一性必须由数据库约束保障

系统 SHALL 使用数据库约束或等价事务保证关键 active 资源唯一，至少覆盖 attempt active workspace、attempt active workflow run、blocked gate pending human request、PR active merge approval、PR active merge operation、operation idempotency key。

#### Scenario: 重复 active workspace

- **WHEN** 同一 attempt 已有 active workspace
- **THEN** 系统拒绝创建第二个 active workspace

### Requirement: CLI 和 API 必须能查看最小 event timeline

系统 SHALL 提供 CLI 和 API 入口，用于按 task id 查看最小 event timeline。

#### Scenario: CLI 查询 timeline

- **WHEN** 开发者通过 CLI 指定 database path 和 task id 查询 timeline
- **THEN** 系统输出该 task 的事件列表

#### Scenario: API 查询 timeline

- **WHEN** API 收到 task timeline 查询请求
- **THEN** 系统返回该 task 的事件列表

### Requirement: 系统必须提供 Web 所需 task 查询能力

系统 SHALL 提供 repository/Core 查询能力，用于 Web 获取 task list 与 task detail operator summary；该 summary 只能反映已持久化机器事实，不得创建新的状态迁移规则。

#### Scenario: 查询 task list

- **WHEN** Web/API 查询 task list
- **THEN** 系统返回 task、project 名称、状态、autonomy 和 source kind
- **AND** 查询不会修改任何核心实体状态

#### Scenario: 查询 task detail summary

- **WHEN** Web/API 查询 task detail
- **THEN** 系统返回 task、project、latest attempt、active workspace、active workflow run、latest PR/MR、open human requests、recent agent sessions 和 recent events 的 operator summary
- **AND** summary 中的 agent-facing guidance 仍来自 Core Surface builder

### Requirement: 系统必须支持 operator 记录 human answer

系统 SHALL 提供 Core service 将 operator answer 写为 artifact，并以 CAS 校验更新 HumanRequest 状态为 `answered`。

#### Scenario: 记录 human answer

- **WHEN** operator 提交 human request id、expected state version、answer 正文和 answered by
- **THEN** 系统写入 human answer artifact
- **AND** 系统更新 HumanRequest 为 `answered`
- **AND** 系统写入 `human.answer_received` event

#### Scenario: human request 不存在

- **WHEN** operator 提交不存在的 human request id
- **THEN** 系统返回受控 not found 错误
- **AND** 不创建 answer artifact

#### Scenario: human request 已不是 waiting

- **WHEN** operator 对非 waiting/pending human request 提交 answer
- **THEN** 系统拒绝更新
- **AND** 不改变 task lifecycle

### Requirement: Web operator 查询不得改变 append-only event 语义

系统 SHALL 复用既有 append-only event store 支撑 Web timeline，不得为展示目的更新或删除历史 event。

#### Scenario: Web 查询 timeline

- **WHEN** Web/API 查询 task timeline
- **THEN** 系统按 event store 追加顺序返回事件
- **AND** 不修改事件内容

### Requirement: 系统必须持久化 PR/MR 与 merge approval machine truth

系统 SHALL 在 SQLite 中持久化 pull request、review snapshot、merge approval、相关 operation 和 event，以支撑 PR/MR 创建、更新、审批、merge 和恢复。

#### Scenario: create PR/MR record

- **WHEN** 系统创建 PR/MR
- **THEN** 系统保存 provider kind、external id、url、head/base branch、head/base sha、status

#### Scenario: approval snapshot

- **WHEN** 系统记录 merge approval
- **THEN** 系统保存 pr_id、head_sha、base_sha、validation_run_id、merge_strategy、approved_by、approved_at 和有效性

#### Scenario: active merge operation uniqueness

- **WHEN** 同一 PR 存在 active merge operation
- **THEN** 数据库约束防止并发重复 merge
